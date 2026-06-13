// DOM rendering. Pure-ish: reads state, writes to the DOM. Event wiring lives
// in main.js and is delegated where possible.

import {
  projectDriverStandings,
  projectConstructorStandings,
  remainingRaces,
  pointsFromRound,
} from "./compute.js";
import {
  maxRemainingPoints,
  remainingCounts,
  titleContention,
  isMathematicallyClinched,
  projectedOutcome,
} from "./scenarios.js";
import { pointsForPosition } from "./points.js";

// Rough team colours keyed by substrings of the constructor id/name.
const TEAM_COLORS = [
  [/red.?bull/i, "#3671C6"],
  [/mclaren/i, "#FF8000"],
  [/ferrari/i, "#E8002D"],
  [/mercedes/i, "#27F4D2"],
  [/aston/i, "#229971"],
  [/alpine/i, "#0093CC"],
  [/williams/i, "#64C4FF"],
  [/(rb|racing.?bull|alphatauri|toro)/i, "#6692FF"],
  [/(sauber|kick|audi)/i, "#52E252"],
  [/(haas)/i, "#B6BABD"],
  [/cadillac/i, "#C8A45C"],
];

export function teamColor(teamIdOrName = "") {
  for (const [re, color] of TEAM_COLORS) {
    if (re.test(teamIdOrName)) return color;
  }
  return "#888";
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function deltaSpan(delta) {
  if (!delta) return `<span class="delta-flat">—</span>`;
  if (delta > 0) return `<span class="delta-up">▲${delta}</span>`;
  return `<span class="delta-down">▼${Math.abs(delta)}</span>`;
}

// ---------- Overview ----------

export function renderOverview(state) {
  const body = document.getElementById("overview-body");
  const meta = document.getElementById("overview-meta");
  if (!state.drivers.length) {
    body.innerHTML = "";
    meta.textContent = "";
    return;
  }

  const maxRem = maxRemainingPoints(state);
  const counts = remainingCounts(state);
  const { contenders } = titleContention(state.drivers, maxRem);
  const clinchedNow = isMathematicallyClinched(state.drivers, maxRem);

  const projected = projectDriverStandings(state);
  const remaining = remainingRaces(state.schedule, state.completedRound);
  const allFilled =
    remaining.length > 0 &&
    remaining.every((r) => {
      const p = state.predictions[r.round];
      return p && Object.keys(p.gp || {}).length > 0;
    });
  const outcome = allFilled ? projectedOutcome(projected) : { decided: false };

  const aliveCount = contenders.filter((c) => c.alive).length;

  let banner = "";
  if (clinchedNow) {
    banner = `<div class="banner clinched">🏆 Title already mathematically clinched: <strong>${contenders[0].name}</strong> cannot be caught.</div>`;
  } else if (outcome.decided) {
    banner = `<div class="banner live">In this scenario, <strong>${outcome.champion.name}</strong> is champion — by ${outcome.margin} pt${outcome.margin === 1 ? "" : "s"} over ${outcome.runnerUp.name}.</div>`;
  } else if (remaining.length === 0) {
    banner = `<div class="banner clinched">Season complete — final standings shown.</div>`;
  } else {
    banner = `<div class="banner live">${aliveCount} driver${aliveCount === 1 ? "" : "s"} still mathematically alive for the title.</div>`;
  }

  const cards = [
    {
      label: "Races left",
      value: counts.races,
      sub: `${counts.sprints} sprint${counts.sprints === 1 ? "" : "s"} remaining`,
    },
    {
      label: "Max points on offer",
      value: maxRem,
      sub: "to any single driver",
    },
    {
      label: "Current leader",
      value: contenders[0]?.name ?? "—",
      sub: `${contenders[0]?.points ?? 0} pts · ${contenders[0]?.wins ?? 0} win${contenders[0]?.wins === 1 ? "" : "s"}`,
    },
    {
      label: "Gap to P2",
      value:
        contenders[1] != null
          ? `${contenders[0].points - contenders[1].points} pts`
          : "—",
      sub: contenders[1] ? `over ${contenders[1].name}` : "",
    },
  ];

  const contendersRows = contenders
    .slice(0, 10)
    .map((c) => {
      const tag = c.isLeader
        ? `<span class="tag leader">Leader</span>`
        : c.alive
        ? `<span class="tag alive">Alive</span>`
        : `<span class="tag out">Out</span>`;
      return `<tr class="${c.alive ? "" : "dead"}">
        <td>${c.name}</td>
        <td>${c.team}</td>
        <td class="num">${c.points}</td>
        <td class="num">${c.isLeader ? "—" : "-" + c.gapToLeader}</td>
        <td class="num">${c.ceiling}</td>
        <td>${tag}</td>
      </tr>`;
    })
    .join("");

  meta.textContent = state.loadedAt
    ? `After round ${state.completedRound} · loaded ${new Date(state.loadedAt).toLocaleString()}`
    : `After round ${state.completedRound}`;

  body.innerHTML = `
    ${banner}
    ${cards
      .map(
        (c) => `<div class="stat-card">
          <div class="label">${c.label}</div>
          <div class="value">${c.value}</div>
          <div class="sub">${c.sub}</div>
        </div>`
      )
      .join("")}
    <div class="contenders stat-card">
      <div class="label">Still mathematically alive (from current points)</div>
      <table>
        <thead><tr>
          <th>Driver</th><th>Team</th><th class="num">Pts</th>
          <th class="num">Gap</th><th class="num">Ceiling</th><th></th>
        </tr></thead>
        <tbody>${contendersRows}</tbody>
      </table>
      <p class="muted small" style="margin:8px 0 0">
        “Ceiling” = current points + every remaining point won. A driver is “Out”
        when their ceiling can’t reach the leader’s current total.
      </p>
    </div>`;
}

// ---------- Standings tables ----------

function standingsTable(rows, { isDriver }) {
  const head = isDriver
    ? `<tr><th>#</th><th>Driver</th><th class="num">Now</th><th class="num">+</th><th class="num">Proj</th><th class="num">Δ</th></tr>`
    : `<tr><th>#</th><th>Constructor</th><th class="num">Now</th><th class="num">+</th><th class="num">Proj</th><th class="num">Δ</th></tr>`;

  const body = rows
    .map((r) => {
      const champ = r.projPosition === 1 ? "is-champ" : "";
      const name = isDriver
        ? `<span class="team-chip" style="background:${teamColor(r.teamId || r.team)}"></span>
           <span class="driver-name">${r.name}</span>
           <span class="driver-team"> · ${r.team}</span>`
        : `<span class="team-chip" style="background:${teamColor(r.id || r.name)}"></span>
           <span class="driver-name">${r.name}</span>`;
      return `<tr class="${champ}">
        <td class="pos">${r.projPosition}</td>
        <td>${name}</td>
        <td class="num">${r.points}</td>
        <td class="num add-pts">${r.added ? "+" + r.added : ""}</td>
        <td class="num"><strong>${r.projected}</strong></td>
        <td class="num">${deltaSpan(r.delta)}</td>
      </tr>`;
    })
    .join("");

  return `<table class="standings"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function renderStandings(state) {
  const dEl = document.getElementById("standings-drivers");
  const cEl = document.getElementById("standings-constructors");
  if (!state.drivers.length) {
    dEl.innerHTML = "";
    cEl.innerHTML = "";
    return;
  }
  dEl.innerHTML = standingsTable(projectDriverStandings(state), { isDriver: true });
  cEl.innerHTML = standingsTable(projectConstructorStandings(state), {
    isDriver: false,
  });
}

// ---------- Race cards ----------

function driverOptions(state, selectedId) {
  const opts = state.drivers
    .map(
      (d) =>
        `<option value="${d.id}" ${d.id === selectedId ? "selected" : ""}>${d.code} · ${d.name} (${d.team})</option>`
    )
    .join("");
  return `<option value="">— empty —</option>${opts}`;
}

function sessionBlock(state, race, session, count, scale) {
  const pred = state.predictions[race.round] || { gp: {}, sprint: {} };
  const slot = pred[session] || {};
  const rows = [];
  for (let pos = 1; pos <= count; pos++) {
    const pts = pointsForPosition(scale, pos);
    rows.push(`
      <div class="pos-row">
        <span class="plabel">P${pos}</span>
        <select data-round="${race.round}" data-session="${session}" data-pos="${pos}">
          ${driverOptions(state, slot[pos])}
        </select>
        <span class="ppts">${pts}</span>
      </div>`);
  }
  const title = session === "gp" ? "Grand Prix" : "Sprint";
  return `<div class="session"><h4>${title}</h4>${rows.join("")}</div>`;
}

export function renderRaces(state) {
  const list = document.getElementById("races-list");
  const hint = document.getElementById("races-hint");
  const remaining = remainingRaces(state.schedule, state.completedRound);

  if (!state.drivers.length) {
    list.innerHTML = "";
    hint.textContent = "";
    return;
  }
  if (!remaining.length) {
    list.innerHTML = `<p class="muted">No remaining races for this season.</p>`;
    hint.textContent = "";
    return;
  }

  hint.textContent =
    "Enter a finishing order for any race below — positions you leave blank simply score nothing. The standings on the right update instantly.";

  list.innerHTML = "";
  for (const race of remaining) {
    const pred = state.predictions[race.round];
    const roundPts = pointsFromRound(pred, race, state.points);
    const filledTotal = [...roundPts.values()].reduce((a, b) => a + b, 0);
    const isFilled = pred && Object.keys(pred.gp || {}).length > 0;

    const card = el(`
      <div class="race-card ${isFilled ? "filled" : ""}" data-round="${race.round}">
        <div class="race-summary">
          <div class="race-title">
            <span class="race-round">R${race.round}</span>
            <span class="race-name">${race.name}</span>
            <span class="muted small">${race.country || race.locality || ""}</span>
          </div>
          <div class="race-flags">
            ${race.hasSprint ? `<span class="sprint-badge">SPRINT</span>` : ""}
            ${isFilled ? `<span class="filled-badge">✓ ${filledTotal} pts placed</span>` : ""}
            <span class="chevron">▶</span>
          </div>
        </div>
        <div class="race-body">
          <div class="race-body-actions">
            <button class="btn tiny ghost" data-action="fill-order" data-round="${race.round}">Use championship order</button>
            <button class="btn tiny ghost" data-action="fill-reverse" data-round="${race.round}">Reverse order</button>
            <button class="btn tiny danger" data-action="clear-round" data-round="${race.round}">Clear</button>
          </div>
          <div class="session-cols ${race.hasSprint ? "has-sprint" : ""}">
            ${sessionBlock(state, race, "gp", state.points.race.length, state.points.race)}
            ${race.hasSprint ? sessionBlock(state, race, "sprint", state.points.sprint.length, state.points.sprint) : ""}
          </div>
          ${
            state.points.fastestLapEnabled
              ? `<div class="fl-row">
                   <span>Fastest lap (+${state.points.fastestLap}):</span>
                   <select data-round="${race.round}" data-fl="1">${driverOptions(state, pred?.fl)}</select>
                 </div>`
              : ""
          }
        </div>
      </div>`);
    list.appendChild(card);
  }
}

export function renderAll(state) {
  renderOverview(state);
  renderStandings(state);
  renderRaces(state);
}
