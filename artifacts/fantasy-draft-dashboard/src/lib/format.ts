/**
 * Formatters for a dataset where missing is a real state.
 *
 * 33 of the 250 players took no 2025 snaps, and Next Gen Stats only exist for
 * the positions they apply to. Rendering those as `0.0` would read as "he was
 * terrible" instead of "we have no data", so everything missing renders as an
 * em-dash and nothing silently becomes a zero.
 */

export const NO_DATA = "—";

export function num(value: number | null | undefined, decimals = 1): string {
  return value === null || value === undefined ? NO_DATA : value.toFixed(decimals);
}

export function pct(value: number | null | undefined, decimals = 1): string {
  return value === null || value === undefined ? NO_DATA : `${value.toFixed(decimals)}%`;
}

export function int(value: number | null | undefined): string {
  return value === null || value === undefined ? NO_DATA : Math.round(value).toString();
}

/** Ordinal position finish: #4, or an em-dash when he did not play. */
export function finish(value: number | null | undefined): string {
  return value === null || value === undefined ? NO_DATA : `#${Math.round(value)}`;
}

/**
 * Value score, in standard deviations of production versus draft cost.
 *
 * Always signed: the sign is the whole point, since it says whether the player
 * outproduced his price or the market is charging a premium. This is not a
 * 0-10 rating and is never rendered as one.
 */
export function valueScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_DATA;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

import { VALUE_TARGET_SD } from "@workspace/shared";

export { VALUE_TARGET_SD };

export function valueTone(value: number | null | undefined): string {
  if (value === null || value === undefined) return "text-muted-foreground";
  if (value >= VALUE_TARGET_SD) return "text-primary";
  if (value <= -VALUE_TARGET_SD) return "text-destructive";
  return "text-foreground";
}

/**
 * Position of a value score on a 0-100 bar. Value scores are standard
 * deviations spanning about -3 to +2.5, so the bar is centred on zero: 50% is
 * "priced fairly", not "half as good as possible".
 */
export function valueScoreBar(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Math.min(100, Math.max(0, ((value + 3) / 6) * 100));
}

/** Scale a metric onto 0-100 for a bar, preserving "no data" as zero width. */
export function barWidth(
  value: number | null | undefined,
  min: number,
  max: number,
): number {
  if (value === null || value === undefined || max === min) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

export function hasValue(value: number | null | undefined): value is number {
  return value !== null && value !== undefined;
}
