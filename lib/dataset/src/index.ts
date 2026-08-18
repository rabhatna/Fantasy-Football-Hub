import { cp, mkdir, readdir, stat } from "node:fs/promises";
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
 * This is what lets a clean clone — and a fresh container with an empty
 * bind-mounted volume — start with data, while still leaving the user free to
 * drop in their own newer snapshot afterwards.
 */
async function seedSnapshots(snapshotsDir: string): Promise<void> {
  if ((await listSnapshotDirs(snapshotsDir)).length > 0) return;

  const bundled = bundledDatasetsDir();
  const available = await listSnapshotDirs(bundled);
  const newest = available.at(-1);
  if (!newest) return;

  await mkdir(snapshotsDir, { recursive: true });
  await cp(path.join(bundled, newest), path.join(snapshotsDir, newest), { recursive: true });
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

      return { version, directory, ...parseSnapshot(text) };
    }
  }

  throw new Error(
    `No dataset snapshot found. Expected a dated directory containing master.csv ` +
      `under ${snapshotsDir} or ${bundledDatasetsDir()}.`,
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
