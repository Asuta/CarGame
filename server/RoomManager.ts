import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { RaceSimulation } from "../src/simulation/RaceSimulation";
import type { PlayerId, RaceAction } from "../src/simulation/raceTypes";
import type { ClientMessage, RoomPlayer, RoomSnapshot, RoomStatus, RoomSummary, ServerMessage } from "../src/net/protocol";

const MAX_PLAYERS = 3;
const TICK_SECONDS = 1 / 20;
const PLAYER_IDS: PlayerId[] = ["p1", "p2", "p3"];

interface Client {
  id: string;
  nickname: string;
  socket: WebSocket;
  roomCode: string | null;
}

interface Room {
  code: string;
  hostClientId: string;
  players: RoomPlayer[];
  status: RoomStatus;
  simulation: RaceSimulation | null;
  lastTickMs: number;
}

export class RoomManager {
  private readonly clients = new Map<string, Client>();
  private readonly rooms = new Map<string, Room>();

  register(socket: WebSocket) {
    const client: Client = {
      id: this.createId(),
      nickname: "Player",
      socket,
      roomCode: null,
    };
    this.clients.set(client.id, client);
    this.send(client, { type: "welcome", clientId: client.id });
    return client.id;
  }

  unregister(clientId: string) {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    this.handleDisconnect(client);
    this.clients.delete(clientId);
    this.broadcastRoomList();
  }

  handleMessage(clientId: string, message: ClientMessage) {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    switch (message.type) {
      case "hello":
        client.nickname = this.normalizeNickname(message.nickname);
        this.send(client, { type: "welcome", clientId: client.id });
        this.broadcastRoomList();
        return;
      case "list-rooms":
        this.sendRoomList(client);
        return;
      case "create-room":
        this.createRoom(client);
        return;
      case "join-room":
        this.joinRoom(client, message.code);
        return;
      case "start-race":
        this.startRace(client);
        return;
      case "input":
        this.applyInput(client, message.action);
        return;
      default:
        this.sendError(client, "无法识别的消息。");
    }
  }

  tick(nowMs = Date.now()) {
    for (const room of this.rooms.values()) {
      if (room.status !== "racing" || !room.simulation) {
        continue;
      }

      const elapsedSeconds = Math.min((nowMs - room.lastTickMs) / 1000, 0.1);
      if (elapsedSeconds < TICK_SECONDS) {
        continue;
      }

      room.lastTickMs = nowMs;
      room.simulation.update(elapsedSeconds);
      this.broadcastToRoom(room, { type: "race-state", state: room.simulation.getState() });

      if (room.simulation.getState().endReason) {
        this.finishRace(room);
      }
    }
  }

  listRooms(): RoomSummary[] {
    return Array.from(this.rooms.values())
      .filter((room) => room.status === "waiting" || room.status === "racing")
      .map((room) => {
        const host = room.players.find((player) => player.clientId === room.hostClientId);
        return {
          code: room.code,
          hostNickname: host?.nickname ?? "Unknown",
          playerCount: room.players.filter((player) => player.connected).length,
          maxPlayers: MAX_PLAYERS,
          status: room.status,
        };
      });
  }

  private createRoom(client: Client) {
    this.leaveCurrentRoom(client);
    const code = this.createRoomCode();
    const room: Room = {
      code,
      hostClientId: client.id,
      players: [this.createRoomPlayer(client, "p1")],
      status: "waiting",
      simulation: null,
      lastTickMs: Date.now(),
    };
    client.roomCode = code;
    this.rooms.set(code, room);
    this.broadcastRoomUpdate(room);
    this.broadcastRoomList();
  }

  private joinRoom(client: Client, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      this.sendError(client, "房间不存在。");
      return;
    }
    if (room.status !== "waiting") {
      this.sendError(client, "比赛已经开始，不能加入。");
      return;
    }
    if (room.players.filter((player) => player.connected).length >= MAX_PLAYERS) {
      this.sendError(client, "房间已满。");
      return;
    }

    this.leaveCurrentRoom(client);
    const playerId = this.nextPlayerId(room);
    if (!playerId) {
      this.sendError(client, "房间已满。");
      return;
    }

