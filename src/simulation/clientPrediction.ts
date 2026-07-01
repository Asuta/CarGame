import { raceRules } from "./RaceSimulation";
import type { PlayerId, PlayerState, RaceAction, RaceState } from "./raceTypes";

const DISTANCE_SNAP_METERS = 12;
const REMOTE_DISTANCE_BLEND = 0.45;

export function cloneRaceState(state: RaceState): RaceState {
  return {
    players: state.players.map((player) => ({ ...player })),
    obstacles: state.obstacles.map((obstacle) => ({ ...obstacle })),
    winner: state.winner,
    endReason: state.endReason,
    leadMeters: state.leadMeters,
    leader: state.leader,
    elapsedSeconds: state.elapsedSeconds,
  };
}

export function advancePredictedState(state: RaceState, deltaSeconds: number): RaceState {
  const next = cloneRaceState(state);
  if (next.endReason !== null) {
    return next;
  }

  const elapsedSeconds = Math.max(0, deltaSeconds);
  next.elapsedSeconds += elapsedSeconds;
  for (const player of next.players) {
    if (!player.crashed) {
      player.distanceMeters += speedToMetersPerSecond(player.speed) * elapsedSeconds;
    }
  }

  return updateDisplayLead(next);
}

export function applyPredictedAction(state: RaceState, action: RaceAction): RaceState {
  const next = cloneRaceState(state);
  if (next.endReason !== null) {
    return next;
  }

  const player = next.players.find((candidate) => candidate.id === action.playerId);
  if (!player || player.crashed) {
    return next;
  }

  if (action.type === "move-left") {
    player.lane = Math.max(0, player.lane - 1);
  } else if (action.type === "move-right") {
    player.lane = Math.min(raceRules.laneCount - 1, player.lane + 1);
  } else {
    player.speed += raceRules.boostIncrement;
    player.boostCount += 1;
  }

  return updateDisplayLead(next);
}

export function mergePredictedState(
  currentState: RaceState,
  serverState: RaceState,
  controlledPlayerIds: ReadonlySet<PlayerId>,
): RaceState {
  if (serverState.endReason !== null) {
    return cloneRaceState(serverState);
  }

  const currentPlayers = new Map(currentState.players.map((player) => [player.id, player]));
  const next: RaceState = {
    players: serverState.players.map((serverPlayer) =>
      mergePlayerState(currentPlayers.get(serverPlayer.id), serverPlayer, controlledPlayerIds.has(serverPlayer.id)),
    ),
    obstacles: serverState.obstacles.map((obstacle) => ({ ...obstacle })),
    winner: serverState.winner,
    endReason: serverState.endReason,
    leadMeters: serverState.leadMeters,
    leader: serverState.leader,
    elapsedSeconds: Math.max(currentState.elapsedSeconds, serverState.elapsedSeconds),
  };

  return updateDisplayLead(next);
}

function mergePlayerState(
  currentPlayer: PlayerState | undefined,
  serverPlayer: PlayerState,
  isControlled: boolean,
): PlayerState {
  if (!currentPlayer || serverPlayer.crashed) {
    return { ...serverPlayer };
  }

  if (isControlled) {
    return {
      ...serverPlayer,
      lane: currentPlayer.lane,
      distanceMeters: Math.max(currentPlayer.distanceMeters, serverPlayer.distanceMeters),
      speed: Math.max(currentPlayer.speed, serverPlayer.speed),
      boostCount: Math.max(currentPlayer.boostCount, serverPlayer.boostCount),
    };
  }

  return {
    ...serverPlayer,
    distanceMeters: blendRemoteDistance(currentPlayer.distanceMeters, serverPlayer.distanceMeters),
  };
}

function blendRemoteDistance(currentDistance: number, serverDistance: number) {
  const delta = serverDistance - currentDistance;
  if (Math.abs(delta) > DISTANCE_SNAP_METERS) {
    return serverDistance;
  }
  return currentDistance + delta * REMOTE_DISTANCE_BLEND;
}

function updateDisplayLead(state: RaceState): RaceState {
  const active = state.players.filter((player) => !player.crashed).sort((a, b) => b.distanceMeters - a.distanceMeters);
  if (active.length === 0) {
    state.leader = null;
    state.leadMeters = 0;
    return state;
  }

  state.leader = active[0].id;
  state.leadMeters = active.length > 1 ? active[0].distanceMeters - active[1].distanceMeters : 0;
  if (state.leadMeters < 0.05) {
    state.leader = null;
    state.leadMeters = 0;
  }
  return state;
}

function speedToMetersPerSecond(speed: number) {
  return speed / 3.6;
}
