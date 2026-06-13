// Central application state with localStorage persistence and a tiny pub/sub.
//
// State shape:
// {
//   season: 2026,
//   loadedAt: ISO string | null,
//   manualMode: bool,
//   drivers:      [{ id, code, name, team, teamId, points, wins, position }]
//   constructors: [{ id, name, points, wins, position }]
//   schedule:     [{ round, name, country, date, hasSprint }]
//   completedRound: number,   // last round already reflected in standings
//   points: <points config>,  // see points.js
//   // predictions[round] = { gp: {1: driverId,...}, sprint: {...}, fl: driverId|null }
//   predictions: { [round]: { gp, sprint, fl } }
// }

import { DEFAULT_POINTS, clonePoints } from "./points.js";

const KEY_PREFIX = "f1-forecaster:v1:";
const META_KEY = `${KEY_PREFIX}meta`;

function storageKey(season) {
  return `${KEY_PREFIX}${season}`;
}

// Remember which season was last viewed so we can reopen it next time.
export function getLastSeason() {
  try {
    const meta = JSON.parse(localStorage.getItem(META_KEY) || "{}");
    return meta.lastSeason || null;
  } catch {
    return null;
  }
}

const listeners = new Set();

const state = {
  season: new Date().getFullYear(),
  loadedAt: null,
  manualMode: false,
  drivers: [],
  constructors: [],
  schedule: [],
  completedRound: 0,
  points: clonePoints(DEFAULT_POINTS),
  predictions: {},
  status: "idle", // idle | loading | ready | error
  error: null,
};

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(state);
}

// Apply a partial update and persist + notify.
export function update(patch, { persist = true, silent = false } = {}) {
  Object.assign(state, patch);
  if (persist) save();
  if (!silent) notify();
}

// ----- Predictions helpers -------------------------------------------------

export function ensureRoundPrediction(round) {
  if (!state.predictions[round]) {
    state.predictions[round] = { gp: {}, sprint: {}, fl: null };
  }
  return state.predictions[round];
}

// Place a driver into a position within a session slot, enforcing uniqueness:
// a driver can only occupy one scoring slot per session, so clear them from any
// other position first. Passing a falsy driverId clears the position.
function placeInSlot(slot, position, driverId) {
  if (driverId) {
    for (const pos of Object.keys(slot)) {
      if (slot[pos] === driverId) delete slot[pos];
    }
    slot[position] = driverId;
  } else {
    delete slot[position];
  }
}

// Assign a driver to a position within a session ("gp" | "sprint") for a round.
export function setPrediction(round, session, position, driverId) {
  const pred = ensureRoundPrediction(round);
  placeInSlot(pred[session], position, driverId);
  save();
  notify();
}

// Place a driver into the same finishing position across a range of rounds.
// `sessions` selects which to fill: { gp, sprint }. Sprint slots are only
// touched on sprint weekends and only when the position scores in the sprint.
// Returns the number of (round, session) slots that were filled.
export function bulkAssign({ driverId, position, fromRound, toRound, gp = true, sprint = false }) {
  if (!driverId || !position) return 0;
  const lo = Math.min(fromRound, toRound);
  const hi = Math.max(fromRound, toRound);
  let filled = 0;

  for (const race of state.schedule) {
    if (race.round <= state.completedRound) continue;
    if (race.round < lo || race.round > hi) continue;
    const pred = ensureRoundPrediction(race.round);

    if (gp && position <= state.points.race.length) {
      placeInSlot(pred.gp, position, driverId);
      filled++;
    }
    if (sprint && race.hasSprint && position <= state.points.sprint.length) {
      placeInSlot(pred.sprint, position, driverId);
      filled++;
    }
  }

  save();
  notify();
  return filled;
}

export function setFastestLap(round, driverId) {
  const pred = ensureRoundPrediction(round);
  pred.fl = driverId || null;
  save();
  notify();
}

export function clearRound(round) {
  state.predictions[round] = { gp: {}, sprint: {}, fl: null };
  save();
  notify();
}

export function clearAllPredictions() {
  state.predictions = {};
  save();
  notify();
}

