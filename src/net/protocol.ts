import type { PlayerId, RaceAction, RaceState } from "../simulation/raceTypes";

export type RoomStatus = "waiting" | "racing";

export interface RoomPlayer {
  clientId: string;
  playerId: PlayerId;
  nickname: string;
  connected: boolean;
}

export interface RoomSummary {
  code: string;
  hostNickname: string;
  playerCount: number;
  maxPlayers: number;
  status: RoomStatus;
}

export interface RoomSnapshot {
  code: string;
  hostClientId: string;
  players: RoomPlayer[];
  status: RoomStatus;
  maxPlayers: number;
}

export type ClientMessage =
  | { type: "hello"; nickname: string }
  | { type: "list-rooms" }
  | { type: "create-room" }
  | { type: "join-room"; code: string }
  | { type: "start-race" }
  | { type: "input"; action: RaceAction };

export type ServerMessage =
  | { type: "welcome"; clientId: string }
  | { type: "room-list"; rooms: RoomSummary[] }
  | { type: "room-update"; room: RoomSnapshot }
  | { type: "race-start"; room: RoomSnapshot; state: RaceState }
  | { type: "race-state"; state: RaceState }
  | { type: "race-end"; room: RoomSnapshot; state: RaceState }
  | { type: "error"; message: string };
