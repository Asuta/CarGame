import { describe, expect, it } from "vitest";
import { RoomManager } from "./RoomManager";
import type { ClientMessage, ServerMessage } from "../src/net/protocol";

class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  messages: ServerMessage[] = [];

  send(raw: string) {
    this.messages.push(JSON.parse(raw) as ServerMessage);
  }
}

function connect(manager: RoomManager, nickname: string) {
  const socket = new FakeSocket();
  const clientId = manager.register(socket as never);
  manager.handleMessage(clientId, { type: "hello", nickname });
  return { clientId, socket };
}

function latest<T extends ServerMessage["type"]>(socket: FakeSocket, type: T) {
  return socket.messages.findLast((message) => message.type === type) as Extract<ServerMessage, { type: T }> | undefined;
}

describe("RoomManager", () => {
  it("creates rooms and exposes them in the public list", () => {
    const manager = new RoomManager();
    const host = connect(manager, "Host");

    manager.handleMessage(host.clientId, { type: "create-room" });

    const room = latest(host.socket, "room-update")?.room;
    expect(room?.players).toHaveLength(1);
    expect(room?.players[0].nickname).toBe("Host");
    expect(manager.listRooms()).toEqual([
      expect.objectContaining({ code: room?.code, hostNickname: "Host", playerCount: 1, status: "waiting" }),
    ]);
  });

  it("joins by room code and rejects the fourth player", () => {
    const manager = new RoomManager();
    const host = connect(manager, "Host");
    const p2 = connect(manager, "Two");
    const p3 = connect(manager, "Three");
    const p4 = connect(manager, "Four");
    manager.handleMessage(host.clientId, { type: "create-room" });
    const code = latest(host.socket, "room-update")?.room.code ?? "";

    manager.handleMessage(p2.clientId, { type: "join-room", code });
    manager.handleMessage(p3.clientId, { type: "join-room", code });
    manager.handleMessage(p4.clientId, { type: "join-room", code });

    expect(latest(host.socket, "room-update")?.room.players).toHaveLength(3);
    expect(latest(p4.socket, "error")?.message).toBe("房间已满。");
  });

  it("only lets the host start a race", () => {
    const manager = new RoomManager();
    const host = connect(manager, "Host");
    const guest = connect(manager, "Guest");
    manager.handleMessage(host.clientId, { type: "create-room" });
    const code = latest(host.socket, "room-update")?.room.code ?? "";
    manager.handleMessage(guest.clientId, { type: "join-room", code });

    manager.handleMessage(guest.clientId, { type: "start-race" });
    expect(latest(guest.socket, "error")?.message).toBe("只有房主可以开始比赛。");

    manager.handleMessage(host.clientId, { type: "start-race" });
    expect(latest(host.socket, "race-start")?.state.players).toHaveLength(2);
  });

  it("ignores input for another player's car", () => {
    const manager = new RoomManager();
    const host = connect(manager, "Host");
    const guest = connect(manager, "Guest");
    manager.handleMessage(host.clientId, { type: "create-room" });
    const code = latest(host.socket, "room-update")?.room.code ?? "";
    manager.handleMessage(guest.clientId, { type: "join-room", code });
    manager.handleMessage(host.clientId, { type: "start-race" });

    const badInput: ClientMessage = { type: "input", action: { type: "boost", playerId: "p2" } };
    manager.handleMessage(host.clientId, badInput);

    const state = latest(host.socket, "race-state")?.state ?? latest(host.socket, "race-start")?.state;
    expect(state?.players.find((player) => player.id === "p2")?.boostCount).toBe(0);
  });
});