    room.players.push(this.createRoomPlayer(client, playerId));
    client.roomCode = room.code;
    this.reassignPlayerIds(room);
    this.broadcastRoomUpdate(room);
    this.broadcastRoomList();
  }

  private startRace(client: Client) {
    const room = this.findClientRoom(client);
    if (!room) {
      this.sendError(client, "你还没有进入房间。");
      return;
    }
    if (room.hostClientId !== client.id) {
      this.sendError(client, "只有房主可以开始比赛。");
      return;
    }
    const connectedPlayers = room.players.filter((player) => player.connected);
    if (connectedPlayers.length < 2) {
      this.sendError(client, "至少需要 2 名玩家。");
      return;
    }

    room.players = connectedPlayers;
    this.reassignPlayerIds(room);
    room.status = "racing";
    room.simulation = new RaceSimulation(room.players.length);
    room.lastTickMs = Date.now();
    const snapshot = this.snapshotRoom(room);
    const state = room.simulation.getState();
    this.broadcastToRoom(room, { type: "race-start", room: snapshot, state });
    this.broadcastRoomList();
  }

  private applyInput(client: Client, action: RaceAction) {
    const room = this.findClientRoom(client);
    if (!room || room.status !== "racing" || !room.simulation) {
      return;
    }

    const roomPlayer = room.players.find((player) => player.clientId === client.id && player.connected);
    if (!roomPlayer || action.playerId !== roomPlayer.playerId) {
      return;
    }

    room.simulation.applyAction(action);
    this.broadcastToRoom(room, { type: "race-state", state: room.simulation.getState() });
  }

  private handleDisconnect(client: Client) {
    const room = this.findClientRoom(client);
    if (!room) {
      return;
    }

    const player = room.players.find((candidate) => candidate.clientId === client.id);
    if (player) {
      player.connected = false;
    }

    if (room.status === "racing" && room.simulation && player) {
      room.simulation.eliminatePlayer(player.playerId, "disconnect");
      this.broadcastToRoom(room, { type: "race-state", state: room.simulation.getState() });
      if (room.simulation.getState().endReason) {
        this.finishRace(room);
      }
      return;
    }

    room.players = room.players.filter((candidate) => candidate.connected);
    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return;
    }

    if (room.hostClientId === client.id) {
      room.hostClientId = room.players[0].clientId;
    }
    this.reassignPlayerIds(room);
    this.broadcastRoomUpdate(room);
  }

  private finishRace(room: Room) {
    const state = room.simulation?.getState();
    if (!state) {
      return;
    }

    room.status = "waiting";
    room.simulation = null;
    room.players = room.players.filter((player) => player.connected);
    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      this.broadcastRoomList();
      return;
    }

    this.reassignPlayerIds(room);
    this.broadcastToRoom(room, { type: "race-end", room: this.snapshotRoom(room), state });
    this.broadcastRoomUpdate(room);
    this.broadcastRoomList();
  }

  private leaveCurrentRoom(client: Client) {
    const room = this.findClientRoom(client);
    if (!room) {
      return;
    }

    room.players = room.players.filter((player) => player.clientId !== client.id);
    client.roomCode = null;

    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return;
    }

    if (room.hostClientId === client.id) {
      room.hostClientId = room.players[0].clientId;
    }
    this.reassignPlayerIds(room);
    this.broadcastRoomUpdate(room);
  }

  private findClientRoom(client: Client) {
    return client.roomCode ? this.rooms.get(client.roomCode) ?? null : null;
  }

  private createRoomPlayer(client: Client, playerId: PlayerId): RoomPlayer {
    return {
      clientId: client.id,
      playerId,
      nickname: client.nickname,
      connected: true,
    };
  }

  private nextPlayerId(room: Room): PlayerId | null {
    const used = new Set(room.players.map((player) => player.playerId));
    return PLAYER_IDS.find((id) => !used.has(id)) ?? null;
  }

  private reassignPlayerIds(room: Room) {
    room.players.forEach((player, index) => {
      player.playerId = PLAYER_IDS[index];
    });
  }

  private snapshotRoom(room: Room): RoomSnapshot {
    return {
      code: room.code,
      hostClientId: room.hostClientId,
      players: room.players,
      status: room.status,
      maxPlayers: MAX_PLAYERS,
    };
  }

  private broadcastRoomUpdate(room: Room) {
    this.broadcastToRoom(room, { type: "room-update", room: this.snapshotRoom(room) });
  }

  private broadcastRoomList() {
    const message: ServerMessage = { type: "room-list", rooms: this.listRooms() };
    for (const client of this.clients.values()) {
      this.send(client, message);
    }
  }

  private sendRoomList(client: Client) {
    this.send(client, { type: "room-list", rooms: this.listRooms() });
  }

  private broadcastToRoom(room: Room, message: ServerMessage) {
    for (const player of room.players) {
      if (!player.connected) {
        continue;
      }
      const client = this.clients.get(player.clientId);
      if (client) {
        this.send(client, message);
      }
    }
  }

  private sendError(client: Client, message: string) {
    this.send(client, { type: "error", message });
  }

  private send(client: Client, message: ServerMessage) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  private normalizeNickname(nickname: string) {
    const trimmed = nickname.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 16) : "Player";
  }

  private createId() {
    return randomBytes(8).toString("hex");
  }

  private createRoomCode() {
    let code = "";
    do {
      code = randomBytes(3).toString("hex").toUpperCase();
    } while (this.rooms.has(code));
    return code;
  }
}
