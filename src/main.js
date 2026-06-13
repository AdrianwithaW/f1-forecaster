// Application controller: bootstraps state, wires events, orchestrates renders.

import { fetchSeason } from "./api.js";
import {
  getState,
  update,
  subscribe,
  loadSaved,
  save,
  setPrediction,
  setFastestLap,
  clearRound,
  clearAllPredictions,
  fillRoundFromOrder,
  bulkAssign,
  exportScenario,
  importScenario,
} from "./store.js";
import { renderAll, renderOverview, renderStandings, renderRaces } from "./render.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  seasonInput: $("#season-input"),
  loadBtn: $("#load-btn"),
  settingsBtn: $("#settings-btn"),
  statusBar: $("#status-bar"),
  app: $("#app"),
  empty: $("#empty-state"),
  racesList: $("#races-list"),
  manualBtn: $("#manual-btn"),
};

// Tracks which race cards are expanded so re-renders don't collapse them.
const openRounds = new Set();

// ---------- Status helpers ----------
function setStatus(message, kind = "info") {
  if (!message) {
    els.statusBar.hidden = true;
    return;
  }
  els.statusBar.hidden = false;
  els.statusBar.className = `status-bar ${kind}`;
  els.statusBar.textContent = message;
}

function showApp(hasData) {
  els.app.hidden = !hasData;
  els.empty.hidden = hasData;
}

// ---------- Rendering with open-state preservation ----------
function renderRacesPreserveOpen(state) {
  renderRaces(state);
  for (const round of openRounds) {
    const card = els.racesList.querySelector(`.race-card[data-round="${round}"]`);
    if (card) card.classList.add("open");
  }
}

function fullRender(state) {
  renderOverview(state);
  renderStandings(state);
  renderRacesPreserveOpen(state);
}

// Lightweight subscriber: keep the projections/overview live on every change.
subscribe((state) => {
  renderOverview(state);
  renderStandings(state);
});

// ---------- Data loading ----------
async function loadSeason(season) {
  setStatus(`Loading ${season} standings…`, "info");
  els.loadBtn.disabled = true;
  try {
    const { driverStandings, constructorStandings, schedule } = await fetchSeason(season);
    if (!driverStandings.drivers.length) {
      setStatus(
        `No standings found for ${season} yet. The season may not have started — try manual entry.`,
        "info"
      );
      update({
        season,
        drivers: [],
        constructors: [],
        schedule,
        completedRound: 0,
        manualMode: false,
        loadedAt: new Date().toISOString(),
      });
      showApp(false);
      return;
    }
    update({
      season,
      drivers: driverStandings.drivers,
      constructors: constructorStandings.constructors,
      schedule,
      completedRound: Math.max(driverStandings.round, constructorStandings.round),
      manualMode: false,
      loadedAt: new Date().toISOString(),
    });
    showApp(true);
    fullRender(getState());
    setStatus(
      `Loaded ${season}: ${driverStandings.drivers.length} drivers after round ${getState().completedRound}.`,
      "success"
    );
  } catch (err) {
    console.error(err);
    setStatus(
      `Couldn't reach the F1 API (${err.message}). Check your connection — or use manual entry. ` +
        `If you're inside a sandbox, allow egress to api.jolpi.ca.`,
      "error"
    );
    // Fall back to whatever we have saved.
    if (getState().drivers.length) {
      showApp(true);
      fullRender(getState());
    } else {
      showApp(false);
    }
  } finally {
    els.loadBtn.disabled = false;
  }
}

// ---------- Manual entry ----------
function parseManual(driversText, racesText) {
  const drivers = driversText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [code, name, team, points, wins] = line.split(",").map((s) => (s || "").trim());
      const id = (code || name || `d${i}`).toLowerCase().replace(/\s+/g, "-");
      const teamId = (team || "unknown").toLowerCase().replace(/\s+/g, "-");
      return {
        id,
        code: (code || name || "").slice(0, 3).toUpperCase(),
        name: name || code || `Driver ${i + 1}`,
        team: team || "—",
        teamId,
        points: Number(points) || 0,
        wins: Number(wins) || 0,
        position: i + 1,
      };
    })
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .map((d, i) => ({ ...d, position: i + 1 }));

  const schedule = racesText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name, i) => {
      const hasSprint = name.endsWith("*");
      return {
        round: i + 1,
        name: hasSprint ? name.slice(0, -1).trim() : name,
        country: "",
        date: "",
        hasSprint,
      };
    });

  return { drivers, schedule };
}

