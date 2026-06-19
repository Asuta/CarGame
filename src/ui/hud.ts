import type { RaceState } from "../simulation/raceTypes";

export function bindHud() {
  const p1Speed = requireElement("p1-speed");
  const p2Speed = requireElement("p2-speed");
  const p1Boosts = requireElement("p1-boosts");
  const p2Boosts = requireElement("p2-boosts");
  const leader = requireElement("leader");
  const leadMeters = requireElement("lead-meters");
  const result = requireElement("result");
  const resultTitle = requireElement("result-title");
  const resultCopy = requireElement("result-copy");
  const resultKicker = requireElement("result-kicker");
  const restart = requireElement("restart") as HTMLButtonElement;

  window.addEventListener("race:update", (event) => {
    const state = (event as CustomEvent<RaceState>).detail;
    p1Speed.textContent = Math.round(state.players.p1.speed).toString();
    p2Speed.textContent = Math.round(state.players.p2.speed).toString();
    p1Boosts.textContent = `BOOST ${state.players.p1.boostCount}`;
    p2Boosts.textContent = `BOOST ${state.players.p2.boostCount}`;
    leader.textContent = state.leader ? `${state.leader.toUpperCase()} LEADS` : "EVEN";
    leadMeters.textContent = `${state.leadMeters.toFixed(1)}m`;

    if (!state.endReason) {
      result.classList.add("result--hidden");
      return;
    }

    result.classList.remove("result--hidden");
    resultKicker.textContent = state.endReason === "player-collision" ? "DOUBLE CRASH" : "RACE OVER";
    if (state.winner) {
      resultTitle.textContent = `${state.winner.toUpperCase()} WINS`;
    } else {
      resultTitle.textContent = "NO WINNER";
    }
    resultCopy.textContent = createResultCopy(state);
  });

  restart.addEventListener("click", () => {
    window.dispatchEvent(new Event("race:restart"));
  });
}

function createResultCopy(state: RaceState) {
  if (state.endReason === "lead") {
    return `${state.winner?.toUpperCase()} 率先领先 50 米。`;
  }
  if (state.endReason === "obstacle") {
    const crashed = state.players.p1.crashed ? "P1" : "P2";
    return `${crashed} 撞上了前方车辆。`;
  }
  return "两辆玩家车发生碰撞，本局结束。";
}

function requireElement(id: string) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element;
}
