import type { RoomSnapshot, RoomSummary, ServerMessage } from "../net/protocol";
import type { PlayerId, RaceAction, RaceState } from "../simulation/raceTypes";

type AppMode = "local" | "online";

interface PlayerMeta {
  id: PlayerId;
  nickname: string;
}

interface ConfigureGameDetail {
  mode: AppMode;
  players: PlayerMeta[];
  controlledPlayerIds: PlayerId[];
}

declare global {
  interface WindowEventMap {
    "game:configure": CustomEvent<ConfigureGameDetail>;
    "game:state": CustomEvent<RaceState>;
    "game:action": CustomEvent<RaceAction>;
    "game:stop": Event;
  }
}

const playerNames: Record<PlayerId, string> = {
  p1: "玩家 1",
  p2: "玩家 2",
  p3: "玩家 3",
};

export function createAppController() {
  const els = getElements();
  let socket: WebSocket | null = null;
  let clientId: string | null = null;
  let currentRoom: RoomSnapshot | null = null;
  let currentMode: AppMode | null = null;
  let latestState: RaceState | null = null;
  let isRacing = false;

  els.showLocal.addEventListener("click", () => {
    els.modePicker.classList.add("panel-stack--hidden");
    els.localPanel.classList.remove("panel-stack--hidden");
  });

  els.showOnline.addEventListener("click", () => {
    els.modePicker.classList.add("panel-stack--hidden");
    els.onlinePanel.classList.remove("panel-stack--hidden");
  });

  for (const back of document.querySelectorAll<HTMLButtonElement>("[data-back]")) {
    back.addEventListener("click", () => {
      els.modePicker.classList.remove("panel-stack--hidden");
      els.localPanel.classList.add("panel-stack--hidden");
      els.onlinePanel.classList.add("panel-stack--hidden");
    });
  }

  els.startLocal2.addEventListener("click", () => startLocal(2));
  els.startLocal3.addEventListener("click", () => startLocal(3));
  els.connectOnline.addEventListener("click", connectOnline);
  els.createRoom.addEventListener("click", () => send({ type: "create-room" }));
  els.joinRoom.addEventListener("click", () => {
    send({ type: "join-room", code: els.roomCode.value });
  });
  els.refreshRooms.addEventListener("click", () => send({ type: "list-rooms" }));
  els.startRoom.addEventListener("click", () => {
    if (currentMode === "online") {
      send({ type: "start-race" });
      return;
    }
    if (currentRoom) {
      startGame({
        mode: "local",
        players: currentRoom.players.map((player) => ({ id: player.playerId, nickname: player.nickname })),
        controlledPlayerIds: currentRoom.players.map((player) => player.playerId),
      });
    }
  });
  els.leaveRoom.addEventListener("click", showLobby);
  els.restart.addEventListener("click", () => {
    stopActiveRace();
    if (currentMode === "local" && currentRoom) {
      showRoom(currentRoom, "本地房间");
      return;
    }
    if (currentRoom) {
      showRoom(currentRoom, "在线房间");
    } else {
      showLobby();
    }
  });

  window.addEventListener("game:action", (event) => {
    if (currentMode === "online") {
      send({ type: "input", action: event.detail });
    }
  });

  window.addEventListener("race:update", (event) => {
    if (!isRacing) {
      return;
    }
    latestState = (event as CustomEvent<RaceState>).detail;
    renderHud(latestState, currentRoom);
    if (latestState.endReason) {
      showResult(latestState, currentRoom);
    }
  });

  function startLocal(playerCount: 2 | 3) {
    currentMode = "local";
    const players = Array.from({ length: playerCount }, (_, index) => {
      const playerId = `p${index + 1}` as PlayerId;
      return {
        clientId: `local-${playerId}`,
        playerId,
        nickname: playerNames[playerId],
        connected: true,
      };
    });
    currentRoom = {
      code: "LOCAL",
      hostClientId: "local-p1",
      players,
      status: "waiting",
      maxPlayers: 3,
    };
    showRoom(currentRoom, "本地房间");
  }

  function connectOnline() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return;
    }

    setOnlineStatus("连接中...");
    socket = new WebSocket(createWsUrl());
    socket.addEventListener("open", () => {
      setOnlineStatus("已连接");
      setOnlineButtons(true);
      send({ type: "hello", nickname: els.nickname.value });
      send({ type: "list-rooms" });
    });
    socket.addEventListener("message", (event) => {
      handleServerMessage(JSON.parse(event.data.toString()) as ServerMessage);
    });
    socket.addEventListener("close", () => {
      setOnlineStatus("连接已断开");
      setOnlineButtons(false);
      socket = null;
    });
    socket.addEventListener("error", () => {
      setOnlineStatus("连接失败");
    });
  }

  function handleServerMessage(message: ServerMessage) {
    switch (message.type) {
      case "welcome":
        clientId = message.clientId;
        return;
      case "room-list":
        renderRoomList(message.rooms);
        return;
      case "room-update":
        currentMode = "online";
        currentRoom = message.room;
        if (!isRacing) {
          showRoom(message.room, "在线房间");
        }
        return;
      case "race-start":
        currentMode = "online";
        currentRoom = message.room;
        startGame({
          mode: "online",
          players: message.room.players.map((player) => ({ id: player.playerId, nickname: player.nickname })),
          controlledPlayerIds: controlledOnlinePlayers(message.room),
        });
        applyOnlineState(message.state);
        return;
      case "race-state":
        applyOnlineState(message.state);
        return;
      case "race-end":
        currentRoom = message.room;
        applyOnlineState(message.state);
        showResult(message.state, message.room);
        return;
      case "error":
        setOnlineStatus(message.message);
        return;
      default:
        return;
    }
  }

  function startGame(detail: ConfigureGameDetail) {
    isRacing = true;
    focusGameInput();
    els.lobby.classList.add("menu--hidden");
    els.roomPanel.classList.add("room-panel--hidden");
    els.scoreboard.classList.remove("scoreboard--hidden");
    els.result.classList.add("result--hidden");
    window.dispatchEvent(new CustomEvent("game:configure", { detail }));
    focusGameInput();
  }

  function applyOnlineState(state: RaceState) {
    latestState = state;
    window.dispatchEvent(new CustomEvent("game:state", { detail: state }));
    renderHud(state, currentRoom);
  }

  function showRoom(room: RoomSnapshot, label: string) {
    stopActiveRace();
    els.lobby.classList.add("menu--hidden");
    els.scoreboard.classList.add("scoreboard--hidden");
    els.roomPanel.classList.remove("room-panel--hidden");
    els.result.classList.add("result--hidden");
    els.roomMode.textContent = label;
    els.roomTitle.textContent = room.code === "LOCAL" ? "本地房间" : `房间 ${room.code}`;
    els.roomCopy.textContent = room.status === "waiting" ? "等待房主开始比赛" : "比赛进行中";
    els.roomPlayers.innerHTML = room.players
      .map((player) => `<span>${player.playerId.toUpperCase()} ${escapeHtml(player.nickname)}${player.clientId === room.hostClientId ? " · 房主" : ""}</span>`)
      .join("");
    const isHost = currentMode === "local" || room.hostClientId === clientId;
    els.startRoom.disabled = !isHost || room.players.filter((player) => player.connected).length < 2;
  }

  function showLobby() {
    stopActiveRace();
    els.lobby.classList.remove("menu--hidden");
    els.roomPanel.classList.add("room-panel--hidden");
    els.scoreboard.classList.add("scoreboard--hidden");
    els.result.classList.add("result--hidden");
    latestState = null;
  }

  function showResult(state: RaceState, room: RoomSnapshot | null) {
    if (!isRacing) {
      return;
    }
    els.result.classList.remove("result--hidden");
    els.resultKicker.textContent = state.endReason === "disconnect" ? "DISCONNECTED" : "RACE OVER";
    const winnerName = state.winner ? nicknameFor(room, state.winner) : "无人获胜";
    els.resultTitle.textContent = state.winner ? `${winnerName} 获胜` : "比赛结束";
    if (state.endReason === "lead") {
      els.resultCopy.textContent = "领先所有对手 50 米。";
    } else if (state.endReason === "disconnect") {
      els.resultCopy.textContent = "有人掉线或只剩最后一名玩家。";
    } else {
      els.resultCopy.textContent = "其他玩家已经撞上障碍车。";
    }
  }

  function renderHud(state: RaceState, room: RoomSnapshot | null) {
    els.playerStats.innerHTML = state.players
      .map((player) => {
        const name = nicknameFor(room, player.id);
        const status = player.crashed ? "OUT" : `BOOST ${player.boostCount}`;
        return `<div class="pilot pilot-${player.id}">
          <span class="pilot__tag">${player.id.toUpperCase()}</span>
          <strong>${Math.round(player.speed)}</strong>
          <span>km/h</span>
          <small>${escapeHtml(name)} · ${status}</small>
        </div>`;
      })
      .join("");
    els.leader.textContent = state.leader ? `${nicknameFor(room, state.leader)} 领先` : "EVEN";
    els.leadMeters.textContent = `${state.leadMeters.toFixed(1)}m`;
  }

  function renderRoomList(rooms: RoomSummary[]) {
    els.roomList.innerHTML = rooms.length === 0
      ? "<div class=\"empty\">暂无公开房间</div>"
      : rooms.map((room) => `<button type="button" data-room="${room.code}">
          <strong>${room.code}</strong>
          <span>${escapeHtml(room.hostNickname)} · ${room.playerCount}/${room.maxPlayers} · ${room.status}</span>
        </button>`).join("");
    for (const button of els.roomList.querySelectorAll<HTMLButtonElement>("[data-room]")) {
      button.addEventListener("click", () => {
        send({ type: "join-room", code: button.dataset.room ?? "" });
      });
    }
  }

  function controlledOnlinePlayers(room: RoomSnapshot) {
    const player = room.players.find((candidate) => candidate.clientId === clientId);
    return player ? [player.playerId] : [];
  }

  function nicknameFor(room: RoomSnapshot | null, playerId: PlayerId) {
    return room?.players.find((player) => player.playerId === playerId)?.nickname ?? playerNames[playerId];
  }

  function setOnlineButtons(enabled: boolean) {
    els.createRoom.disabled = !enabled;
    els.joinRoom.disabled = !enabled;
    els.refreshRooms.disabled = !enabled;
  }

  function setOnlineStatus(text: string) {
    els.onlineStatus.textContent = text;
  }

  function send(message: object) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function stopActiveRace() {
    if (isRacing) {
      window.dispatchEvent(new Event("game:stop"));
    }
    isRacing = false;
    latestState = null;
    els.result.classList.add("result--hidden");
  }
}

