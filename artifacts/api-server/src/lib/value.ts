/**
 * Value scores recomputed against consensus ADP.
 *
 * The dataset ships a `value_score` built from its single ADP column, which in
 * the current snapshot is almost entirely the FantasyPros ECR fallback. Once
 * live market sources are cached, the same production-versus-price idea can be
 * priced against the consensus instead: positive still means the market is
 * charging less than his 2025 production merits.
 *
 * Same construction as the pipeline's: Z-score of 2025 positional finish
 * against Z-score of consensus positional ADP rank, per position. Computed
 * locally over the 250-player board, so magnitudes can differ slightly from
 * the pipeline's column — the UI labels which one it is showing.
 */

export interface ValueScoreInput {
  id: string;
  position: string;
  productionFinish: number | null;
  adpConsensus: number | null;
}

function zScores(values: readonly number[]): (value: number) => number | null {
  if (values.length < 2) return () => null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return () => null;
  return (value) => (value - mean) / stdev;
}

/**
 * Map of player id to consensus value score, for the players where it can be
 * computed: a 2025 positional finish and a consensus ADP are both required.
 */
export function consensusValueScores(players: readonly ValueScoreInput[]): Map<string, number> {
  const result = new Map<string, number>();
  const byPosition = new Map<string, ValueScoreInput[]>();
  for (const player of players) {
    const group = byPosition.get(player.position);
    if (group) group.push(player);
    else byPosition.set(player.position, [player]);
  }

  for (const group of byPosition.values()) {
    // Positional ADP rank: 1 = drafted first at the position.
    const priced = group
      .filter((player) => player.adpConsensus !== null)
      .sort((a, b) => (a.adpConsensus ?? 0) - (b.adpConsensus ?? 0));
    const adpRank = new Map(priced.map((player, index) => [player.id, index + 1]));

    const finished = group.filter((player) => player.productionFinish !== null);

    const zAdp = zScores([...adpRank.values()]);
    const zFinish = zScores(finished.map((player) => player.productionFinish ?? 0));

    for (const player of group) {
      const rank = adpRank.get(player.id);
      if (rank === undefined || player.productionFinish === null) continue;
      const priceZ = zAdp(rank);
      const finishZ = zFinish(player.productionFinish);
      if (priceZ === null || finishZ === null) continue;

      // A low finish is good and a low ADP rank is expensive, so value is
      // "price rank later than finish rank": zAdp − zFinish. A player who
      // finished 3rd but is being drafted 12th at his position scores
      // positive — the market is underpricing the production.
      result.set(player.id, Number((priceZ - finishZ).toFixed(2)));
    }
  }

  return result;
}
