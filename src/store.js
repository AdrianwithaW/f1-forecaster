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

function storageKey(season) {
  return `${KEY_PREFIX}${season}`;
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

// Assign a driver to a position within a session ("gp" | "sprint") for a round.
// Enforces uniqueness: a driver can only occupy one scoring slot per session.
export function setPrediction(round, session, position, driverId) {
  const pred = ensureRoundPrediction(round);
  const slot = pred[session];

  // Clear any other position in this session currently held by the driver.
  if (driverId) {
    for (const pos of Object.keys(slot)) {
      if (slot[pos] === driverId) delete slot[pos];
    }
  }

  if (driverId) slot[position] = driverId;
  else delete slot[position];

  save();
  notify();
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