function getElements() {
  return {
    lobby: requireElement("lobby"),
    scoreboard: requireElement("scoreboard"),
    playerStats: requireElement("player-stats"),
    leader: requireElement("leader"),
    leadMeters: requireElement("lead-meters"),
    nickname: requireElement("nickname") as HTMLInputElement,
    modePicker: requireElement("mode-picker"),
    showLocal: requireElement("show-local") as HTMLButtonElement,
    showOnline: requireElement("show-online") as HTMLButtonElement,
    localPanel: requireElement("local-panel"),
    onlinePanel: requireElement("online-panel"),
    startLocal2: requireElement("start-local-2") as HTMLButtonElement,
    startLocal3: requireElement("start-local-3") as HTMLButtonElement,
    connectOnline: requireElement("connect-online") as HTMLButtonElement,
    createRoom: requireElement("create-room") as HTMLButtonElement,
    joinRoom: requireElement("join-room") as HTMLButtonElement,
    roomCode: requireElement("room-code") as HTMLInputElement,
    refreshRooms: requireElement("refresh-rooms") as HTMLButtonElement,
    roomList: requireElement("room-list"),
    onlineStatus: requireElement("online-status"),
    roomPanel: requireElement("room-panel"),
    roomMode: requireElement("room-mode"),
    roomTitle: requireElement("room-title"),
    roomCopy: requireElement("room-copy"),
    roomPlayers: requireElement("room-players"),
    startRoom: requireElement("start-room") as HTMLButtonElement,
    leaveRoom: requireElement("leave-room") as HTMLButtonElement,
    result: requireElement("result"),
    resultKicker: requireElement("result-kicker"),
    resultTitle: requireElement("result-title"),
    resultCopy: requireElement("result-copy"),
    restart: requireElement("restart") as HTMLButtonElement,
    game: requireElement("game"),
  };
}

function createWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function requireElement(id: string) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

function focusGameInput() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  const game = document.getElementById("game");
  if (game instanceof HTMLElement) {
    game.focus({ preventScroll: true });
  }
}
