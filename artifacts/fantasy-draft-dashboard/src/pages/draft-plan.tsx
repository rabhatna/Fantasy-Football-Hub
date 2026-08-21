import { useMemo, useState } from "react";
import { Compass, Play, RotateCcw, Star } from "lucide-react";
import { useGetDraftPlan, useGetPlayers } from "@workspace/api-client-react";
import type { GetDraftPlanParams, PlanOption } from "@workspace/api-client-react";
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
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <Kicker>{label}</Kicker>
        <span className={`mono text-[10px] font-bold ${value > 1 ? "text-primary" : value < 1 ? "text-destructive" : "text-muted-foreground"}`}>
          {value === 1 ? "neutral" : `${value.toFixed(2)}×`}
        </span>
      </span>
      <input
        type="range"
        min={0.5}
        max={1.5}
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

function OptionRow({
  option,
  primary,
  targeted,
  onTarget,
}: {
  option: PlanOption;
  primary: boolean;
  targeted: boolean;
  onTarget: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 ${primary ? "bg-muted/70" : ""}`}
      data-testid={`plan-option-${option.playerId}`}
    >
      <span className="mono w-7 shrink-0 text-[10px] text-muted-foreground">{option.position}</span>
      <span className={`min-w-0 flex-1 truncate ${primary ? "text-[13px] font-bold" : "text-[12px] font-semibold"}`}>
        {option.name}
        <span className="mono ml-1.5 text-[9px] font-normal text-muted-foreground">{option.team}</span>
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
  const targetState = useTargets();

  const playerById = useMemo(
    () => new Map((players ?? []).map((player) => [player.id, player])),
    [players],
  );

  const slots = plan?.slots ?? [];
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

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
            A target for every pick you still hold, rebuilt against the live board on every run.
            Tune the strategy, rerun, and star what you like straight onto your sheet.
          </p>
        </div>
        <Compass size={20} className="shrink-0 text-accent" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[290px_minmax(0,1fr)]">
        {/* ── The knobs ─────────────────────────────────────────────────── */}
        <div className="space-y-5 self-start rounded-2xl border border-border bg-card p-5 shadow-sm lg:sticky lg:top-[76px]" data-testid="panel-plan-tuning">
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

        {/* ── The plan ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
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
