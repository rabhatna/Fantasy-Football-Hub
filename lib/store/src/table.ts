import path from "node:path";
import { backupFile, backupStamp, readFileOrNull, writeFileAtomic } from "./atomic.ts";
import { parseCsv, stringifyCsv, type CsvRow } from "./csv.ts";

/**
 * Describes how one record type maps onto CSV columns.
 *
 * `decode` runs against hand-editable input, so it must treat every field as
 * untrusted: a user can open the file in Excel, delete a cell, and re-save.
 * Returning null drops the row rather than failing the whole load.
 */
export interface TableSchema<T> {
  readonly columns: readonly string[];
  encode(record: T): CsvRow;
  decode(row: CsvRow): T | null;
}

/**
 * A CSV file treated as a table of records.
 *
 * Records are held in memory and the file is rewritten in full on every
 * mutation. At the scale this app operates on — a few hundred rows at most —
 * that is far simpler than incremental appends and makes an interrupted write
 * impossible to observe, since the rewrite is atomic.
 *
 * All mutations funnel through a single promise chain, so two concurrent HTTP
 * requests cannot read-modify-write over each other.
 */
export class CsvTable<T> {
  readonly filePath: string;

  private readonly schema: TableSchema<T>;
  private readonly backupDir: string;
  private records: T[] | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Backups are per-session, not per-write — one restore point per run. */
  private backedUp = false;

  constructor(filePath: string, schema: TableSchema<T>, backupDir?: string) {
    this.filePath = filePath;
    this.schema = schema;
    this.backupDir = backupDir ?? path.join(path.dirname(filePath), "backups");
  }

  /** Load from disk, or return the cached records. Missing file means empty. */
  async all(): Promise<T[]> {
    if (this.records === null) {
      const text = await readFileOrNull(this.filePath);
      this.records =
        text === null
          ? []
          : parseCsv(text)
              .map((row) => this.schema.decode(row))
              .filter((record): record is T => record !== null);
    }
    return [...this.records];
  }

  /** Drop the in-memory copy so the next read comes from disk. */
  invalidate(): void {
    this.records = null;
  }

  /**
   * Apply `mutate` to the current records and persist the result.
   *
   * Serialized against every other mutation on this table. The in-memory copy
   * is only updated after the write succeeds, so a failed write leaves the
   * store consistent with what is actually on disk.
   */
  async update<R>(mutate: (records: T[]) => { next: T[]; result: R }): Promise<R> {
    const run = this.queue.then(async () => {
      const current = await this.all();
      const { next, result } = mutate(current);

      if (!this.backedUp) {
        await backupFile(this.filePath, this.backupDir, backupStamp(new Date()));
        this.backedUp = true;
      }

      const rows = next.map((record) => this.schema.encode(record));
      await writeFileAtomic(this.filePath, stringifyCsv(this.schema.columns, rows));

      this.records = next;
      return result;
    });

    // Keep the chain alive even when this mutation rejects, so one failed
    // write does not wedge every later write behind a rejected promise.
    this.queue = run.catch(() => {});
    return run;
  }

  async append(record: T): Promise<T> {
    return this.update((records) => ({ next: [...records, record], result: record }));
  }

  /** Remove every record matching `predicate`; resolves to the count removed. */
  async remove(predicate: (record: T) => boolean): Promise<number> {
    return this.update((records) => {
      const next = records.filter((record) => !predicate(record));
      return { next, result: records.length - next.length };
    });
  }

  /** Insert, or replace in place when `match` finds an existing record. */
  async upsert(record: T, match: (candidate: T) => boolean): Promise<T> {
    return this.update((records) => {
      const index = records.findIndex(match);
      if (index === -1) return { next: [...records, record], result: record };

      const next = [...records];
      next[index] = record;
      return { next, result: record };
    });
  }
}
