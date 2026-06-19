import { describe, expect, it } from "vitest";
import { RaceSimulation, raceRules } from "./RaceSimulation";

describe("RaceSimulation", () => {
  it("starts playable with two players by default", () => {
    const simulation = new RaceSimulation();
    const state = simulation.getState();

    expect(state.players.map((player) => player.id)).toEqual(["p1", "p2"]);
    expect(state.winner).toBeNull();
    expect(state.endReason).toBeNull();
    expect(state.players[0].speed).toBe(raceRules.initialSpeed);
    expect(state.players[1].speed).toBe(raceRules.initialSpeed);
    expect(Math.min(...state.obstacles.map((obstacle) => obstacle.distanceMeters))).toBeGreaterThan(80);
  });

  it("supports three-player races", () => {
    const simulation = new RaceSimulation(3);
    const state = simulation.getState();

    expect(state.players.map((player) => player.id)).toEqual(["p1", "p2", "p3"]);
    expect(state.players.map((player) => player.lane)).toEqual([1, 3, 2]);
  });

  it("clamps lane changes at road edges", () => {
    const simulation = new RaceSimulation(3);

    for (let index = 0; index < 8; index += 1) {
      simulation.applyAction({ type: "move-left", playerId: "p3" });
    }
    expect(simulation.getState().players.find((player) => player.id === "p3")?.lane).toBe(0);

    for (let index = 0; index < 8; index += 1) {
      simulation.applyAction({ type: "move-right", playerId: "p3" });
    }
    expect(simulation.getState().players.find((player) => player.id === "p3")?.lane).toBe(raceRules.laneCount - 1);
  });

  it("applies permanent boost increments without a hard cap", () => {
    const simulation = new RaceSimulation();

    for (let index = 0; index < 8; index += 1) {
      simulation.applyAction({ type: "boost", playerId: "p1" });
    }

    const p1 = simulation.getState().players.find((player) => player.id === "p1");
    expect(p1?.boostCount).toBe(8);
    expect(p1?.speed).toBe(raceRules.initialSpeed + raceRules.boostIncrement * 8);
  });

  it("ends when one active player leads every other active player by 50 meters", () => {
    const simulation = new RaceSimulation(3);

    for (let index = 0; index < 9; index += 1) {
      simulation.applyAction({ type: "boost", playerId: "p1" });
    }
    simulation.update(2);

    expect(simulation.getState().winner).toBe("p1");
    expect(simulation.getState().endReason).toBe("lead");
    expect(simulation.getState().leadMeters).toBeGreaterThanOrEqual(raceRules.leadTargetMeters);
  });

  it("eliminates a traffic-crashed player and lets remaining players continue", () => {
    const simulation = new RaceSimulation(3);
    const state = simulation.getState();
    const p1 = state.players.find((player) => player.id === "p1");
    if (!p1) {
      throw new Error("Missing p1");
    }

    p1.lane = 2;
    p1.distanceMeters = 100;
    state.obstacles = [{ id: 999, kind: "traffic", lane: 2, distanceMeters: 101 }];

    simulation.update(0.01);

    expect(p1.crashed).toBe(true);
    expect(state.winner).toBeNull();
    expect(state.endReason).toBeNull();
  });

  it("ends after eliminations leave one player active", () => {
    const simulation = new RaceSimulation(3);
    simulation.eliminatePlayer("p1", "obstacle");
    simulation.eliminatePlayer("p2", "disconnect");

    expect(simulation.getState().winner).toBe("p3");
    expect(simulation.getState().endReason).toBe("disconnect");
  });

  it("ignores overlap between player cars", () => {
    const simulation = new RaceSimulation(3);
    const state = simulation.getState();
    for (const player of state.players) {
      player.lane = 2;
      player.distanceMeters = 12;
    }

    simulation.update(0.01);

    expect(state.players.every((player) => !player.crashed)).toBe(true);
    expect(state.winner).toBeNull();
    expect(state.endReason).toBeNull();
  });
});
