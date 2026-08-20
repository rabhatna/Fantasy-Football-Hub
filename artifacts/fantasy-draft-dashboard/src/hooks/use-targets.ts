import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTargetsQueryKey,
  useDeleteTarget,
  useGetSettings,
  useGetTargets,
  useSaveTarget,
} from "@workspace/api-client-react";
import type { Player, Target } from "@workspace/api-client-react";

/**
 * The draft target list: server-backed, one row per player with the round the
 * user plans to spend. Toggling a player on picks a sensible default round
 * from his consensus ADP and the league size; the round is editable after.
 */
export function useTargets() {
  const queryClient = useQueryClient();
  const { data: targets } = useGetTargets();
  const { data: settings } = useGetSettings();
  const saveTarget = useSaveTarget();
  const deleteTarget = useDeleteTarget();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const byPlayerId = useMemo(
    () => new Map((targets ?? []).map((target) => [target.playerId, target])),
    [targets],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetTargetsQueryKey() });
  }, [queryClient]);

  const toggleTarget = useCallback(
    (player: Player) => {
      if (pendingId) return;
      setPendingId(player.id);
      const done = { onSuccess: refresh, onSettled: () => setPendingId(null) };

      if (byPlayerId.has(player.id)) {
        deleteTarget.mutate({ playerId: player.id }, done);
        return;
      }
      const teamCount = settings?.teamCount ?? 12;
      const adp = player.adpConsensus ?? player.adp;
      const targetRound = Math.max(1, Math.min(30, Math.ceil(adp / teamCount)));
      saveTarget.mutate({ playerId: player.id, data: { targetRound } }, done);
    },
    [pendingId, byPlayerId, settings, saveTarget, deleteTarget, refresh],
  );

  const setRound = useCallback(
    (target: Target, targetRound: number) => {
      if (targetRound < 1) return;
      saveTarget.mutate(
        { playerId: target.playerId, data: { targetRound, note: target.note } },
        { onSuccess: refresh },
      );
    },
    [saveTarget, refresh],
  );

  return {
    targets: targets ?? [],
    targetedIds: byPlayerId,
    toggleTarget,
    setRound,
    removeTarget: (playerId: string) =>
      deleteTarget.mutate({ playerId }, { onSuccess: refresh }),
    pendingId,
  };
}
