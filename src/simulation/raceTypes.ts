export type PlayerId = "p1" | "p2";

export type EndReason = "lead" | "obstacle" | "player-collision";

export interface PlayerState {
  id: PlayerId;
  lane: number;
  distanceMeters: number;
  speed: number;
  crashed: boolean;
  boostCount: number;
}

export interface ObstacleState {
  id: number;
  lane: number;
  distanceMeters: number;
  kind: "traffic";
}

export interface RaceState {
  players: Record<PlayerId, PlayerState>;
  obstacles: ObstacleState[];
  winner: PlayerId | null;
  endReason: EndReason | null;
  leadMeters: number;
  leader: PlayerId | null;
  elapsedSeconds: number;
}

export type RaceAction =
  | { type: "move-left"; playerId: PlayerId }
  | { type: "move-right"; playerId: PlayerId }
  | { type: "boost"; playerId: PlayerId };