// ---------- Event wiring ----------
function wireEvents() {
  els.loadBtn.addEventListener("click", () => {
    const season = Number(els.seasonInput.value) || new Date().getFullYear();
    loadSeason(season);
  });
  els.seasonInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") els.loadBtn.click();
  });

  // Delegated handler for the races list (selects + action buttons + toggles).
  els.racesList.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("select[data-fl]")) {
      setFastestLap(Number(t.dataset.round), t.value || null);
      return;
    }
    if (t.matches("select[data-session]")) {
      const round = Number(t.dataset.round);
      setPrediction(round, t.dataset.session, t.dataset.pos, t.value || null);
      // Refresh just this card so the duplicate-clearing + badge stay in sync.
      refreshCard(round);
    }
  });

  els.racesList.addEventListener("click", (e) => {
    const summary = e.target.closest(".race-summary");
    if (summary) {
      const card = summary.closest(".race-card");
      const round = Number(card.dataset.round);
      card.classList.toggle("open");
      if (card.classList.contains("open")) openRounds.add(round);
      else openRounds.delete(round);
      return;
    }

    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const round = Number(btn.dataset.round);
    const state = getState();
    const order = [...state.drivers].sort((a, b) => a.position - b.position).map((d) => d.id);
    const race = state.schedule.find((r) => r.round === round);

    switch (btn.dataset.action) {
      case "fill-order":
        fillRoundFromOrder(round, order, { sprint: race?.hasSprint });
        break;
      case "fill-reverse":
        fillRoundFromOrder(round, [...order].reverse(), { sprint: race?.hasSprint });
        break;
      case "clear-round":
        clearRound(round);
        break;
    }
    refreshCard(round);
  });

  // Expand / collapse / clear all
  $("#expand-all").addEventListener("click", () => {
    document.querySelectorAll(".race-card").forEach((c) => {
      c.classList.add("open");
      openRounds.add(Number(c.dataset.round));
    });
  });
  $("#collapse-all").addEventListener("click", () => {
    document.querySelectorAll(".race-card").forEach((c) => c.classList.remove("open"));
    openRounds.clear();
  });
  $("#clear-all").addEventListener("click", () => {
    if (confirm("Clear every predicted result?")) {
      clearAllPredictions();
      renderRacesPreserveOpen(getState());
    }
  });

  wireSettings();
  wireManual();
  wireBulk();

  // Standings tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document
        .getElementById(`standings-${tab.dataset.tab}`)
        .classList.add("active");
    });
  });
}

// Re-render a single race card (keeps the rest of the list untouched).
function refreshCard(round) {
  const state = getState();
  renderRacesPreserveOpen(state);
}

function wireSettings() {
  const dialog = $("#settings-dialog");
  els.settingsBtn.addEventListener("click", () => {
    const p = getState().points;
    $("#fl-enabled").checked = p.fastestLapEnabled;
    $("#race-points").value = p.race.join(", ");
    $("#sprint-points").value = p.sprint.join(", ");
    dialog.showModal();
  });

  $("#settings-save").addEventListener("click", (e) => {
    e.preventDefault();
    const parseNums = (s) =>
      s
        .split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => !Number.isNaN(n));
    const points = { ...getState().points };
    points.fastestLapEnabled = $("#fl-enabled").checked;
    const race = parseNums($("#race-points").value);
    const sprint = parseNums($("#sprint-points").value);
    if (race.length) points.race = race;
    if (sprint.length) points.sprint = sprint;
    update({ points });
    fullRender(getState());
    dialog.close();
  });

  // Export / import scenario
  $("#export-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(exportScenario(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `f1-scenario-${getState().season}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  $("#import-btn").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      importScenario(obj);
      fullRender(getState());
      setStatus("Scenario imported.", "success");
      $("#settings-dialog").close();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
    e.target.value = "";
  });
}

