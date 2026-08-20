import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Flame, Star } from "lucide-react";
import { useGetPlayers, useGetSleepers } from "@workspace/api-client-react";
import type { SleeperPick } from "@workspace/api-client-react";
import { useTargets } from "@/hooks/use-targets";

const TAG_LABELS: Record<string, string> = {
  all: "All",
  rookie: "Rookies",
  "early-career": "Year 2–3",
  handcuff: "Handcuffs",
  committee: "Committees",
  value: "Fallers",
  boom: "Boom weeks",
};

const TAG_TONES: Record<string, string> = {
  rookie: "bg-accent/15 text-accent",
  "early-career": "bg-primary/12 text-primary",
  handcuff: "bg-destructive/12 text-destructive",
  committee: "bg-secondary text-secondary-foreground",
  value: "bg-primary/12 text-primary",
  boom: "bg-accent/15 text-accent",
};

function SleeperCard({
  pick,
  targeted,
  onTarget,
  onInspect,
}: {
  pick: SleeperPick;
  targeted: boolean;
  onTarget: () => void;
  onInspect: () => void;
}) {
  return (
    <article
      className="data-row flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm"
      data-testid={`sleeper-${pick.playerId}`}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onInspect} className="min-w-0 text-left">
          <span className="block truncate text-[14px] font-bold hover:text-primary">
            {pick.name}
          </span>
          <span className="mono text-[11px] text-muted-foreground">
            {pick.position} · {pick.team} · ADP {pick.adp.toFixed(1)}
          </span>
        </button>
        <button
          type="button"
          onClick={onTarget}
          data-testid={`button-target-sleeper-${pick.playerId}`}
          title={targeted ? "On your hit list" : "Add to draft targets"}
          className={`shrink-0 rounded-md p-1.5 transition ${targeted ? "text-accent" : "text-muted-foreground/40 hover:text-accent"}`}
        >
          <Star size={15} fill={targeted ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {pick.tags.map((tag) => (
          <span
            key={tag}
            className={`mono rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${TAG_TONES[tag] ?? "bg-muted text-muted-foreground"}`}
          >
            {TAG_LABELS[tag] ?? tag}
          </span>
        ))}
      </div>
      <ul className="space-y-1">
        {pick.reasons.map((reason) => (
          <li key={reason} className="flex gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <span className="text-primary">›</span> {reason}
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * Sleepers and rookies: the players the room is not paying for, each with
 * the argument for why they might matter — filterable down to just rookies,
 * just handcuffs, and so on. Starring one puts him straight on the hit list.
 */
export default function SleepersPage() {
  const { data: sleepers } = useGetSleepers();
  const { data: players } = useGetPlayers();
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState("all");
  const targetState = useTargets();

  const playerById = useMemo(
    () => new Map((players ?? []).map((player) => [player.id, player])),
    [players],
  );

  const picks = sleepers ?? [];
  const visible = filter === "all" ? picks : picks.filter((pick) => pick.tags.includes(filter));
  const counts = useMemo(() => {
    const map = new Map<string, number>([["all", picks.length]]);
    for (const pick of picks) {
      for (const tag of pick.tags) map.set(tag, (map.get(tag) ?? 0) + 1);
    }
    return map;
  }, [picks]);

  return (
    <div className="mx-auto max-w-[1250px]">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <span className="mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Under the radar
          </span>
          <h1 className="display mt-1.5 text-[27px] font-bold tracking-[-0.04em] sm:text-[32px]">
            Sleepers &amp; rookies
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Late prices with real arguments: rookie landing spots, year-two leaps, handcuffs one
            injury from a job, committees with live touches. Star one to put him on your sheet.
          </p>
        </div>
        <Flame size={20} className="shrink-0 text-accent" />
      </div>

      <div className="mb-5 flex gap-2 overflow-x-auto">
        {Object.entries(TAG_LABELS).map(([value, label]) => (
          <button
            type="button"
            key={value}
            onClick={() => setFilter(value)}
            data-testid={`button-sleeper-filter-${value}`}
            className={`shrink-0 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
              filter === value
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {label} ({counts.get(value) ?? 0})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="text-sm font-semibold">Nothing under this lens</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {picks.length === 0
              ? "Hit Refresh so the market, depth chart and injury signals are current."
              : "Try another filter."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((pick) => {
            const player = playerById.get(pick.playerId);
            return (
              <SleeperCard
                key={pick.playerId}
                pick={pick}
                targeted={targetState.targetedIds.has(pick.playerId)}
                onTarget={() => player && targetState.toggleTarget(player)}
                onInspect={() => setLocation(`/players/${pick.playerId}`)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
