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
 * Name fragments that are also ordinary football-news words, so a lone
 * mention can never be pinned on a player: "Bears chase a veteran corner",
 * "Jets travel to London", "Love for the new scheme". Full-name matches are
 * unaffected.
 */
const AMBIGUOUS_NAME_WORDS = new Set([
  "chase", "london", "love", "fields", "hill", "ward", "rice", "young",
  "cook", "day", "moon", "wells", "banks", "law", "worthy", "bell",
]);

/**
 * Find which ranked players a headline is about, by looking for their names in
 * the text.
 *
 * Full names first. When no full name appears, a single name counts only if
 * exactly one ranked player carries it as either a first or last name —
 * "Nacua limited in practice" tags Puka, while "Smith" or "Williams" tag
 * nobody because several players share them, and "Chase" tags nobody because
 * it is both Ja'Marr's surname and other players' first name (and a verb).
 * A headline tagged with the wrong player is worse than an untagged one, so
 * ambiguity always loses.
 */
export function playersMentioned(
  text: string,
  players: readonly MatchablePlayer[],
): MatchablePlayer[] {
  const haystack = ` ${normalizeName(text)} `;

  const byFullName = players.filter((player) => {
    const name = normalizeName(player.name);
    // Require word boundaries so "Chase Brown" does not match "Chase".
    return name.length > 0 && haystack.includes(` ${name} `);
  });
  if (byFullName.length > 0) return byFullName;

  // One pool for first and last names together: a token that is anyone's
  // first name and anyone else's surname is ambiguous, full stop.
  const byToken = new Map<string, Set<MatchablePlayer>>();
  for (const player of players) {
    const parts = normalizeName(player.name).split(" ");
    for (const token of [parts[0], parts.at(-1)]) {
      if (!token || token.length < 4 || AMBIGUOUS_NAME_WORDS.has(token)) continue;
      const bucket = byToken.get(token) ?? new Set();
      bucket.add(player);
      byToken.set(token, bucket);
    }
  }

  // A name unique on this board is not unique across the NFL: "RB Harris"
  // may be a back who is not ranked here at all. Two guards against that:
  // when the headline names a position, the tag must agree with it; and when
  // the name is preceded by a different capitalized first name ("Najee
  // Harris"), the headline is about that other person.
  const positionWords = ["qb", "rb", "wr", "te"].filter((word) =>
    haystack.includes(` ${word} `),
  );
  const rawWords = text.split(/[^A-Za-z'’À-ɏ]+/).filter(Boolean);

  const matched = new Set<MatchablePlayer>();
  for (const [token, bucket] of byToken) {
    if (bucket.size !== 1 || !haystack.includes(` ${token} `)) continue;
    const player = [...bucket][0];
    if (positionWords.length > 0 && !positionWords.includes(player.position.toLowerCase())) {
      continue;
    }

    const playerFirst = normalizeName(player.name).split(" ")[0];
    const claimedBySomeoneElse = rawWords.some((word, index) => {
      if (normalizeName(word) !== token || index === 0) return false;
      const before = rawWords[index - 1];
      // Titlecase word right before the name reads as a first name; if it is
      // not this player's, the mention belongs to someone off the board.
      // All-caps words (positions, team codes) are not names.
      const titlecase = /^[A-Z][a-z'’]/.test(before);
      return titlecase && normalizeName(before) !== playerFirst;
    });
    if (claimedBySomeoneElse) continue;

    matched.add(player);
  }
  return [...matched];
}