function wireManual() {
  const dialog = $("#manual-dialog");
  const open = () => {
    const s = getState();
    $("#manual-drivers").value = s.drivers
      .map((d) => `${d.code}, ${d.name}, ${d.team}, ${d.points}, ${d.wins}`)
      .join("\n");
    $("#manual-races").value = s.schedule
      .filter((r) => r.round > s.completedRound)
      .map((r) => (r.hasSprint ? r.name + "*" : r.name))
      .join(", ");
    dialog.showModal();
  };
  if (els.manualBtn) els.manualBtn.addEventListener("click", open);
  // Also reachable from settings via a keyboard shortcut isn't needed.

  $("#manual-apply").addEventListener("click", (e) => {
    e.preventDefault();
    const { drivers, schedule } = parseManual(
      $("#manual-drivers").value,
      $("#manual-races").value
    );
    if (!drivers.length) {
      alert("Add at least one driver.");
      return;
    }
    update({
      drivers,
      constructors: [],
      schedule,
      completedRound: 0,
      manualMode: true,
      loadedAt: new Date().toISOString(),
    });
    showApp(true);
    fullRender(getState());
    setStatus(`Manual mode: ${drivers.length} drivers, ${schedule.length} races.`, "success");
    dialog.close();
  });
}

function wireBulk() {
  const dialog = $("#bulk-dialog");
  const driverSel = $("#bulk-driver");
  const posSel = $("#bulk-position");
  const fromSel = $("#bulk-from");
  const toSel = $("#bulk-to");

  $("#bulk-btn").addEventListener("click", () => {
    const s = getState();
    const remaining = s.schedule
      .filter((r) => r.round > s.completedRound)
      .sort((a, b) => a.round - b.round);
    if (!remaining.length) {
      setStatus("No remaining races to fill.", "info");
      return;
    }

    driverSel.innerHTML = s.drivers
      .map((d) => `<option value="${d.id}">${d.code} · ${d.name} (${d.team})</option>`)
      .join("");

    posSel.innerHTML = s.points.race
      .map((pts, i) => `<option value="${i + 1}">P${i + 1} — ${pts} pt${pts === 1 ? "" : "s"}</option>`)
      .join("");

    const raceOpts = remaining
      .map((r) => `<option value="${r.round}">R${r.round} · ${r.name}${r.hasSprint ? " (sprint)" : ""}</option>`)
      .join("");
    fromSel.innerHTML = raceOpts;
    toSel.innerHTML = raceOpts;
    fromSel.value = String(remaining[0].round);
    toSel.value = String(remaining[remaining.length - 1].round);

    dialog.showModal();
  });

  $("#bulk-apply").addEventListener("click", (e) => {
    e.preventDefault();
    const driverId = driverSel.value;
    const position = Number(posSel.value);
    const fromRound = Number(fromSel.value);
    const toRound = Number(toSel.value);
    const gp = $("#bulk-gp").checked;
    const sprint = $("#bulk-sprint").checked;

    if (!gp && !sprint) {
      alert("Pick at least one of Grand Prix or Sprint.");
      return;
    }

    const filled = bulkAssign({ driverId, position, fromRound, toRound, gp, sprint });
    renderRacesPreserveOpen(getState());

    const driver = getState().drivers.find((d) => d.id === driverId);
    const lo = Math.min(fromRound, toRound);
    const hi = Math.max(fromRound, toRound);
    setStatus(
      `${driver?.name ?? "Driver"} placed P${position} across rounds ${lo}–${hi} (${filled} slot${filled === 1 ? "" : "s"} filled).`,
      "success"
    );
    dialog.close();
  });
}

// ---------- Boot ----------
function boot() {
  wireEvents();
  const year = new Date().getFullYear();
  // Restore the most recently used season if present, else current year.
  const restored = loadSaved(year);
  els.seasonInput.value = getState().season || year;
  if (restored && getState().drivers.length) {
    showApp(true);
    fullRender(getState());
    setStatus(
      `Restored saved ${getState().season} scenario. Hit “Load standings” to refresh from the API.`,
      "info"
    );
  } else {
    showApp(false);
  }
}

boot();
