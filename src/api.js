// Thin client for the Jolpica-F1 API — the community-maintained, drop-in
// successor to the (now frozen) Ergast API. Same JSON shape as Ergast.
//
// Docs: https://github.com/jolpica/jolpica-f1
//
// NOTE: these requests run in the *browser*, so they are subject to the
// browser's network access, not the server this file was authored on. If you
// run the tool from inside a sandboxed environment with an egress allowlist,
// add `api.jolpi.ca` to it. In a normal browser it just works (CORS enabled).

const BASE = "https://api.jolpi.ca/ergast/f1";

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`API request failed (${res.status}) for ${url}`);
  }
  return res.json();
}

// Returns { season, round, drivers: [{ id, code, number, name, firstName,
// lastName, team, teamId, points, wins, position }] }
export async function fetchDriverStandings(season) {
  const data = await getJSON(`${BASE}/${season}/driverStandings.json?limit=100`);
  const list = data?.MRData?.StandingsTable?.StandingsLists?.[0];
  if (!list) return { season, round: 0, drivers: [] };

  const drivers = (list.DriverStandings || []).map((d) => {
    const ctor = d.Constructors?.[d.Constructors.length - 1] || {};
    return {
      id: d.Driver.driverId,
      code: d.Driver.code || d.Driver.familyName.slice(0, 3).toUpperCase(),
      number: d.Driver.permanentNumber || "",
      firstName: d.Driver.givenName,
      lastName: d.Driver.familyName,
      name: `${d.Driver.givenName} ${d.Driver.familyName}`,
      team: ctor.name || "—",
      teamId: ctor.constructorId || "unknown",
      points: Number(d.points),
      wins: Number(d.wins),
      position: Number(d.position),
    };
  });

  return { season: Number(list.season), round: Number(list.round), drivers };
}

// Returns { season, round, constructors: [{ id, name, points, wins, position }] }
export async function fetchConstructorStandings(season) {
  const data = await getJSON(
    `${BASE}/${season}/constructorStandings.json?limit=100`
  );
  const list = data?.MRData?.StandingsTable?.StandingsLists?.[0];
  if (!list) return { season, round: 0, constructors: [] };

  const constructors = (list.ConstructorStandings || []).map((c) => ({
    id: c.Constructor.constructorId,
    name: c.Constructor.name,
    points: Number(c.points),
    wins: Number(c.wins),
    position: Number(c.position),
  }));

  return {
    season: Number(list.season),
    round: Number(list.round),
    constructors,
  };
}

// Returns [{ round, name, circuit, country, date, hasSprint }]
export async function fetchSchedule(season) {
  const data = await getJSON(`${BASE}/${season}.json?limit=100`);
  const races = data?.MRData?.RaceTable?.Races || [];
  return races.map((r) => ({
    round: Number(r.round),
    name: r.raceName,
    circuit: r.Circuit?.circuitName || "",
    country: r.Circuit?.Location?.country || "",
    locality: r.Circuit?.Location?.locality || "",
    date: r.date,
    // The presence of a `Sprint` session marks a sprint weekend.
    hasSprint: Boolean(r.Sprint),
  }));
}

// Convenience: load everything we need for a season in parallel.
export async function fetchSeason(season) {
  const [driverStandings, constructorStandings, schedule] = await Promise.all([
    fetchDriverStandings(season),
    fetchConstructorStandings(season),
    fetchSchedule(season),
  ]);
  return { driverStandings, constructorStandings, schedule };
}
