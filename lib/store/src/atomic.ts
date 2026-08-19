import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";

/**
 * Durable file replacement.
 *
 * A plain `writeFile` over an existing file truncates it first, so a crash or a
 * full disk mid-write leaves a half-written file and the previous contents are
 * gone. Since these files are the only copy of the user's draft board, every
 * write goes through: write temp -> fsync temp -> rename over target. Rename is
 * atomic within a filesystem, so a reader either sees the whole old file or the
 * whole new one, never a partial.
 */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });

  // Keep the temp file in the same directory so the rename stays on one
  // filesystem — across devices it degrades to a non-atomic copy.
  const unique = createHash("sha256")
    .update(`${filePath}:${process.pid}:${performance.now()}`)
    .digest("hex")
    .slice(0, 12);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${unique}.tmp`);

  let handle;
  try {
    handle = await open(tempPath, "w");
    await handle.writeFile(contents, "utf8");
    // Force the bytes to disk before the rename; without this the rename can
    // land before the data does and a power loss yields an empty file.
    await handle.sync();
  } finally {
    await handle?.close();
  }

  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }

  // fsync the directory so the rename itself is durable.
  let dirHandle;
  try {
    dirHandle = await open(directory, "r");
    await dirHandle.sync();
  } catch {
    // Directory fsync is not permitted on every platform/filesystem
    // (notably some Windows and network mounts). The rename already
    // happened; this is a durability upgrade, not a correctness requirement.
  } finally {
    await dirHandle?.close();
  }
}

/**
 * Errors that mean "try again", not "this failed".
 *
 * On macOS a file in an iCloud-synced folder (~/Documents and ~/Desktop by
 * default) can be evicted to the cloud — `stat` reports it as `dataless` with
 * zero blocks. Reading it triggers an on-demand download, and a read that
 * blocks too long comes back as ECANCELED. The retry is what turns that into a
 * short pause instead of an unexplained empty board.
 */
const TRANSIENT_READ_ERRORS = new Set(["ECANCELED", "EBUSY", "EAGAIN", "EINTR"]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read a file, returning null when it does not exist yet. */
export async function readFileOrNull(filePath: string, attempts = 3): Promise<string | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      if (!code || !TRANSIENT_READ_ERRORS.has(code) || attempt >= attempts) throw error;

      // Back off a little; the first read has already asked the OS to
      // materialise the file, so the next one usually lands.
      await delay(attempt * 250);
    }
  }
}

/**
 * Snapshot a file into `backups/` before it is modified.
 *
 * Cheap insurance against the failure this whole layer exists to prevent: a bad
 * write, a bad hand-edit, or a bug that empties the board. Backups are kept per
 * file and pruned to `keep` most recent.
 */
export async function backupFile(
  filePath: string,
  backupDir: string,
  stamp: string,
  keep = 20,
): Promise<void> {
  const source = await readFileOrNull(filePath);
  if (source === null) return; // nothing to back up yet

  await mkdir(backupDir, { recursive: true });
  const base = path.basename(filePath, path.extname(filePath));
  const extension = path.extname(filePath);
  await copyFile(filePath, path.join(backupDir, `${base}.${stamp}${extension}`));

  await pruneBackups(backupDir, base, extension, keep);
}

async function pruneBackups(
  backupDir: string,
  base: string,
  extension: string,
  keep: number,
): Promise<void> {
  const entries = await readdir(backupDir).catch(() => [] as string[]);
  const mine = entries
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith(extension))
    // Timestamps are lexicographically sortable, so newest sorts last.
    .sort();

  for (const stale of mine.slice(0, Math.max(0, mine.length - keep))) {
    await unlink(path.join(backupDir, stale)).catch(() => {});
  }
}

/** Filesystem-safe, lexicographically sortable timestamp: 2026-08-18T15-04-11-231Z */
export function backupStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}
