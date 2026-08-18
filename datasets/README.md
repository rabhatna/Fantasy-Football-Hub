# Datasets

Reference data shipped with the app, as dated snapshots. On boot the server
copies the newest snapshot into `DATA_DIR/snapshots/` if that directory is
empty, then reads from there — so the app works from a clean clone, and your
data directory ends up self-contained for a container bind mount.

```
datasets/<scrape-date>/master.csv   top 250 players, ~226 columns
```

`master.csv` is produced by the Python pipeline in
`attached_assets/ff_analytics_scripts_*.zip`, which pulls from nflverse
(play-by-play, weekly stats, Next Gen Stats, snap counts, rosters, depth
charts, PFR advanced), DynastyProcess (FantasyPros ECR mirror, ID crosswalk)
and Fantasy Football Calculator / Sleeper for ADP.

To add a snapshot, create a new dated directory here (or directly under
`DATA_DIR/snapshots/`) containing a `master.csv`. The newest directory name
wins — dates sort lexicographically.

## Reading the columns

- `y25_*` — actual 2025 regular-season production
- `tm_*` — the player's **2026** team situation
- `ngs_*` — Next Gen Stats, only recorded for positions they apply to
  (separation for WR/TE, RYOE and box count for RB)
- **blank is not zero** — blank means no 2025 snaps (a rookie, or a missed
  season) or a sample too small to report. Zero means he played and produced
  nothing. The app preserves that distinction and renders blanks as `—`.
