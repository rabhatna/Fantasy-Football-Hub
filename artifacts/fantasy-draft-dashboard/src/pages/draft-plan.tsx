import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Compass, Play, RotateCcw, Star, Undo2, X } from "lucide-react";
import { useLocation } from "wouter";
import {
  getGetDraftPlanQueryKey,
  getGetVetoesQueryKey,
  useDeleteVeto,
  useGetDraftPicks,
  useGetDraftPlan,
  useGetKeepers,
  useGetPlayers,
  useGetSettings,
  useGetVetoes,
  useSaveVeto,
} from "@workspace/api-client-react";
import type { GetDraftPlanParams, PlanOption, Player, Target, Veto } from "@workspace/api-client-react";
import { useTargets } from "@/hooks/use-targets";
import { num } from "@/lib/format";

/**
 * The plan room: the draft-plan engine with its knobs exposed. Tweak the
 * strategy — risk appetite, ADP discipline, position leans, QB/TE gates —
 * and rerun; the engine rebuilds the whole round-by-round plan against the
 * live board. Any option can be starred straight onto the target list, or
 * the whole spine of primaries in one click.
 */

interface Tuning {
  risk: "safe" | "balanced" | "upside";
  reach: number;
  options: number;
  biasQB: number;
  biasRB: number;
  biasWR: number;
  biasTE: number;
  qbFrom: number;
  teFrom: number;
  rookies: number;
  sleepers: number;
}

const DEFAULTS: Tuning = {
  risk: "balanced",
  reach: 24,
  options: 4,
  biasQB: 1,
  biasRB: 1,
  biasWR: 1,
  biasTE: 1,
  qbFrom: 1,
  teFrom: 1,
  rookies: 1,
  sleepers: 1,
};

/** Only non-default knobs go on the wire, so the stock plan shares a cache key. */
function toParams(tuning: Tuning): GetDraftPlanParams | undefined {
  const params: GetDraftPlanParams = {};
  if (tuning.risk !== DEFAULTS.risk) params.risk = tuning.risk;
  if (tuning.reach !== DEFAULTS.reach) params.reach = tuning.reach;
  if (tuning.options !== DEFAULTS.options) params.options = tuning.options;
  if (tuning.biasQB !== 1) params.biasQB = tuning.biasQB;
  if (tuning.biasRB !== 1) params.biasRB = tuning.biasRB;
  if (tuning.biasWR !== 1) params.biasWR = tuning.biasWR;
  if (tuning.biasTE !== 1) params.biasTE = tuning.biasTE;
  if (tuning.qbFrom !== 1) params.qbFrom = tuning.qbFrom;
  if (tuning.teFrom !== 1) params.teFrom = tuning.teFrom;
  if (tuning.rookies !== 1) params.rookies = tuning.rookies;
  if (tuning.sleepers !== 1) params.sleepers = tuning.sleepers;
  return Object.keys(params).length > 0 ? params : undefined;
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </span>
  );
}

const RISK_LABELS: Record<Tuning["risk"], { label: string; hint: string }> = {
  safe: { label: "Safe", hint: "only players likely to be there" },
  balanced: { label: "Balanced", hint: "the stock read" },
  upside: { label: "Upside", hint: "chase talent, accept misses" },
};

function BiasSlider({
  label,
  value,
  onChange,
  min = 0.5,
  max = 1.5,
  zeroLabel,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** Label shown when the slider sits at its minimum (e.g. "off"). */
  zeroLabel?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <Kicker>{label}</Kicker>
        <span className={`mono text-[10px] font-bold ${value > 1 ? "text-primary" : value < 1 ? "text-destructive" : "text-muted-foreground"}`}>
          {value === 1 ? "neutral" : value === min && zeroLabel ? zeroLabel : `${value.toFixed(2)}×`}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value}
        data-testid={`slider-bias-${label}`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full accent-[hsl(var(--primary))]"
      />
    </label>
  );
}

function RoundGate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="block">
      <Kicker>{label}</Kicker>
      <select
        className="mono mt-1 w-full rounded-lg border border-border bg-card px-2.5 py-2 text-[12px] font-medium focus:border-primary/50 focus:outline-none"
        value={value}
        data-testid={`select-gate-${label.replaceAll(" ", "-")}`}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        <option value={1}>No gate</option>
        {Array.from({ length: 14 }, (_, index) => index + 2).map((round) => (
          <option key={round} value={round}>
            Round {round}+
          </option>
        ))}
      </select>
    </label>
  );
}

