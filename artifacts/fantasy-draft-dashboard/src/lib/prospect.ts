import type { Player } from "@workspace/api-client-react";

/**
 * The prospect line for a rookie: draft capital, college, age, and where he
 * sits on the depth chart — the intel that exists before an NFL snap does.
 * Null for veterans and for rookies the dataset carries nothing on.
 */
export function prospectIntel(player: Player): string | null {
  if (!player.isRookie) return null;
  const parts: string[] = [];
  const { draftRound, draftPick, draftYear, college } = player.advanced;
  if (draftRound !== null) {
    parts.push(
      `Drafted R${draftRound}${draftPick !== null ? `·${draftPick}` : ""}${draftYear !== null ? ` '${String(draftYear).slice(-2)}` : ""}`,
    );
  } else if (draftYear !== null) {
    parts.push(`UDFA '${String(draftYear).slice(-2)}`);
  }
  if (college) parts.push(college);
  if (player.age != null) parts.push(`age ${Math.round(player.age)}`);
  if (player.depthRank != null) {
    parts.push(player.depthRank === 1 ? "depth-chart starter" : `depth ${player.depthRank}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
