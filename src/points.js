// Points systems for Formula One.
//
// These are the defaults for the current era (2025/2026):
//   - Grand Prix: points for the top 10.
//   - Sprint: points for the top 8.
//   - The bonus point for fastest lap was scrapped from 2025 onwards, so it is
//     OFF by default but can be re-enabled in Settings (it historically only
//     counted for a driver finishing in the top 10).
//
// Everything here is plain data so it can be tweaked in the UI without touching
// the rest of the app.

export const DEFAULT_POINTS = {
  // index 0 => P1, index 1 => P2, ...
  race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  sprint: [8, 7, 6, 5, 4, 3, 2, 1],
  fastestLap: 1,
  fastestLapEnabled: false,
  // Fastest lap point only awarded if the driver finishes inside this position.
  fastestLapTopN: 10,
};

// Points awarded for a given 1-based finishing position from a points array.
export function pointsForPosition(pointsArray, position) {
  if (!position || position < 1) return 0;
  return pointsArray[position - 1] || 0;
}

export function racePointsScale(points) {
  return points.race;
}

export function sprintPointsScale(points) {
  return points.sprint;
}

// Maximum points a single driver could take from one Grand Prix weekend.
export function maxPointsPerRace(points, isSprintWeekend) {
  let max = points.race[0] || 0;
  if (points.fastestLapEnabled) max += points.fastestLap;
  if (isSprintWeekend) max += points.sprint[0] || 0;
  return max;
}

// Deep-ish clone so the UI can edit a working copy safely.
export function clonePoints(points) {
  return {
    race: [...points.race],
    sprint: [...points.sprint],
    fastestLap: points.fastestLap,
    fastestLapEnabled: points.fastestLapEnabled,
    fastestLapTopN: points.fastestLapTopN,
  };
}