// Positive signals read primary, cautions read destructive, identity reads
// accent — the chip is the engine explaining itself, so tone is meaning.
const SIGNAL_TONES: Record<string, string> = {
  "your guy": "bg-accent/20 text-accent-foreground font-bold",
  "if he falls": "border border-accent/40 bg-transparent text-accent-foreground",
  rookie: "bg-accent/12 text-accent-foreground",
  sleeper: "bg-primary/12 text-primary",
  "handcuff sleeper": "bg-primary/12 text-primary",
  "elite line": "bg-primary/12 text-primary",
  "TD rebound": "bg-primary/12 text-primary",
  "weak line": "bg-destructive/12 text-destructive",
  "TD fade": "bg-destructive/12 text-destructive",
  questionable: "bg-destructive/12 text-destructive",
};

function OptionRow({
  option,
  primary,
  targeted,
  onTarget,
  onVeto,
  onInspect,
}: {
  option: PlanOption;
  primary: boolean;
  targeted: boolean;
  onTarget: () => void;
  onVeto: () => void;
  onInspect: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 ${primary ? "bg-muted/70" : ""}`}
      data-testid={`plan-option-${option.playerId}`}
    >
      <span className="mono w-7 shrink-0 text-[10px] text-muted-foreground">{option.position}</span>
      <span className={`min-w-0 flex-1 ${primary ? "text-[13px] font-bold" : "text-[12px] font-semibold"}`}>
        <button
          type="button"
          onClick={onInspect}
          title={`Open ${option.name}'s full profile`}
          data-testid={`button-inspect-${option.playerId}`}
          className="truncate text-left hover:text-primary hover:underline"
        >
          {option.name}
        </button>
        <span className="mono ml-1.5 text-[9px] font-normal text-muted-foreground">{option.team}</span>
        {option.signals.map((signal) => (
          <span
            key={signal}
            className={`mono ml-1.5 rounded px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide ${SIGNAL_TONES[signal] ?? "bg-muted text-muted-foreground"}`}
          >
            {signal}
          </span>
        ))}
      </span>
      <span className="mono hidden text-[10px] text-muted-foreground sm:inline">
        ADP {num(option.adp)}
      </span>
      <span className="flex w-20 shrink-0 items-center gap-1.5">
        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full ${option.availability >= 0.6 ? "bg-primary" : option.availability >= 0.35 ? "bg-accent" : "bg-destructive/70"}`}
            style={{ width: `${Math.max(6, option.availability * 100)}%` }}
          />
        </span>
        <span className="mono w-8 shrink-0 text-right text-[9px] text-muted-foreground">
          {Math.round(option.availability * 100)}%
        </span>
      </span>
      <span className="mono hidden w-14 text-right text-[9px] uppercase text-muted-foreground md:inline">
        {option.role}
      </span>
      <button
        type="button"
        onClick={onTarget}
        title={targeted ? "On your hit list" : "Add to draft targets"}
        data-testid={`button-plan-target-${option.playerId}`}
        className={`shrink-0 rounded-md p-1 transition ${targeted ? "text-accent" : "text-muted-foreground/40 hover:text-accent"}`}
      >
        <Star size={13} fill={targeted ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        onClick={onVeto}
        title="Strike him from the plan — the engine will never propose him"
        data-testid={`button-plan-veto-${option.playerId}`}
        className="shrink-0 rounded-md p-1 text-muted-foreground/40 transition hover:text-destructive"
      >
        <Ban size={12} />
      </button>
    </div>
  );
}

/** Struck players: never proposed, restorable in one click. */
function VetoPanel({ vetoes, onRestore }: { vetoes: Veto[]; onRestore: (playerId: string) => void }) {
  if (vetoes.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm" data-testid="panel-plan-vetoes">
      <div className="flex items-center justify-between">
        <Kicker>Struck from the plan</Kicker>
        <span className="mono text-[10px] text-muted-foreground">{vetoes.length}</span>
      </div>
      <div className="mt-2.5 max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
        {vetoes.map((veto) => (
          <div
            key={veto.playerId}
            className="group flex items-center gap-2 rounded-lg bg-destructive/5 px-2 py-1.5"
            data-testid={`plan-veto-${veto.playerId}`}
          >
            <span className="mono w-7 shrink-0 text-[9px] text-muted-foreground">{veto.position}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold line-through decoration-destructive/50">
              {veto.playerName}
            </span>
            <button
              type="button"
              onClick={() => onRestore(veto.playerId)}
              title={`Restore ${veto.playerName} to the pool`}
              data-testid={`button-restore-${veto.playerId}`}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-40 transition hover:text-primary group-hover:opacity-100"
            >
              <Undo2 size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Position-percentile of a value among all players at that position. */
function positionPercentile(
  value: number | null | undefined,
  position: string,
  players: Player[],
  read: (player: Player) => number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const pool = players
    .filter((player) => player.position === position)
    .map(read)
    .filter((entry): entry is number => entry !== null && entry !== undefined);
  if (pool.length < 2) return null;
  return (pool.filter((entry) => entry < value).length / (pool.length - 1)) * 100;
}

const seasonPoints = (player: Player): number | null =>
  player.projectedPoints ?? (player.ppg != null ? player.ppg * 17 : null);

interface Outlook {
  overall: number;
  letter: string;
  grades: { label: string; value: number }[];
  projectedTotal: number;
  starters: number;
  startersNeeded: number;
  flags: { label: string; tone: "good" | "warn" }[];
}

/**
 * The projected roster, graded: your keepers and picks plus every primary
 * the plan proposes, read through the advanced layer. Recomputed on every
 * star, veto, and rerun — the answer to "am I building a rounded roster?"
 * while the knobs are still warm.
 */
function rosterOutlook(
  members: Player[],
  players: Player[],
  roster: { QB: number; RB: number; WR: number; TE: number; FLEX: number },
): Outlook | null {
  if (members.length === 0) return null;

  const mean = (values: (number | null | undefined)[]): number | null => {
    const present = values.filter((entry): entry is number => entry != null);
    return present.length === 0
      ? null
      : present.reduce((sum, entry) => sum + entry, 0) / present.length;
  };

  // Talent: where each member sits among his position by projected points.
  const talent = mean(
    members.map((member) =>
      positionPercentile(seasonPoints(member), member.position, players, seasonPoints),
    ),
  );
  // Opportunity: usage percentile — the stickiest thing a player owns.
  const opportunity = mean(
    members.map((member) =>
      positionPercentile(member.share, member.position, players, (entry) => entry.share),
    ),
  );
  // Upside: weekly ceiling percentile.
  const upside = mean(
    members.map((member) =>
      positionPercentile(
        member.consistency.ceiling,
        member.position,
        players,
        (entry) => entry.consistency.ceiling,
      ),
    ),
  );
  // Stability: durability is already 0-100.
  const stability = mean(members.map((member) => member.durabilityScore));

  // Balance: how much of the starting lineup the projected roster covers.
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const member of members) {
    if (member.position in counts) counts[member.position as keyof typeof counts] += 1;
  }
  const flexUsed = (["RB", "WR", "TE"] as const).reduce(
    (used, position) => used + Math.max(0, counts[position] - roster[position]),
    0,
  );
  const startersNeeded = roster.QB + roster.RB + roster.WR + roster.TE + roster.FLEX;
  const starters =
    Math.min(counts.QB, roster.QB) +
    Math.min(counts.RB, roster.RB) +
    Math.min(counts.WR, roster.WR) +
    Math.min(counts.TE, roster.TE) +
    Math.min(flexUsed, roster.FLEX);
  const balance = (starters / Math.max(1, startersNeeded)) * 100;

  const graded = [
    { label: "Talent", value: talent },
    { label: "Opportunity", value: opportunity },
    { label: "Balance", value: balance },
    { label: "Upside", value: upside },
    { label: "Stability", value: stability },
  ].filter((entry): entry is { label: string; value: number } => entry.value !== null);

  const weights: Record<string, number> = {
    Talent: 0.3,
    Opportunity: 0.2,
    Balance: 0.2,
    Upside: 0.15,
    Stability: 0.15,
  };
  const totalWeight = graded.reduce((sum, entry) => sum + weights[entry.label], 0);
  const overall =
    graded.reduce((sum, entry) => sum + entry.value * weights[entry.label], 0) /
    Math.max(0.001, totalWeight);

  const letter =
    overall >= 88 ? "A+" : overall >= 78 ? "A" : overall >= 70 ? "B+" : overall >= 62 ? "B" : overall >= 54 ? "C+" : overall >= 46 ? "C" : "D";

  // Flags: the specific things a grade hides.
  const flags: Outlook["flags"] = [];
  const fades = members.filter((member) => (member.advanced.tdOverExpected ?? 0) >= 3).length;
  if (fades > 0) flags.push({ label: `${fades} TD-regression fade${fades > 1 ? "s" : ""}`, tone: "warn" });
  const rebounds = members.filter((member) => (member.advanced.tdOverExpected ?? 0) <= -2.5).length;
  if (rebounds > 0) flags.push({ label: `${rebounds} TD rebound${rebounds > 1 ? "s" : ""}`, tone: "good" });
  const weakLines = members.filter(
    (member) =>
      member.position === "RB" &&
      (member.oLineGrade ?? 100) < 45 &&
      (member.advanced.targetsPerGame ?? 0) < 4,
  ).length;
  if (weakLines > 0) flags.push({ label: `${weakLines} RB on a weak line`, tone: "warn" });
  const rookies = members.filter((member) => member.isRookie).length;
  if (rookies > 0) flags.push({ label: `${rookies} rookie${rookies > 1 ? "s" : ""}`, tone: "good" });
  const byes = new Map<number, number>();
  for (const member of members) {
    if (member.byeWeek) byes.set(member.byeWeek, (byes.get(member.byeWeek) ?? 0) + 1);
  }
  const worstBye = [...byes.entries()].sort(([, a], [, b]) => b - a)[0];
  if (worstBye && worstBye[1] >= 3) {
    flags.push({ label: `${worstBye[1]} share bye ${worstBye[0]}`, tone: "warn" });
  }

  const projectedTotal = members.reduce((sum, member) => sum + (seasonPoints(member) ?? 0), 0);

  return { overall, letter, grades: graded, projectedTotal, starters, startersNeeded, flags };
}

function OutlookPanel({ outlook }: { outlook: Outlook | null }) {
  if (!outlook) return null;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="panel-roster-outlook">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-3">
          <span
            className={`display text-4xl font-bold tracking-[-0.04em] ${outlook.overall >= 70 ? "text-primary" : outlook.overall >= 54 ? "text-accent-foreground" : "text-destructive"}`}
            data-testid="text-outlook-grade"
          >
            {outlook.letter}
          </span>
          <div>
            <Kicker>Projected roster</Kicker>
            <p className="mono text-[10px] text-muted-foreground">
              ~{Math.round(outlook.projectedTotal)} pts · starters {outlook.starters}/{outlook.startersNeeded}
            </p>
          </div>
        </div>
        <div className="grid min-w-[240px] flex-1 grid-cols-5 gap-2">
          {outlook.grades.map((grade) => (
            <div key={grade.label}>
              <span className="mono block text-[8.5px] uppercase tracking-wide text-muted-foreground">
                {grade.label}
              </span>
              <span className="mono text-[11px] font-bold">{Math.round(grade.value)}</span>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${grade.value >= 70 ? "bg-primary" : grade.value >= 45 ? "bg-accent" : "bg-destructive/70"}`}
                  style={{ width: `${Math.max(4, Math.min(100, grade.value))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        {outlook.flags.length > 0 && (
          <div className="flex w-full flex-wrap gap-1.5">
            {outlook.flags.map((flag) => (
              <span
                key={flag.label}
                className={`mono rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${flag.tone === "good" ? "bg-primary/12 text-primary" : "bg-destructive/12 text-destructive"}`}
              >
                {flag.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Every starred player, wherever the star came from — the board, the
 * sleepers page, or the plan itself — with what the engine did about him.
 * A star the plan cannot serve says why, instead of vanishing: a top-five
 * price never survives to a late first-round pick.
 */
function StarsPanel({
  targets,
  playerById,
  slots,
  keptIds,
  draftedIds,
  onRemove,
}: {
  targets: Target[];
  playerById: Map<string, Player>;
  slots: { round: number; overall: number; options: PlanOption[] }[];
  keptIds: ReadonlySet<string>;
  draftedIds: ReadonlySet<string>;
  onRemove: (playerId: string) => void;
}) {
  const plannedById = useMemo(() => {
    const map = new Map<string, number>();
    for (const slot of slots) {
      for (const option of slot.options) map.set(option.playerId, slot.round);
    }
    return map;
  }, [slots]);
  const firstPick = slots[0]?.overall ?? null;

  const status = (target: Target): { label: string; tone: string } => {
    const planned = plannedById.get(target.playerId);
    if (planned !== undefined) {
      return { label: `planned R${planned}`, tone: "bg-primary/12 text-primary" };
    }
    if (keptIds.has(target.playerId)) {
      return { label: "kept", tone: "bg-muted text-muted-foreground" };
    }
    if (draftedIds.has(target.playerId)) {
      return { label: "drafted", tone: "bg-muted text-muted-foreground" };
    }
    const player = playerById.get(target.playerId);
    const adp = player ? (player.adpConsensus ?? player.adp) : null;
    if (firstPick !== null && adp !== null && adp < firstPick) {
      return { label: `gone by #${firstPick}`, tone: "bg-destructive/12 text-destructive" };
    }
    return { label: "not in plan", tone: "bg-muted text-muted-foreground" };
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm" data-testid="panel-plan-stars">
      <div className="flex items-center justify-between">
        <Kicker>Your stars</Kicker>
        <span className="mono text-[10px] text-muted-foreground">{targets.length}</span>
      </div>
      {targets.length === 0 ? (
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          Star players anywhere — the board, the sleepers, the plan — and they all land here,
          boosted in the engine and guaranteed a slot near their price.
        </p>
      ) : (
        <div className="mt-2.5 max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
          {targets.map((target) => {
            const read = status(target);
            return (
              <div
                key={target.playerId}
                className="group flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5"
                data-testid={`plan-star-${target.playerId}`}
              >
                <span className="mono w-7 shrink-0 text-[9px] text-muted-foreground">
                  {target.position}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
                  {target.playerName}
                </span>
                <span className={`mono shrink-0 rounded px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide ${read.tone}`}>
                  {read.label}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(target.playerId)}
                  aria-label={`Unstar ${target.playerName}`}
                  data-testid={`button-unstar-${target.playerId}`}
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-40 transition hover:text-destructive group-hover:opacity-100"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DraftPlanPage() {
  // Draft state vs applied state: the knobs move freely, the engine only
  // reruns when asked — a plan regenerating mid-drag would be noise.
  const [draft, setDraft] = useState<Tuning>(DEFAULTS);
  const [applied, setApplied] = useState<Tuning>(DEFAULTS);
  const { data: plan, isFetching } = useGetDraftPlan(toParams(applied));
  const { data: players } = useGetPlayers();
  const { data: keepers } = useGetKeepers();
  const { data: picks } = useGetDraftPicks();
  const { data: vetoes } = useGetVetoes();
  const { data: settings } = useGetSettings();
  const saveVeto = useSaveVeto();
  const deleteVeto = useDeleteVeto();
  const client = useQueryClient();
  const targetState = useTargets();
  const [, setLocation] = useLocation();

  const refreshVetoes = () => {
    void client.invalidateQueries({ queryKey: getGetVetoesQueryKey() });
    void client.invalidateQueries({ queryKey: getGetDraftPlanQueryKey() });
  };
  const vetoPlayer = (playerId: string) =>
    saveVeto.mutate({ playerId }, { onSuccess: refreshVetoes });
  const restorePlayer = (playerId: string) =>
    deleteVeto.mutate({ playerId }, { onSuccess: refreshVetoes });

  const playerById = useMemo(
    () => new Map((players ?? []).map((player) => [player.id, player])),
    [players],
  );
  const keptIds = useMemo(
    () => new Set((keepers ?? []).map((keeper) => keeper.playerId)),
    [keepers],
  );
  const draftedIds = useMemo(
    () => new Set((picks ?? []).map((pick) => pick.playerId)),
    [picks],
  );

  const slots = plan?.slots ?? [];
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  // The projected roster: keepers, picks, and every primary — recomputed on
  // each star, veto, and rerun, so the grade moves with the plan.
  const outlook = useMemo(() => {
    const ids = new Set<string>();
    for (const keeper of keepers ?? []) if (keeper.owner === "me") ids.add(keeper.playerId);
    for (const pick of picks ?? []) ids.add(pick.playerId);
    for (const slot of slots) {
      const primary = slot.options[0];
      if (primary) ids.add(primary.playerId);
    }
    const members = [...ids]
      .map((id) => playerById.get(id))
      .filter((player): player is Player => player !== undefined);
    const roster = settings?.roster ?? { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 };
    return rosterOutlook(members, players ?? [], roster);
  }, [keepers, picks, slots, playerById, players, settings]);

  const spine = useMemo(() => {
    const counts = new Map<string, number>();
    for (const slot of slots) {
      const primary = slot.options[0];
      if (primary) counts.set(primary.position, (counts.get(primary.position) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  const starPrimaries = () => {
    for (const slot of slots) {
      const primary = slot.options[0];
      if (!primary || targetState.targetedIds.has(primary.playerId)) continue;
      const player = playerById.get(primary.playerId);
      if (player) targetState.toggleTarget(player);
    }
  };

  const set = <K extends keyof Tuning>(key: K, value: Tuning[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="mx-auto max-w-[1250px]">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <Kicker>The engine, with the hood open</Kicker>
          <h1 className="display mt-1.5 text-[27px] font-bold tracking-[-0.04em] sm:text-[32px]">
            Plan room
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            A target for every pick you still hold, rebuilt against the live board on every run —
            and it reads everything: your stars are boosted and guaranteed a slot, the sleeper
            engine's rookies and handcuffs score, O-line quality shades the runners, and TD
            regression flags both ways. Tune, rerun, star what you like.
          </p>
        </div>
        <Compass size={20} className="shrink-0 text-accent" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[290px_minmax(0,1fr)]">
        <div className="space-y-5 self-start lg:sticky lg:top-[76px]">
        <StarsPanel
          targets={targetState.targets}
          playerById={playerById}
          slots={slots}
          keptIds={keptIds}
          draftedIds={draftedIds}
          onRemove={targetState.removeTarget}
        />
        <VetoPanel vetoes={vetoes ?? []} onRestore={restorePlayer} />
        {/* ── The knobs ─────────────────────────────────────────────────── */}
        <div className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm" data-testid="panel-plan-tuning">
          <div>
            <Kicker>Risk appetite</Kicker>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {(Object.keys(RISK_LABELS) as Tuning["risk"][]).map((risk) => (
                <button
                  type="button"
                  key={risk}
                  onClick={() => set("risk", risk)}
                  data-testid={`button-risk-${risk}`}
                  className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
                    draft.risk === risk
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {RISK_LABELS[risk].label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">{RISK_LABELS[draft.risk].hint}</p>
          </div>

          <label className="block">
            <span className="flex items-baseline justify-between">
              <Kicker>ADP discipline</Kicker>
              <span className="mono text-[10px] font-bold text-foreground">
                {draft.reach} picks
              </span>
            </span>
            <input
              type="range"
              min={6}
              max={48}
              step={2}
              value={draft.reach}
              data-testid="slider-reach"
              onChange={(event) => set("reach", Number(event.target.value))}
              className="mt-1 w-full accent-[hsl(var(--primary))]"
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              How far past a pick's price a target may reach before it stops fitting. Low = strict
              to the market; high = get your guys.
            </p>
          </label>

          <label className="block">
            <Kicker>Fallbacks per round</Kicker>
            <select
              className="mono mt-1 w-full rounded-lg border border-border bg-card px-2.5 py-2 text-[12px] font-medium focus:border-primary/50 focus:outline-none"
              value={draft.options}
              data-testid="select-options"
              onChange={(event) => set("options", Number(event.target.value))}
            >
              {[2, 3, 4, 5, 6].map((count) => (
                <option key={count} value={count}>
                  {count} options
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2.5">
            <Kicker>Position lean</Kicker>
            <BiasSlider label="QB" value={draft.biasQB} onChange={(next) => set("biasQB", next)} />
            <BiasSlider label="RB" value={draft.biasRB} onChange={(next) => set("biasRB", next)} />
            <BiasSlider label="WR" value={draft.biasWR} onChange={(next) => set("biasWR", next)} />
            <BiasSlider label="TE" value={draft.biasTE} onChange={(next) => set("biasTE", next)} />
          </div>

          <div className="space-y-2.5">
            <Kicker>Signal dials</Kicker>
            <BiasSlider
              label="Rookies"
              value={draft.rookies}
              onChange={(next) => set("rookies", next)}
            />
            <BiasSlider
              label="Sleeper reads"
              value={draft.sleepers}
              onChange={(next) => set("sleepers", next)}
              min={0}
              max={2}
              zeroLabel="off"
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              Rookies scales every rookie's whole score; sleeper reads scales how much the
              sleeper engine's tags count.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <RoundGate label="Wait on QB" value={draft.qbFrom} onChange={(next) => set("qbFrom", next)} />
            <RoundGate label="Wait on TE" value={draft.teFrom} onChange={(next) => set("teFrom", next)} />
          </div>

          <div className="flex gap-2 border-t border-border/60 pt-4">
            <button
              type="button"
              onClick={() => setApplied(draft)}
              disabled={!dirty && !isFetching}
              data-testid="button-run-engine"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 disabled:opacity-50"
            >
              <Play size={12} />
              {isFetching ? "Running…" : dirty ? "Rerun the engine" : "Plan is current"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(DEFAULTS);
                setApplied(DEFAULTS);
              }}
              title="Back to the balanced stock plan"
              data-testid="button-reset-tuning"
              className="rounded-xl border border-border p-2 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>
        </div>

        {/* ── The plan ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <OutlookPanel outlook={outlook} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="mono flex flex-wrap gap-3 text-[10px] text-muted-foreground" data-testid="strip-plan-spine">
              {spine.map(([position, count]) => (
                <span key={position}>
                  <span className="font-bold text-foreground">{count}</span> {position}
                </span>
              ))}
              {slots.length > 0 && (
                <span>
                  <span className="font-bold text-foreground">{slots.length}</span> picks
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={starPrimaries}
              disabled={slots.every((slot) => !slot.options[0] || targetState.targetedIds.has(slot.options[0].playerId))}
              data-testid="button-star-primaries"
              className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground transition hover:text-accent disabled:opacity-40"
            >
              <Star size={12} />
              Star every primary
            </button>
          </div>

          {slots.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center">
              <p className="text-sm font-semibold">Nothing to plan</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Roster complete — or the board hasn't loaded yet.
              </p>
            </div>
          ) : (
            slots.map((slot) => (
              <section
                key={slot.overall}
                className={`rounded-2xl border border-border bg-card p-3.5 shadow-sm transition ${isFetching ? "opacity-60" : ""}`}
                data-testid={`plan-room-slot-${slot.round}`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="mono rounded-md bg-muted px-2 py-1 text-[10px] font-bold">
                    R{slot.round}
                  </span>
                  <Kicker>pick #{slot.overall}</Kicker>
                  {slot.options.length > 1 && (
                    <span className="mono ml-auto text-[9px] text-muted-foreground">
                      {slot.options.length - 1} fallback{slot.options.length === 2 ? "" : "s"}
                    </span>
                  )}
                </div>
                {slot.options.length === 0 ? (
                  <p className="mt-2 text-[11px] italic text-muted-foreground">{slot.note}</p>
                ) : (
                  <div className="mt-2 space-y-1">
                    {slot.options.map((option, index) => {
                      const player = playerById.get(option.playerId);
                      return (
                        <OptionRow
                          key={option.playerId}
                          option={option}
                          primary={index === 0}
                          targeted={targetState.targetedIds.has(option.playerId)}
                          onTarget={() => player && targetState.toggleTarget(player)}
                          onVeto={() => vetoPlayer(option.playerId)}
                          onInspect={() => setLocation(`/players/${option.playerId}`)}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            ))
          )}

          <p className="mono text-[9px] text-muted-foreground">
            Availability is the chance he survives to that pick at consensus ADP. No name repeats
            across the plan; the lineup fills before the bench. The draft sheet prints the stock
            balanced plan.
          </p>
        </div>
      </div>
    </div>
  );
}
