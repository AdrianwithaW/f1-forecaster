// Pure projection maths: given current standings + predicted results, work out
// projected driver and constructor standings.

import { pointsForPosition } from "./points.js";

// Remaining races = scheduled rounds after the last completed round.
export function remainingRaces(schedule, completedRound) {
  return schedule
    .filter((r) => r.round > completedRound)
    .sort((a, b) => a.round - b.round);
}

// Predicted points a single round adds to each driver.
// Returns Map<driverId, points>.
export function pointsFromRound(prediction, race, points) {
  const out = new Map();
  if (!prediction) return out;

  const add = (driverId, pts) => {
    if (!driverId) return;
    out.set(driverId, (out.get(driverId) || 0) + pts);
  };

  // Grand Prix
  for (const [pos, driverId] of Object.entries(prediction.gp || {})) {
    add(driverId, pointsForPosition(points.race, Number(pos)));
  }

  // Sprint (only if this is a sprint weekend)
  if (race?.hasSprint) {
    for (const [pos, driverId] of Object.entries(prediction.sprint || {})) {
      add(driverId, pointsForPosition(points.sprint, Number(pos)));
    }
  }

  // Fastest lap bonus — only when enabled and the driver finished inside the
  // configured top-N of the Grand Prix.
  if (points.fastestLapEnabled && prediction.fl) {
    const gp = prediction.gp || {};
    let flPosition = null;
    for (const [pos, driverId] of Object.entries(gp)) {
      if (driverId === prediction.fl) flPosition = Number(pos);
    }
    if (flPosition && flPosition <= points.fastestLapTopN) {
      add(prediction.fl, points.fastestLap);
    }
  }

  return out;
}

// Total predicted points added across all remaining rounds, per driver.
export function predictedPointsByDriver(state) {
  const totals = new Map();
  const remaining = remainingRaces(state.schedule, state.completedRound);
  for (const race of remaining) {
    const pred = state.predictions[race.round];
    const roundPts = pointsFromRound(pred, race, state.points);
    for (const [driverId, pts] of roundPts) {
      totals.set(driverId, (totals.get(driverId) || 0) + pts);
    }
  }
  return totals;
}

// Compare two standings rows: higher points first, then more wins (count-back).
function byPointsThenWins(a, b) {
  if (b.projected !== a.projected) return b.projected - a.projected;
  return b.projectedWins - a.projectedWins;
}

// Projected driver standings.
export function projectDriverStandings(state) {
  const added = predictedPointsByDriver(state);
  const predictedWins = winsByDriver(state);

  const rows = state.drivers.map((d) => {
    const addPts = added.get(d.id) || 0;
    return {
      ...d,
      added: addPts,
      projected: d.points + addPts,
      projectedWins: d.wins + (predictedWins.get(d.id) || 0),
    };
  });

  rows.sort(byPointsThenWins);
  rows.forEach((r, i) => {
    r.projPosition = i + 1;
    r.delta = r.position ? r.position - r.projPosition : 0;
  });
  return rows;
}

// Count predicted P1 finishes (GP wins) per driver across remaining rounds.
export function winsByDriver(state) {
  const wins = new Map();
  const remaining = remainingRaces(state.schedule, state.completedRound);
  for (const race of remaining) {
    const pred = state.predictions[race.round];
    const winner = pred?.gp?.[1];
    if (winner) wins.set(winner, (wins.get(winner) || 0) + 1);
  }
  return wins;
}

// Projected constructor standings: start from current constructor points and
// add each team's drivers' predicted points (drivers mapped to their current
// team).
export function projectConstructorStandings(state) {
  const added = predictedPointsByDriver(state);

  // driverId -> teamId
  const teamOf = new Map(state.drivers.map((d) => [d.id, d.teamId]));
  const teamName = new Map(state.drivers.map((d) => [d.teamId, d.team]));

  const addedByTeam = new Map();
  for (const [driverId, pts] of added) {
    const teamId = teamOf.get(driverId);
    if (!teamId) continue;
    addedByTeam.set(teamId, (addedByTeam.get(teamId) || 0) + pts);
  }

  // Base from API constructor standings; if missing, derive from drivers.
  let base = state.constructors;
  if (!base || base.length === 0) {
    const derived = new Map();
    for (const d of state.drivers) {
      const cur = derived.get(d.teamId) || { id: d.teamId, name: d.team, points: 0, wins: 0 };
      cur.points += d.points;
      cur.wins += d.wins;
      derived.set(d.teamId, cur);
    }
    base = [...derived.values()];
  }

  const rows = base.map((c) => {
    const addPts = addedByTeam.get(c.id) || 0;
    return {
      ...c,
      name: c.name || teamName.get(c.id) || c.id,
      added: addPts,
      projected: c.points + addPts,
      projectedWins: c.wins, // constructor wins count-back left at current
    };
  });

  rows.sort(byPointsThenWins);
  rows.forEach((r, i) => {
    r.projPosition = i + 1;
    r.delta = r.position ? r.position - r.projPosition : 0;
  });
  return rows;
}
