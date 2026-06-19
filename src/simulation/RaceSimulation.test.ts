import { describe, expect, it } from "vitest";
import { RaceSimulation, raceRules } from "./RaceSimulation";

describe("RaceSimulation", () => {
  it("starts playable without an immediate winner", () => {
    const simulation = new RaceSimulation();
    const state = simulation.getState();

    expect(state.winner).toBeNull();
    expect(state.endReason).toBeNull();
    expect(state.players.p1.speed).toBe(raceRules.initialSpeed);
    expect(state.players.p2.speed).toBe(raceRules.initialSpeed);
    expect(Math.min(...state.obstacles.map((obstacle) => obstacle.distanceMeters))).toBeGreaterThan(80);
  });

  it("clamps lane changes at road edges", () => {
    const simulation = new RaceSimulation();

    for (let index = 0; index < 8; index += 1) {
      simulation.applyAction({ type: "move-left", playerId: "p1" });
    }
    expect(simulation.getState().players.p1.lane).toBe(0);

    for (let index = 0; index < 8; index += 1) {
      simulation.applyAction({ type: "move-right", playerId: "p1" });
    }
    expect(simulation.getState().players.p1.lane).toBe(raceRules.laneCount - 1);
  });

  it("applies permanent boost increments without a hard cap", () => {
    const simulation = new RaceSimulation();

    for (let index = 0; index < 8; index += 1) {
      simulation.applyAction({ type: "boost", playerId: "p1" });
    }

    expect(simulation.getState().players.p1.boostCount).toBe(8);
    expect(simulation.getState().players.p1.speed).toBe(
      raceRules.initialSpeed + raceRules.boostIncrement * 8,
    );
  });

  it("ends when one player leads by 50 meters", () => {
    const simulation = new RaceSimulation();

    for (let index = 0; index < 7; index += 1) {
      simulation.applyAction({ type: "boost", playerId: "p1" });
    }
    simulation.update(2);

    expect(simulation.getState().winner).toBe("p1");
    expect(simulation.getState().endReason).toBe("lead");
    expect(simulation.getState().leadMeters).toBeGreaterThanOrEqual(raceRules.leadTargetMeters);
  });

  it("ends when a player hits traffic in the same lane", () => {
    const simulation = new RaceSimulation();
    const state = simulation.getState();
    state.players.p1.lane = 2;
    state.players.p1.distanceMeters = 100;
    state.obstacles = [{ id: 999, kind: "traffic", lane: 2, distanceMeters: 101 }];

    simulation.update(0.01);

    expect(state.players.p1.crashed).toBe(true);
    expect(state.winner).toBe("p2");
    expect(state.endReason).toBe("obstacle");
  });

  it("ends without a winner when players collide", () => {
    const simulation = new RaceSimulation();
    const state = simulation.getState();
    state.players.p1.lane = 2;
    state.players.p2.lane = 2;
    state.players.p1.distanceMeters = 12;
    state.players.p2.distanceMeters = 13;

    simulation.update(0.01);

    expect(state.players.p1.crashed).toBe(true);
    expect(state.players.p2.crashed).toBe(true);
    expect(state.winner).toBeNull();
    expect(state.endReason).toBe("player-collision");
  });
});
