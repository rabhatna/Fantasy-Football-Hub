import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDraftPicksQueryKey,
  getGetDraftPlanQueryKey,
  getGetDraftSummaryQueryKey,
  getGetNotesQueryKey,
  getGetRecommendationsQueryKey,
  savePlayerNote,
  useDeleteDraftPick,
  useGetDraftPicks,
  useGetNotes,
  useSaveDraftPick,
  useSavePlayerNote,
} from "@workspace/api-client-react";
import type { DraftPick, Player } from "@workspace/api-client-react";

/**
 * Draft state used to live in localStorage, which meant it was scoped to one
 * browser profile and vanished when site data was cleared. It now lives in CSV
 * files on disk, served over the API. These keys are only still referenced to
 * migrate a board that predates that change.
 */
const LEGACY_DRAFTED_KEY = "draft-command-center:drafted";
const LEGACY_NOTES_KEY = "draft-command-center:notes";
const MIGRATED_KEY = "draft-command-center:migrated-to-files";

function readLegacyJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Board state, read from and written to the server.
 *
 * Mutations invalidate the picks and summary queries rather than tracking a
 * local mirror, so what is rendered is always what is actually on disk.
 */
export function useDraftBoard(players: Player[]) {
  const queryClient = useQueryClient();
  const { data: picks, isLoading, isError } = useGetDraftPicks();
  const savePick = useSaveDraftPick();
  const deletePick = useDeleteDraftPick();

  const [pendingId, setPendingId] = useState<string | null>(null);

  const draftedIds = useMemo(
    () => (picks ?? []).map((pick) => pick.playerId),
    [picks],
  );

  const refreshBoard = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: getGetDraftPicksQueryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetDraftSummaryQueryKey(),
    });
    // Suggestions depend on the board: every pick changes needs and timing.
    void queryClient.invalidateQueries({
      queryKey: getGetRecommendationsQueryKey(),
    });
    // So does the round-by-round plan.
    void queryClient.invalidateQueries({
      queryKey: getGetDraftPlanQueryKey(),
    });
  }, [queryClient]);

  useLegacyMigration(picks, isLoading, savePick, refreshBoard, queryClient);

  const draftPlayer = useCallback(
    (player: Player) => {
      if (draftedIds.includes(player.id) || pendingId) return;
      setPendingId(player.id);
      // No pickNumber: the server assigns the next remaining overall, which
      // accounts for keeper-consumed rounds the client cannot see.
      savePick.mutate(
        { data: { playerId: player.id } },
        {
          onSuccess: refreshBoard,
          onSettled: () => setPendingId(null),
        },
      );
    },
    [draftedIds, pendingId, savePick, refreshBoard],
  );

  const undraftPlayer = useCallback(
    (playerId: string) => {
      if (pendingId) return;
      setPendingId(playerId);
      deletePick.mutate(
        { playerId },
        {
          onSuccess: refreshBoard,
          onSettled: () => setPendingId(null),
        },
      );
    },
    [pendingId, deletePick, refreshBoard],
  );

  const draftedPlayers = useMemo(() => {
    const byId = new Map(players.map((player) => [player.id, player]));
    return (picks ?? []).map((pick) => ({
      pick,
      player: byId.get(pick.playerId),
    }));
  }, [picks, players]);

  return {
    picks: picks ?? [],
    draftedIds,
    draftedPlayers,
    draftPlayer,
    undraftPlayer,
    pendingId,
    isLoading,
    // A read failure means the board on screen may not match the board on
    // disk — the UI has to say so rather than render an empty board.
    isUnavailable: isError,
    saveFailed: savePick.isError || deletePick.isError,
  };
}

/**
 * One-time import of a board built before persistence existed.
 *
 * Picks only import when the server has none, so this can never duplicate or
 * overwrite a real board. Notes are imported alongside them — they were the
 * other half of the localStorage state, and losing them on upgrade would be
 * exactly the data loss this phase set out to prevent.
 *
 * Marks itself done regardless of outcome, so a partial failure does not retry
 * on every mount. The localStorage keys are left in place as a safety net.
 */
function useLegacyMigration(
  picks: DraftPick[] | undefined,
  isLoading: boolean,
  savePick: ReturnType<typeof useSaveDraftPick>,
  refreshBoard: () => void,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || isLoading || picks === undefined) return;
    if (localStorage.getItem(MIGRATED_KEY) === "true") return;

    attempted.current = true;

    const legacyIds = readLegacyJson<string[]>(LEGACY_DRAFTED_KEY, []);
    const legacyNotes = readLegacyJson<Record<string, string>>(
      LEGACY_NOTES_KEY,
      {},
    );
    const importPicks = picks.length === 0 && legacyIds.length > 0;
    const noteEntries = Object.entries(legacyNotes).filter(
      ([, note]) => note.trim() !== "",
    );

    if (!importPicks && noteEntries.length === 0) {
      localStorage.setItem(MIGRATED_KEY, "true");
      return;
    }

    void (async () => {
      if (importPicks) {
        for (const [index, playerId] of legacyIds.entries()) {
          try {
            await savePick.mutateAsync({
              data: { playerId, pickNumber: index + 1 },
            });
          } catch {
            // A player that no longer exists in the dataset cannot be imported;
            // skip it rather than abandoning the rest of the board.
          }
        }
      }

      for (const [playerId, note] of noteEntries) {
        try {
          await savePlayerNote(playerId, { note });
        } catch {
          // Same reasoning as picks: one unknown player must not block the rest.
        }
      }

      localStorage.setItem(MIGRATED_KEY, "true");
      refreshBoard();
      void queryClient.invalidateQueries({ queryKey: getGetNotesQueryKey() });
    })();
  }, [picks, isLoading, savePick, refreshBoard, queryClient]);
}

export type NoteStatus = "idle" | "saving" | "saved" | "error";

/**
 * A player note backed by the server, debounced so typing does not issue a
 * write per keystroke. Also flushes on unmount, so navigating away mid-edit
 * does not silently drop the last few characters.
 */
export function usePlayerNote(player: Player) {
  const queryClient = useQueryClient();
  const { data: notes } = useGetNotes();
  const saveNote = useSavePlayerNote();

  const stored = useMemo(
    () => notes?.find((note) => note.playerId === player.id)?.note ?? "",
    [notes, player.id],
  );

  const [draft, setDraft] = useState(stored);
  const [status, setStatus] = useState<NoteStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  // Adopt the server value when it arrives, or when switching players, but not
  // while the user is mid-edit — that would overwrite what they are typing.
  useEffect(() => {
    if (pending.current === null) setDraft(stored);
  }, [stored, player.id]);

  const flush = useCallback(() => {
    const value = pending.current;
    if (value === null) return;

    pending.current = null;
    setStatus("saving");
    saveNote.mutate(
      { playerId: player.id, data: { note: value } },
      {
        onSuccess: () => {
          setStatus("saved");
          void queryClient.invalidateQueries({
            queryKey: getGetNotesQueryKey(),
          });
        },
        onError: () => setStatus("error"),
      },
    );
  }, [player.id, saveNote, queryClient]);

  const update = useCallback(
    (value: string) => {
      setDraft(value);
      pending.current = value;
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [flush],
  );

  // Held in a ref so the cleanup below can stay unmount-only. Depending on
  // `flush` directly would tear the effect down every time the mutation object
  // changes identity, cancelling the pending debounce mid-keystroke.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      flushRef.current();
    };
  }, []);

  return { note: draft, updateNote: update, status };
}

export { LEGACY_NOTES_KEY };
