# 🏁 F1 Championship Forecaster

A zero-dependency web tool for mapping out the Formula 1 title race. Pull in the
**current points** for every driver and constructor, then enter hypothetical
results for the remaining Grands Prix (and sprints) to see exactly how each
scenario reshapes the **Drivers'** and **Constructors'** championships.

## What it does

- **Live standings** — fetches current driver & constructor points straight from
  the [Jolpica-F1 API](https://github.com/jolpica/jolpica-f1) (the maintained,
  drop-in successor to Ergast). Just enter a season and hit **Load standings**.
- **Scenario builder** — for each remaining race, drop drivers into finishing
  positions. The projected standings on the right update instantly.
- **Bulk fill** — set a driver to the same finishing position across a whole
  range of races in one go (e.g. "Verstappen wins every race from Canada to
  Britain"), for the Grand Prix and/or the sprint.
- **Sprints included** — sprint weekends are detected automatically and get their
  own points entry (P1–P8). Constructor points are recalculated from each team's
  drivers.
- **"Can they still win it?"** — from the *current* points it works out who is
  mathematically alive for the title, the max points still on offer, the gap to
  the leader, and whether the championship is already clinched.
- **Clinch tracker** — a headline card shows the soonest number of races in
  which the current leader could wrap up the title, plus the "magic number":
  the points still needed for mathematical certainty.
- **Projected outcome** — fill in every remaining race and it declares the
  champion and the winning margin, with count-back on wins for ties.
- **Configurable** — edit the points system (race & sprint scales), toggle the
  fastest-lap bonus (off by default, as in 2025+), and export/import scenarios
  as JSON. Everything is saved to your browser automatically.
- **Manual mode** — no API access? Paste the grid yourself and carry on.

## Running it

It's a static site — no build step, no dependencies.

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` in a browser.

## Hosting on GitHub Pages

This repo ships a Pages workflow (`.github/workflows/deploy.yml`). To enable it:

1. Push to your default branch (`main`).
2. In the repo: **Settings → Pages → Build and deployment → Source:
   "GitHub Actions"**.

The site deploys to `https://<user>.github.io/<repo>/`. All asset paths are
relative, so it works correctly under that project subpath.

## Notes

- Data requests run in **your browser**. In a normal browser they work out of the
  box (the API sends CORS headers). If you run the tool from inside a sandboxed
  environment with an egress allowlist, add `api.jolpi.ca` to it.
- Predictions are entirely hypothetical — this is a what-if simulator, not a
  betting model.

## Project layout

```
index.html          markup + dialogs
src/styles.css      styling (dark, F1-flavoured)
src/api.js          Jolpica-F1 fetch layer
src/points.js       points systems & config
src/store.js        state, persistence, predictions
src/compute.js      projection maths (drivers + constructors)
src/scenarios.js    title-contention / clinch maths
src/render.js       DOM rendering
src/main.js         controller & event wiring
```
