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
// whether that ceiling can still beat the leader. The bar is NOT the leader's
// current points (that would only eliminate a chaser if the leader scored
// nothing more all season — technically "mathematically alive" but absurd).
// Instead a chaser is "out" once, even winning every remaining race, they
// couldn't pass a leader who simply keeps finishing RUNNER-UP the rest of the
// way (current points + 2nd place in every remaining Grand Prix and sprint).
// That matches how people actually read the title race.
export function titleContention(state) {
  const rows = [...state.drivers].sort(
    (a, b) => b.points - a.points || b.wins - a.wins
  );
  if (rows.length === 0) return { leader: null, contenders: [], leaderFloor: 0 };

  const remaining = remainingRaces(state.schedule, state.completedRound);
  const maxRemaining = remaining.reduce(
    (sum, r) => sum + maxPointsPerRace(state.points, r.hasSprint),
    0
  );
  // The leader's realistic floor: runner-up in every remaining session.
  const secondAll = remaining.reduce((sum, r) => {
    const gp = state.points.race[1] || 0;
    const sprint = r.hasSprint ? state.points.sprint[1] || 0 : 0;
    return sum + gp + sprint;
  }, 0);

  const leader = rows[0];
  const leaderFloor = leader.points + secondAll;

  const contenders = rows.map((r) => {
    const ceiling = r.points + maxRemaining;
    const gapToLeader = leader.points - r.points;
    const isLeader = r === leader;
    // Alive only if maxing out beats the leader's runner-up floor.
    const alive = isLeader || ceiling > leaderFloor;
    return { ...r, ceiling, gapToLeader, isLeader, alive };
  });

  return { leader, contenders, leaderFloor, maxRemaining };
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
// points, framed as a "first to X points" target — which avoids the ambiguity
// of any "number of wins" (a win can mean GP-only or GP + sprint, and the two
// give different answers). Returns:
//   - target: the points total that mathematically secures the title. The first
//     driver to reach it is champion, because no rival can exceed it.
//   - rivalCeiling: the most the nearest rival can possibly finish on
//     (their current points + every remaining point) = target - 1.
//   - magicNumber: points the leader still needs to reach the target.
//   - alreadyClinched: the leader's current total already beats the rival's max.
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

  // No rival: the leader is uncatchable by definition.
  if (!rival) {
    return {
      leader,
      rival: null,
      totalMax,
      target: leader.points,
      rivalCeiling: 0,
      magicNumber: 0,
      alreadyClinched: true,
      gap: leader.points,
      remainingCount: remaining.length,
    };
  }

  // The nearest rival can finish on at most (their points + every point left).
  // Reaching one more than that guarantees the title regardless of how the
  // points are scored — wins, sprints, fastest laps and all.
  const rivalCeiling = rival.points + totalMax;
  const target = rivalCeiling + 1;
  const magicNumber = Math.max(0, target - leader.points);
  const alreadyClinched = leader.points > rivalCeiling;

  return {
    leader,
    rival,
    totalMax,
    target,
    rivalCeiling,
    magicNumber,
    alreadyClinched,
    gap: leader.points - rival.points,
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
