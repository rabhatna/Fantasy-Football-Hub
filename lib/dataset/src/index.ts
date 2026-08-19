import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, readFileOrNull } from "@workspace/store";
import { toPlayer, type DatasetPlayer } from "./players.ts";
import { toTeams, type DatasetTeam } from "./teams.ts";

export { toPlayer, normalizeName, type DatasetPlayer } from "./players.ts";
export { toTeam, toTeams, type DatasetTeam } from "./teams.ts";
export * from "./fields.ts";

export interface Snapshot {
  /** Directory name, which is the scrape date: 2026-08-14 */
  version: string;
  directory: string;
  players: DatasetPlayer[];
  teams: DatasetTeam[];
  /** Rows that could not be parsed, so a bad file degrades instead of dying. */
  skipped: { rank: string; reason: string }[];
}

/** Snapshots shipped with the repo, used to seed an empty data directory. */
function bundledDatasetsDir(): string {
  return path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "datasets");
}

async function listSnapshotDirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      // Hidden entries are seed staging directories, not finished snapshots.
      .filter((entry) => !entry.name.startsWith("."))
      // Directory names are ISO dates, so lexicographic order is chronological.
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Copy the newest bundled snapshot into the data directory when it has none.
 *
 * This is what lets a clean clone start with data while leaving the user free
 * to drop in their own newer snapshot afterwards.
 *
 * Copies into a temporary directory and renames it into place, because a
 * partial copy is worse than no copy: a half-written snapshot directory still
 * *looks* like a valid snapshot to the loader, which would then serve an empty
 * board as though the dataset simply had no players in it.
 */
async function seedSnapshots(snapshotsDir: string): Promise<void> {
  if ((await listSnapshotDirs(snapshotsDir)).length > 0) return;

  const bundled = bundledDatasetsDir();
  const available = await listSnapshotDirs(bundled);
  const newest = available.at(-1);
  if (!newest) return;

  await mkdir(snapshotsDir, { recursive: true });
  const staging = path.join(snapshotsDir, `.${newest}.incoming`);
  await rm(staging, { recursive: true, force: true });

  try {
    await cp(path.join(bundled, newest), staging, { recursive: true });
    await rename(staging, path.join(snapshotsDir, newest));
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Load the newest snapshot from the data directory, seeding it first if empty.
 *
 * Falls back to reading the bundled datasets directly if seeding could not
 * write (a read-only mount, for instance) — serving data matters more than
 * owning a copy of it.
 */
export async function loadSnapshot(dataDir: string): Promise<Snapshot> {
  const snapshotsDir = path.join(dataDir, "snapshots");

  try {
    await seedSnapshots(snapshotsDir);
  } catch {
    // Fall through to the bundled copy below.
  }

  const rejected: string[] = [];
  const candidates: { root: string; versions: string[] }[] = [
    { root: snapshotsDir, versions: await listSnapshotDirs(snapshotsDir) },
    { root: bundledDatasetsDir(), versions: await listSnapshotDirs(bundledDatasetsDir()) },
  ];

  for (const { root, versions } of candidates) {
    for (const version of [...versions].reverse()) {
      const directory = path.join(root, version);
      const file = path.join(directory, "master.csv");
      if (!(await exists(file))) continue;

      const text = await readFileOrNull(file);
      if (text === null) continue;

      const parsed = parseSnapshot(text);
      if (parsed.players.length === 0) {
        // An empty or truncated file — a half-finished copy, or a bad edit.
        // Serving it would show an empty board that looks like a real one, so
        // fall through to the next candidate and report what was rejected.
        rejected.push(`${directory} (parsed 0 players from master.csv)`);
        continue;
      }

      return { version, directory, ...parsed };
    }
  }

  throw new Error(
    `No usable dataset snapshot found. Expected a dated directory containing a ` +
      `non-empty master.csv under ${snapshotsDir} or ${bundledDatasetsDir()}.` +
      (rejected.length > 0 ? ` Rejected: ${rejected.join("; ")}.` : ""),
  );
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse master.csv into players and teams.
 *
 * A row missing a required field is skipped and recorded rather than aborting
 * the load: one malformed line should not take the whole board down.
 */
export function parseSnapshot(text: string): Omit<Snapshot, "version" | "directory"> {
  const rows = parseCsv(text);
  const players: DatasetPlayer[] = [];
  const skipped: { rank: string; reason: string }[] = [];

  for (const row of rows) {
    try {
      players.push(toPlayer(row));
    } catch (error) {
      skipped.push({
        rank: row["rank"] ?? "?",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  players.sort((a, b) => a.rank - b.rank);
  return { players, teams: toTeams(rows), skipped };
}
