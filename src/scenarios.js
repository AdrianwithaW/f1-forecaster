// "Can they still win it?" mathematics — independent of the predictions you
// type in. This answers, from the *current* standings, who is still alive for
// the title and what the clinch picture looks like.

import { maxPointsPerRace } from "./points.js";
import { remainingRaces } from "./compute.js";

// Maximum points still on offer to any single competitor across the remaining
// rounds (winning every Grand Prix, every sprint, every fastest lap).
export function maxRemainingPoints(state) {
  const remaining = remainingRaces(state.schedule, state.completedRound);
  let total = 0;
  for (const race of remaining) {
    total += maxPointsPerRace(state.points, race.hasSprint);
  }
  return total;
}

export function remainingCounts(state) {
  const remaining = remainingRaces(state.schedule, state.completedRound);
  const sprints = remaining.filter((r) => r.hasSprint).length;
  return { races: remaining.length, sprints };
}

// Title-contention analysis from current standings.
// For each competitor: their best-case ceiling (current + max remaining) and
// whether that ceiling can still reach/beat the current leader. A competitor is
// "alive" if, by winning out, they could at least equal the leader's *current*
// total (a conservative bound — the leader will usually score more, tightening
// it further, but this cleanly identifies who is mathematically eliminated).
export function titleContention(rows, maxRemaining) {
  if (!rows || rows.length === 0) return { leader: null, contenders: [] };

  // rows are objects with at least { name, points } — use current points.
  const sorted = [...rows].sort((a, b) => b.points - a.points || b.wins - a.wins);
  const leader = sorted[0];

  const contenders = sorted.map((r) => {
    const ceiling = r.points + maxRemaining;
    const gapToLeader = leader.points - r.points;
    const isLeader = r === leader;
    // Eliminated if even winning everything cannot reach the leader's CURRENT
    // total (and they are not the leader).
    const alive = isLeader || ceiling >= leader.points;
    return {
      ...r,
      ceiling,
      gapToLeader,
      isLeader,
      alive,
      // Points the leader could drop and still be uncatchable by this rival,
      // i.e. how far clear in "win-out" terms.
      cushion: leader.points - ceiling,
    };
  });

  return { leader, contenders };
}

// Has the title already been mathematically clinched from current standings?
// True when the leader's current total exceeds the maximum *possible* total of
// every rival (rival current + all remaining points).
export function isMathematicallyClinched(rows, maxRemaining) {
  if (!rows || rows.length < 1) return false;
  const sorted = [...rows].sort((a, b) => b.points - a.points || b.wins - a.wins);
  const leader = sorted[0];
  const secondCeiling = sorted
    .slice(1)
    .reduce((m, r) => Math.max(m, r.points + maxRemaining), 0);
  return leader.points > secondCeiling;
}

// Clinch picture for the current leader vs their nearest rival, from current
// points. Returns:
//   - racesUntilClinch: the SOONEST number of remaining races after which the
//     leader could be mathematically champion (they win every race + sprint,
//     the nearest rival scores nothing). null if a tie makes it undecidable.
//   - magicNumber: the classic "magic number" — points still needed for
//     certainty. Any combination of points the leader gains or the rival fails
//     to score that totals this number seals the title. 0 once clinched.
export function clinchScenario(state) {
  const rows = [...state.drivers].sort(
    (a, b) => b.points - a.points || b.wins - a.wins
  );
  if (rows.length === 0) return null;

  const leader = rows[0];
  const rival = rows[1] || null;
  const remaining = remainingRaces(state.schedule, state.completedRound);
  const totalMax = remaining.reduce(
    (sum, r) => sum + maxPointsPerRace(state.points, r.hasSprint),
    0
  );

  // No rival, or rival cannot mathematically catch up even winning everything.
  if (!rival) {
    return {
      leader,
      rival: null,
      racesUntilClinch: 0,
      magicNumber: 0,
      alreadyClinched: true,
      remainingCount: remaining.length,
    };
  }

  const lead = leader.points - rival.points;
  const alreadyClinched = lead > totalMax;
  const magicNumber = Math.max(0, totalMax - lead + 1);

  // Earliest clinch: leader maxes every race, rival scores zero.
  let racesUntilClinch = alreadyClinched ? 0 : null;
  if (!alreadyClinched) {
    let leadPts = lead;
    let rivalRemaining = totalMax;
    let i = 0;
    for (const race of remaining) {
      i++;
      const m = maxPointsPerRace(state.points, race.hasSprint);
      leadPts += m; // leader wins this race/sprint
      rivalRemaining -= m; // this race no longer available to the rival
      if (leadPts > rivalRemaining) {
        racesUntilClinch = i;
        break;
      }
    }
  }

  return {
    leader,
    rival,
    racesUntilClinch,
    magicNumber,
    alreadyClinched,
    remainingCount: remaining.length,
  };
}

// Given a projected final table (all remaining races filled in), is the title
// decided? Returns { decided, champion, runnerUp, margin }.
export function projectedOutcome(projectedRows) {
  if (!projectedRows || projectedRows.length < 2) {
    return { decided: false };
  }
  const [first, second] = projectedRows;
  return {
    decided: first.projected !== second.projected || first.projectedWins !== second.projectedWins,
    champion: first,
    runnerUp: second,
    margin: first.projected - second.projected,
  };
}
