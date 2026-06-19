import type { EndReason, PlayerId, RaceAction, RaceState } from "./raceTypes";

const LANE_COUNT = 5;
const INITIAL_SPEED = 30;
const BOOST_INCREMENT = 15;
const LEAD_TARGET_METERS = 50;
const OBSTACLE_COLLISION_METERS = 3.6;
const OBSTACLE_SPAWN_AHEAD_METERS = 230;
const OBSTACLE_CLEANUP_BEHIND_METERS = 24;
const FIRST_OBSTACLE_AT_METERS = 90;
const OBSTACLE_BAND_STEP_METERS = 15;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 3;
const PLAYER_IDS: PlayerId[] = ["p1", "p2", "p3"];
const INITIAL_LANES: Record<PlayerId, number> = {
  p1: 1,
  p2: 3,
  p3: 2,
};

export const raceRules = {
  laneCount: LANE_COUNT,
  initialSpeed: INITIAL_SPEED,
  boostIncrement: BOOST_INCREMENT,
  leadTargetMeters: LEAD_TARGET_METERS,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  playerIds: PLAYER_IDS,
};

export class RaceSimulation {
  private state: RaceState;
  private nextObstacleId = 1;
  private nextObstacleDistance = FIRST_OBSTACLE_AT_METERS;
  private randomSeed = 0x6d2b79f5;
  private readonly playerCount: number;

  constructor(playerCount = MIN_PLAYERS) {
    this.playerCount = this.normalizePlayerCount(playerCount);
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

    const player = this.findPlayer(action.playerId);
    if (!player || player.crashed) {
      return;
    }

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

  eliminatePlayer(playerId: PlayerId, reason: EndReason) {
    if (this.state.winner !== null || this.state.endReason !== null) {
      return;
    }

    const player = this.findPlayer(playerId);
    if (!player || player.crashed) {
      return;
    }

    player.crashed = true;
    this.resolveElimination(reason);
  }

  update(deltaSeconds: number) {
    if (this.state.winner !== null || this.state.endReason !== null) {
      return;
    }

    this.state.elapsedSeconds += deltaSeconds;
    for (const player of this.activePlayers()) {
      player.distanceMeters += this.speedToMetersPerSecond(player.speed) * deltaSeconds;
    }

    this.updateLead();
    this.ensureTrafficAhead();
    this.cleanupTraffic();
    this.checkObstacleCollisions();
    if (this.state.endReason !== null) {
      return;
    }
    this.checkLeadWin();
  }

  private normalizePlayerCount(playerCount: number) {
    return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(playerCount)));
  }

  private createInitialState(): RaceState {
    return {
      players: PLAYER_IDS.slice(0, this.playerCount).map((id) => ({
        id,
        lane: INITIAL_LANES[id],
        distanceMeters: 0,
        speed: INITIAL_SPEED,
        crashed: false,
        boostCount: 0,
      })),
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

  private activePlayers() {
    return this.state.players.filter((player) => !player.crashed);
  }

  private findPlayer(playerId: PlayerId) {
    return this.state.players.find((player) => player.id === playerId);
  }

  private updateLead() {
    const active = this.activePlayers().sort((a, b) => b.distanceMeters - a.distanceMeters);
    if (active.length === 0) {
      this.state.leader = null;
      this.state.leadMeters = 0;
      return;
    }

    this.state.leader = active[0].id;
    this.state.leadMeters = active.length > 1 ? active[0].distanceMeters - active[1].distanceMeters : 0;
    if (this.state.leadMeters < 0.05) {
      this.state.leader = null;
      this.state.leadMeters = 0;
    }
  }

  private seedInitialTraffic() {
    this.ensureTrafficAhead();
  }

  private ensureTrafficAhead() {
    const active = this.activePlayers();
    const furthestPlayerDistance = active.length > 0
      ? Math.max(...active.map((player) => player.distanceMeters))
      : 0;

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
    const active = this.activePlayers();
    if (active.length === 0) {
      return;
    }

    const closestPlayerDistance = Math.min(...active.map((player) => player.distanceMeters));
    this.state.obstacles = this.state.obstacles.filter(
      (obstacle) => obstacle.distanceMeters > closestPlayerDistance - OBSTACLE_CLEANUP_BEHIND_METERS,
    );
  }

  private checkObstacleCollisions() {
    const hitPlayerIds = new Set<PlayerId>();
    for (const player of this.activePlayers()) {
      const hit = this.state.obstacles.some(
        (obstacle) =>
          obstacle.lane === player.lane &&
          Math.abs(obstacle.distanceMeters - player.distanceMeters) < OBSTACLE_COLLISION_METERS,
      );

      if (hit) {
        hitPlayerIds.add(player.id);
      }
    }

    for (const playerId of hitPlayerIds) {
      const player = this.findPlayer(playerId);
      if (player) {
        player.crashed = true;
      }
    }

    if (hitPlayerIds.size > 0) {
      this.resolveElimination("obstacle");
    }
  }

  private resolveElimination(reason: EndReason) {
    const active = this.activePlayers();
    if (active.length === 1) {
      this.state.winner = active[0].id;
      this.state.endReason = reason;
      return;
    }

    if (active.length === 0) {
      this.state.winner = null;
      this.state.endReason = reason;
      return;
    }

    this.updateLead();
  }

  private checkLeadWin() {
    if (this.state.leader !== null && this.state.leadMeters >= LEAD_TARGET_METERS) {
      this.state.winner = this.state.leader;
      this.state.endReason = "lead";
    }
  }

  private nextRandom() {
    this.randomSeed += 0x6d2b79f5;
    let value = this.randomSeed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}
