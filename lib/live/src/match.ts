/**
 * Matching players between the dataset and live sources.
 *
 * The dataset keys on nflverse gsis_id, which would be the obvious join — but
 * Sleeper leaves gsis_id null for most active players (Ja'Marr Chase, Jahmyr
 * Gibbs and Puka Nacua among them), so keying on it alone matched only 38 of
 * 250. Falling back to a normalised name plus position covers the rest.
 *
 * Assigning an injury to the wrong player is worse than reporting none, so an
 * ambiguous match is dropped rather than guessed at.
 */

export interface MatchablePlayer {
  id: string;
  name: string;
  team: string;
  position: string;
}

export interface MatchableSource {
  gsisId: string | null;
  name: string;
  team: string | null;
  position: string | null;
}

export function normalizeName(name: string): string {
  const parts = name.split(",");
  const ordered = parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;

  return ordered
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Index live records so players can be looked up by either key.
 *
 * Returns a function from a dataset player to the matching source record, or
 * undefined when there is no confident match.
 */
export function buildMatcher<T extends MatchableSource>(
  sources: readonly T[],
): (player: MatchablePlayer) => T | undefined {
  const byGsis = new Map<string, T>();
  const byNamePosition = new Map<string, T[]>();

  for (const source of sources) {
    if (source.gsisId) byGsis.set(source.gsisId, source);
    if (!source.position) continue;

    const key = `${normalizeName(source.name)}|${source.position}`;
    const bucket = byNamePosition.get(key);
    if (bucket) bucket.push(source);
    else byNamePosition.set(key, [source]);
  }

  return (player) => {
    const byId = byGsis.get(player.id);
    if (byId) return byId;

    const candidates = byNamePosition.get(`${normalizeName(player.name)}|${player.position}`);
    if (!candidates || candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];

    // Same name and position: only the team can separate them. If it cannot,
    // report nothing rather than attach a status to the wrong player.
    const sameTeam = candidates.filter((candidate) => candidate.team === player.team);
    return sameTeam.length === 1 ? sameTeam[0] : undefined;
  };
}

/**
 * Find which ranked players a headline is about, by looking for their names in
 * the text.
 *
 * Full names only. Surnames alone produce too many false positives — "Smith"
 * or "Williams" would attach a headline to several players at once, and a
 * headline tagged with the wrong player is worse than an untagged one.
 */
export function playersMentioned(
  text: string,
  players: readonly MatchablePlayer[],
): MatchablePlayer[] {
  const haystack = ` ${normalizeName(text)} `;

  return players.filter((player) => {
    const name = normalizeName(player.name);
    // Require word boundaries so "Chase Brown" does not match "Chase".
    return name.length > 0 && haystack.includes(` ${name} `);
  });
}
