/**
 * Constants and predicates shared by the API server and the dashboard.
 *
 * Each of these used to live on both sides of the API with a "keep in sync"
 * comment, and the injury list drifted once already (over Doubtful). The
 * server compares capitalized designations while the client lowercases, so
 * the predicate here is case-insensitive and both sides call it instead of
 * comparing against their own lists.
 */

/** A player's value score at or above this is a genuine market discount. */
export const VALUE_TARGET_SD = 0.5;

/**
 * Statuses that mean the player is unavailable. A null or unknown status is
 * neither healthy nor unhealthy: absence of bad news is not evidence of
 * health, so unknown players are never filtered as unavailable.
 */
export const UNAVAILABLE_INJURY_STATUSES = ["IR", "PUP", "Out", "Doubtful"] as const;

const unavailableLowercase = new Set(
  UNAVAILABLE_INJURY_STATUSES.map((status) => status.toLowerCase()),
);

export function isUnavailableStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return unavailableLowercase.has(status.trim().toLowerCase());
}