// Fill a round's GP (and sprint if applicable) using an ordered list of driver
// ids (e.g. current championship order or reverse).
export function fillRoundFromOrder(round, orderedDriverIds, { sprint = false } = {}) {
  const pred = ensureRoundPrediction(round);
  const gp = {};
  orderedDriverIds.slice(0, state.points.race.length).forEach((id, i) => {
    gp[i + 1] = id;
  });
  pred.gp = gp;
  if (sprint) {
    const sp = {};
    orderedDriverIds.slice(0, state.points.sprint.length).forEach((id, i) => {
      sp[i + 1] = id;
    });
    pred.sprint = sp;
  }
  save();
  notify();
}

// Load the best-case scenario for a single driver across all remaining rounds:
// that driver wins every Grand Prix and sprint (P1), and everyone else fills in
// behind them in current championship order (leader takes P2, next P3, ...).
// This is the toughest test of whether the driver can still take the title —
// they max out while their rivals also score as heavily as possible.
// Overwrites predictions for the remaining rounds.
export function loadWinningScenario(driverId) {
  const others = [...state.drivers]
    .filter((d) => d.id !== driverId)
    .sort((a, b) => (a.position || 999) - (b.position || 999) || b.points - a.points);
  const ordered = [driverId, ...others.map((d) => d.id)];

  const predictions = {};
  for (const race of state.schedule) {
    if (race.round <= state.completedRound) continue;
    const gp = {};
    ordered.slice(0, state.points.race.length).forEach((id, i) => {
      gp[i + 1] = id;
    });
    const pred = { gp, sprint: {}, fl: null };
    if (race.hasSprint) {
      const sp = {};
      ordered.slice(0, state.points.sprint.length).forEach((id, i) => {
        sp[i + 1] = id;
      });
      pred.sprint = sp;
    }
    predictions[race.round] = pred;
  }

  state.predictions = predictions;
  save();
  notify();
}

// ----- Persistence ---------------------------------------------------------

export function save() {
  state.loadedAt = state.loadedAt || null;
  try {
    const payload = {
      season: state.season,
      loadedAt: state.loadedAt,
      manualMode: state.manualMode,
      drivers: state.drivers,
      constructors: state.constructors,
      schedule: state.schedule,
      completedRound: state.completedRound,
      points: state.points,
      predictions: state.predictions,
    };
    localStorage.setItem(storageKey(state.season), JSON.stringify(payload));
    localStorage.setItem(META_KEY, JSON.stringify({ lastSeason: state.season }));
  } catch (e) {
    // localStorage may be unavailable (private mode / quota). Non-fatal.
    console.warn("Could not persist state:", e);
  }
}

// Load a season's saved snapshot (standings + predictions + settings).
// Returns true if anything was restored.
export function loadSaved(season) {
  try {
    const raw = localStorage.getItem(storageKey(season));
    if (!raw) return false;
    const data = JSON.parse(raw);
    Object.assign(state, {
      season: data.season ?? season,
      loadedAt: data.loadedAt ?? null,
      manualMode: data.manualMode ?? false,
      drivers: data.drivers ?? [],
      constructors: data.constructors ?? [],
      schedule: data.schedule ?? [],
      completedRound: data.completedRound ?? 0,
      points: data.points ?? clonePoints(DEFAULT_POINTS),
      predictions: data.predictions ?? {},
    });
    return state.drivers.length > 0 || Object.keys(state.predictions).length > 0;
  } catch (e) {
    console.warn("Could not load saved state:", e);
    return false;
  }
}

// Export the current scenario (settings + predictions) as a portable object.
export function exportScenario() {
  return {
    kind: "f1-forecaster-scenario",
    version: 1,
    season: state.season,
    points: state.points,
    predictions: state.predictions,
    exportedAt: new Date().toISOString(),
  };
}

export function importScenario(obj) {
  if (!obj || obj.kind !== "f1-forecaster-scenario") {
    throw new Error("Not a valid F1 Forecaster scenario file.");
  }
  update({
    season: obj.season ?? state.season,
    points: obj.points ?? state.points,
    predictions: obj.predictions ?? {},
  });
}
