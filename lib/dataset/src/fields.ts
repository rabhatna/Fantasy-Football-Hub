/**
 * Field readers for the master dataset.
 *
 * The dataset's central rule is that **blank is not zero**. A blank cell means
 * no 2025 snaps (a rookie or a missed season), a sample too small to report, or
 * a metric that does not apply to the position — Next Gen Stats records rushing
 * yards over expected for running backs and separation for receivers, never
 * both for the same player.
 *
 * Coercing those to 0 would silently turn "we don't know" into "he was
 * terrible", which is the exact class of fabrication this ingest exists to
 * remove. Every reader here returns null instead, and the API and UI carry that
 * null all the way through to an em-dash on screen.
 */

export type Row = Record<string, string>;

/** Values pandas writes for a missing cell. */
const BLANK = new Set(["", "nan", "NaN", "NA", "N/A", "None", "null"]);

export function text(row: Row, column: string): string | null {
  const value = row[column]?.trim();
  return value === undefined || BLANK.has(value) ? null : value;
}

/** A required string — throws, because a missing one means the file is wrong. */
export function requiredText(row: Row, column: string): string {
  const value = text(row, column);
  if (value === null) {
    throw new Error(`Dataset row is missing required column "${column}"`);
  }
  return value;
}

export function number(row: Row, column: string): number | null {
  const value = text(row, column);
  if (value === null) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function requiredNumber(row: Row, column: string): number {
  const value = number(row, column);
  if (value === null) {
    throw new Error(`Dataset row is missing required numeric column "${column}"`);
  }
  return value;
}

export function integer(row: Row, column: string): number | null {
  const value = number(row, column);
  return value === null ? null : Math.round(value);
}

export function boolean(row: Row, column: string): boolean {
  return text(row, column)?.toLowerCase() === "true";
}

/** A fraction (0.3043) as a percentage (30.43), preserving null. */
export function percent(row: Row, column: string, decimals = 1): number | null {
  const value = number(row, column);
  return value === null ? null : round(value * 100, decimals);
}

export function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Round while preserving null, for values already on the right scale. */
export function rounded(row: Row, column: string, decimals = 1): number | null {
  const value = number(row, column);
  return value === null ? null : round(value, decimals);
}

/** Clamp into a range, preserving null. */
export function clamp(value: number | null, min: number, max: number): number | null {
  return value === null ? null : Math.min(max, Math.max(min, value));
}

/**
 * Rescale a value from one range onto 0-100, preserving null.
 *
 * Used to put team metrics that live on unrelated scales (adjusted line yards
 * around 3, PFF-style grades out of 100, stuff rate as a fraction) onto a
 * comparable axis. `min`/`max` come from the observed range of the dataset, not
 * from invented bounds — see teams.ts.
 */
export function normalize(
  value: number | null,
  min: number,
  max: number,
  { invert = false }: { invert?: boolean } = {},
): number | null {
  if (value === null || max === min) return null;
  const ratio = (value - min) / (max - min);
  const bounded = Math.min(1, Math.max(0, invert ? 1 - ratio : ratio));
  return round(bounded * 100, 1);
}

/**
 * Weighted average of components that may be missing, renormalising over the
 * ones present. Returns null only when every component is missing, so a team
 * lacking one metric still gets a score from the rest rather than a zero.
 */
export function weightedAverage(
  parts: readonly { value: number | null; weight: number }[],
): number | null {
  const present = parts.filter((part) => part.value !== null);
  if (present.length === 0) return null;

  const totalWeight = present.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight === 0) return null;

  const total = present.reduce((sum, part) => sum + (part.value as number) * part.weight, 0);
  return round(total / totalWeight, 1);
}
