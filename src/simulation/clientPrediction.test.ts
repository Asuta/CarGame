import { describe, expect, it } from "vitest";
import {
  advancePredictedState,
  applyPredictedAction,
  mergePredictedState,
} from "./clientPrediction";
import type { PlayerId, RaceState } from "./raceTypes";

describe("client prediction", () => {
  it("advances active cars locally between server snapshots", () => {
    const state = makeState();

    const predicted = advancePredictedState(state, 0.5);

    expect(predicted.players[0].distanceMeters).toBeCloseTo(30 / 3.6 * 0.5);
    expect(predicted.players[1].distanceMeters).toBeCloseTo(30 / 3.6 * 0.5);
  });

  it("applies controlled input immediately", () => {
    const state = makeState();

    const moved = applyPredictedAction(state, { type: "move-left", playerId: "p2" });
    const boosted = applyPredictedAction(moved, { type: "boost", playerId: "p2" });
    const player = boosted.players.find((candidate) => candidate.id === "p2");

    expect(player?.lane).toBe(2);
    expect(player?.speed).toBe(45);
    expect(player?.boostCount).toBe(1);
  });

  it("keeps a controlled car ahead of stale server snapshots", () => {
    const current = makeState();
    current.players[1].lane = 2;
    current.players[1].distanceMeters = 8;
    current.players[1].speed = 45;
    current.players[1].boostCount = 1;

    const staleServer = makeState();
    staleServer.players[1].lane = 3;
    staleServer.players[1].distanceMeters = 2;
    staleServer.players[1].speed = 30;
    staleServer.players[1].boostCount = 0;

    const merged = mergePredictedState(current, staleServer, new Set<PlayerId>(["p2"]));
    const player = merged.players.find((candidate) => candidate.id === "p2");

    expect(player?.lane).toBe(2);
    expect(player?.distanceMeters).toBe(8);
    expect(player?.speed).toBe(45);
    expect(player?.boostCount).toBe(1);
  });

  it("still accepts server-authoritative crashes for controlled cars", () => {
    const current = makeState();
    current.players[1].distanceMeters = 12;
    current.players[1].speed = 45;

    const server = makeState();
    server.players[1].crashed = true;

    const merged = mergePredictedState(current, server, new Set<PlayerId>(["p2"]));
    const player = merged.players.find((candidate) => candidate.id === "p2");

    expect(player?.crashed).toBe(true);
    expect(player?.speed).toBe(30);
  });

  it("uses final server state exactly when the race ends", () => {
    const current = makeState();
    current.players[1].distanceMeters = 99;

    const server = makeState();
    server.players[0].distanceMeters = 50;
    server.players[1].distanceMeters = 10;
    server.winner = "p1";
    server.endReason = "lead";

    const merged = mergePredictedState(current, server, new Set<PlayerId>(["p2"]));

    expect(merged.players[1].distanceMeters).toBe(10);
    expect(merged.winner).toBe("p1");
    expect(merged.endReason).toBe("lead");
  });
});

function makeState(): RaceState {
  return {
    players: [
      makePlayer("p1", 1),
      makePlayer("p2", 3),
    ],
    obstacles: [],
    winner: null,
    endReason: null,
    leadMeters: 0,
    leader: null,
    elapsedSeconds: 0,
  };
}

function makePlayer(id: PlayerId, lane: number) {
  return {
    id,
    lane,
    distanceMeters: 0,
    speed: 30,
    crashed: false,
    boostCount: 0,
  };
}
