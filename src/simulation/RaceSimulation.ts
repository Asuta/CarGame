import type { PlayerId, RaceAction, RaceState } from "./raceTypes";

const LANE_COUNT = 5;
const INITIAL_SPEED = 30;
const BOOST_INCREMENT = 15;
const LEAD_TARGET_METERS = 50;
const OBSTACLE_COLLISION_METERS = 3.6;
const OBSTACLE_SPAWN_AHEAD_METERS = 230;
const OBSTACLE_CLEANUP_BEHIND_METERS = 24;
const FIRST_OBSTACLE_AT_METERS = 90;
const OBSTACLE_BAND_STEP_METERS = 15;

export const raceRules = {
  laneCount: LANE_COUNT,
  initialSpeed: INITIAL_SPEED,
  boostIncrement: BOOST_INCREMENT,
  leadTargetMeters: LEAD_TARGET_METERS,
};

export class RaceSimulation {
  private state: RaceState;
  private nextObstacleId = 1;
  private nextObstacleDistance = FIRST_OBSTACLE_AT_METERS;
  private randomSeed = 0x6d2b79f5;

  constructor() {
    this.state = this.createInitialState();
    this.seedInitialTraffic();
  }

  getState(): RaceState {
    return this.state;
  }

  reset() {
    this.nextObstacleId = 1;
    this.nextObstacleDistance = FIRST_OBSTACLE_AT_METERS;
    this.randomSeed = 0x6d2b79f5;
    this.state = this.createInitialState();
    this.seedInitialTraffic();
  }

  applyAction(action: RaceAction) {
    if (this.state.winner !== null || this.state.endReason !== null) {
      return;
    }

    const player = this.state.players[action.playerId];
    if (action.type === "move-left") {
      player.lane = Math.max(0, player.lane - 1);
      return;
    }

    if (action.type === "move-right") {
      player.lane = Math.min(LANE_COUNT - 1, player.lane + 1);
      return;
    }

    player.speed += BOOST_INCREMENT;
    player.boostCount += 1;
  }

  update(deltaSeconds: number) {
    if (this.state.winner !== null || this.state.endReason !== null) {
      return;
    }

    this.state.elapsedSeconds += deltaSeconds;
    this.state.players.p1.distanceMeters += this.speedToMetersPerSecond(this.state.players.p1.speed) * deltaSeconds;
    this.state.players.p2.distanceMeters += this.speedToMetersPerSecond(this.state.players.p2.speed) * deltaSeconds;

    this.updateLead();
    this.ensureTrafficAhead();
    this.cleanupTraffic();
    this.checkObstacleCollisions();
    if (this.state.endReason !== null) {
      return;
    }
    this.checkLeadWin();
  }

  private createInitialState(): RaceState {
    return {
      players: {
        p1: {
          id: "p1",
          lane: 1,
          distanceMeters: 0,
          speed: INITIAL_SPEED,
          crashed: false,
          boostCount: 0,
        },
        p2: {
          id: "p2",
          lane: 3,
          distanceMeters: 0,
          speed: INITIAL_SPEED,
          crashed: false,
          boostCount: 0,
        },
      },
      obstacles: [],
      winner: null,
      endReason: null,
      leadMeters: 0,
      leader: null,
      elapsedSeconds: 0,
    };
  }

  private speedToMetersPerSecond(speed: number) {
    return speed / 3.6;
  }

  private updateLead() {
    const diff = this.state.players.p1.distanceMeters - this.state.players.p2.distanceMeters;
    this.state.leadMeters = Math.abs(diff);
    if (Math.abs(diff) < 0.05) {
      this.state.leader = null;
      return;
    }

    this.state.leader = diff > 0 ? "p1" : "p2";
  }

  private seedInitialTraffic() {
    this.ensureTrafficAhead();
  }

  private ensureTrafficAhead() {
    const furthestPlayerDistance = Math.max(
      this.state.players.p1.distanceMeters,
      this.state.players.p2.distanceMeters,
    );

    while (this.nextObstacleDistance < furthestPlayerDistance + OBSTACLE_SPAWN_AHEAD_METERS) {
      this.spawnObstacleBand(this.nextObstacleDistance);
      const jitter = this.nextRandom() * 6 - 3;
      this.nextObstacleDistance += OBSTACLE_BAND_STEP_METERS + jitter;
    }
  }

  private spawnObstacleBand(distanceMeters: number) {
    const safeLane = Math.floor(this.nextRandom() * LANE_COUNT);
    const densityRoll = this.nextRandom();
    const targetCount = densityRoll > 0.82 ? 3 : densityRoll > 0.42 ? 2 : 1;
    const lanes = this.shuffleLanes().filter((lane) => lane !== safeLane).slice(0, targetCount);

    for (const lane of lanes) {
      this.state.obstacles.push({
        id: this.nextObstacleId,
        lane,
        distanceMeters: distanceMeters + this.nextRandom() * 2.5,
        kind: "traffic",
      });
      this.nextObstacleId += 1;
    }
  }

  private shuffleLanes() {
    const lanes = Array.from({ length: LANE_COUNT }, (_, index) => index);
    for (let index = lanes.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.nextRandom() * (index + 1));
      [lanes[index], lanes[swapIndex]] = [lanes[swapIndex], lanes[index]];
    }
    return lanes;
  }

  private cleanupTraffic() {
    const closestPlayerDistance = Math.min(
      this.state.players.p1.distanceMeters,
      this.state.players.p2.distanceMeters,
    );
    this.state.obstacles = this.state.obstacles.filter(
      (obstacle) => obstacle.distanceMeters > closestPlayerDistance - OBSTACLE_CLEANUP_BEHIND_METERS,
    );
  }

  private checkObstacleCollisions() {
    for (const player of Object.values(this.state.players)) {
      const hit = this.state.obstacles.some(
        (obstacle) =>
          obstacle.lane === player.lane &&
          Math.abs(obstacle.distanceMeters - player.distanceMeters) < OBSTACLE_COLLISION_METERS,
      );

      if (hit) {
        player.crashed = true;
        this.state.endReason = "obstacle";
        this.state.winner = this.otherPlayer(player.id);
        return;
      }
    }
  }

  private checkLeadWin() {
    if (this.state.leader !== null && this.state.leadMeters >= LEAD_TARGET_METERS) {
      this.state.winner = this.state.leader;
      this.state.endReason = "lead";
    }
  }

  private otherPlayer(playerId: PlayerId): PlayerId {
    return playerId === "p1" ? "p2" : "p1";
  }

  private nextRandom() {
    this.randomSeed += 0x6d2b79f5;
    let value = this.randomSeed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}
