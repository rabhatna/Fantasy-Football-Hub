import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Search, X } from "lucide-react";
import {
  getGetDraftSummaryQueryKey,
  getGetKeepersQueryKey,
  getGetRecommendationsQueryKey,
  useDeleteKeeper,
  useGetKeepers,
  useGetPlayers,
  useGetSettings,
  useSaveKeeper,
} from "@workspace/api-client-react";
import type { Keeper, KeeperInput, Player } from "@workspace/api-client-react";

const inputClass =
  "mono w-full rounded-lg border border-border bg-card px-2.5 py-2 text-[12px] font-medium focus:border-primary/50 focus:outline-none";

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </span>
  );
}

function KeeperRow({
  keeper,
  onRemove,
  removing,
}: {
  keeper: Keeper;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
      <span className="mono w-8 text-[10px] text-muted-foreground">{keeper.position}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-bold">{keeper.playerName}</span>
        <span className="mono text-[9px] text-muted-foreground">{keeper.team}</span>
      </span>
      <span className="mono text-[10px] text-muted-foreground">
        {keeper.costType === "round" ? `round ${keeper.costValue}` : `$${keeper.costValue}`}
      </span>
      <button
        type="button"
        onClick={() => onRemove(keeper.id)}
        disabled={removing}
        data-testid={`button-remove-keeper-${keeper.playerId}`}
        aria-label={`Remove keeper ${keeper.playerName}`}
        className="rounded-md p-1 text-muted-foreground opacity-50 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:opacity-30"
      >
        {removing ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
      </button>
    </div>
  );
}

/**
 * Keeper entry: who is already spoken for before pick one. The user's own
 * keepers count toward their roster and consume the configured round;
 * everyone else's simply leave the player pool.
 */
export default function KeepersPage() {
  const { data: players } = useGetPlayers();
  const { data: keepers, isLoading } = useGetKeepers();
  const { data: settings } = useGetSettings();
  const saveKeeper = useSaveKeeper();
  const deleteKeeper = useDeleteKeeper();
  const client = useQueryClient();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Player | null>(null);
  const [owner, setOwner] = useState<KeeperInput["owner"]>("me");
  const [costType, setCostType] = useState<KeeperInput["costType"]>("round");
  const [costValue, setCostValue] = useState(1);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const keptIds = useMemo(
    () => new Set((keepers ?? []).map((keeper) => keeper.playerId)),
    [keepers],
  );

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length < 2) return [];
    return (players ?? [])
      .filter((player) => !keptIds.has(player.id) && player.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [players, search, keptIds]);

  const refreshKeepers = () => {
    void client.invalidateQueries({ queryKey: getGetKeepersQueryKey() });
    void client.invalidateQueries({ queryKey: getGetDraftSummaryQueryKey() });
    void client.invalidateQueries({ queryKey: getGetRecommendationsQueryKey() });
  };

  const addKeeper = () => {
    if (!selected) return;
    saveKeeper.mutate(
      { data: { playerId: selected.id, owner, costType, costValue } },
      {
        onSuccess: () => {
          setSelected(null);
          setSearch("");
          setCostValue(costType === "round" ? 1 : costValue);
          refreshKeepers();
        },
      },
    );
  };

  const removeKeeper = (id: string) => {
    setPendingId(id);
    deleteKeeper.mutate(
      { id },
      { onSuccess: refreshKeepers, onSettled: () => setPendingId(null) },
    );
  };

  const mine = (keepers ?? []).filter((keeper) => keeper.owner === "me");
  const others = (keepers ?? []).filter((keeper) => keeper.owner === "other");

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="mb-5">
        <Kicker>Pre-draft</Kicker>
        <h1 className="display mt-1.5 text-[27px] font-bold tracking-[-0.04em] sm:text-[32px]">
          Keepers
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Your keepers fill roster needs and consume the round they cost; everyone else's just
          come off the board.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <Kicker>Add a keeper</Kicker>
        <div className="relative mt-2">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={selected ? selected.name : search}
            onChange={(event) => {
              setSelected(null);
              setSearch(event.target.value);
            }}
            placeholder="Search the 250-player board"
            data-testid="input-keeper-search"
            className={`${inputClass} pl-8`}
          />
          {matches.length > 0 && !selected && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-lg">
              {matches.map((player) => (
                <button
                  type="button"
                  key={player.id}
                  onClick={() => setSelected(player)}
                  data-testid={`button-keeper-candidate-${player.id}`}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-muted"
                >
                  <span className="mono w-8 text-[10px] text-muted-foreground">{player.position}</span>
                  <span className="font-semibold">{player.name}</span>
                  <span className="mono ml-auto text-[10px] text-muted-foreground">
                    {player.team} · ADP {(player.adpConsensus ?? player.adp).toFixed(1)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <Kicker>Whose team</Kicker>
            <select
              className={`${inputClass} mt-1`}
              value={owner}
              data-testid="select-keeper-owner"
              onChange={(event) => setOwner(event.target.value as KeeperInput["owner"])}
            >
              <option value="me">Mine</option>
              <option value="other">Another team</option>
            </select>
          </label>
          <label className="block">
            <Kicker>Cost</Kicker>
            <select
              className={`${inputClass} mt-1`}
              value={costType}
              data-testid="select-keeper-cost-type"
              onChange={(event) => setCostType(event.target.value as KeeperInput["costType"])}
            >
              <option value="round">Draft round</option>
              <option value="dollars">Auction dollars</option>
            </select>
          </label>
          <label className="block">
            <Kicker>{costType === "round" ? "Round" : "Dollars"}</Kicker>
            <input
              type="number"
              min={costType === "round" ? 1 : 0}
              max={costType === "round" ? 30 : settings?.auctionBudget ?? 200}
              value={costValue}
              data-testid="input-keeper-cost"
              className={`${inputClass} mt-1`}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next) && next >= 0) setCostValue(Math.trunc(next));
              }}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={addKeeper}
              disabled={!selected || saveKeeper.isPending}
              data-testid="button-add-keeper"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 disabled:opacity-50"
            >
              {saveKeeper.isPending ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
              Keep player
            </button>
          </div>
        </div>
        {saveKeeper.isError && (
          <p className="mt-2 text-[11px] font-semibold text-destructive">
            The keeper could not be saved.
          </p>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <Kicker>My keepers</Kicker>
            <span className="mono text-[10px] text-muted-foreground">{mine.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {isLoading ? (
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
            ) : mine.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No keepers yet.</p>
            ) : (
              mine.map((keeper) => (
                <KeeperRow
                  key={keeper.id}
                  keeper={keeper}
                  onRemove={removeKeeper}
                  removing={pendingId === keeper.id}
                />
              ))
            )}
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <Kicker>Other teams' keepers</Kicker>
            <span className="mono text-[10px] text-muted-foreground">{others.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {others.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                None entered. Add the rest of the room's keepers so they leave your board.
              </p>
            ) : (
              others.map((keeper) => (
                <KeeperRow
                  key={keeper.id}
                  keeper={keeper}
                  onRemove={removeKeeper}
                  removing={pendingId === keeper.id}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
