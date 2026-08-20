import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import type { LeagueSettings } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const SCORING_LABELS: Record<LeagueSettings["scoring"], string> = {
  ppr: "Full PPR",
  half_ppr: "Half PPR",
  standard: "Standard",
};

const ROSTER_SPOTS = ["QB", "RB", "WR", "TE", "FLEX", "K", "DST", "BENCH"] as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mono block text-[9px] uppercase tracking-[0.13em] text-muted-foreground">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

const inputClass =
  "mono w-full rounded-lg border border-border bg-card px-2.5 py-2 text-[12px] font-medium focus:border-primary/50 focus:outline-none";

function NumberInput({
  value,
  onChange,
  min,
  max,
  testId,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  testId: string;
}) {
  return (
    <input
      type="number"
      className={inputClass}
      value={value}
      min={min}
      max={max}
      data-testid={testId}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(Math.trunc(next));
      }}
    />
  );
}

/**
 * League configuration: team count, scoring, draft type and slot, roster
 * shape, and which rounds the user actually holds a pick in. Saved
 * server-side as one document; positional needs, per-game scoring, and the
 * remaining-picks math react immediately, so every query is invalidated on
 * save.
 */
export function SettingsForm({ onSaved }: { onSaved?: () => void }) {
  const [draft, setDraft] = useState<LeagueSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = useGetSettings();
  const update = useUpdateSettings();
  const client = useQueryClient();

  // Seed the form once the server copy arrives; keep edits after that.
  useEffect(() => {
    if (settings.data && draft === null) setDraft(structuredClone(settings.data));
  }, [settings.data, draft]);

  const totalRounds = useMemo(
    () =>
      draft
        ? (Object.values(draft.roster) as number[]).reduce((total, spots) => total + spots, 0)
        : 0,
    [draft],
  );

  const save = () => {
    if (!draft) return;
    if (draft.draftSlot > draft.teamCount) {
      setError(`Draft slot must be within the ${draft.teamCount} teams.`);
      return;
    }
    setError(null);
    update.mutate(
      { data: { ...draft, missingRounds: draft.missingRounds.filter((r) => r <= totalRounds) } },
      {
        onSuccess: () => {
          // Scoring, roster shape and pick ownership touch nearly every
          // number on screen, and a settings save is rare — refetch all.
          void client.invalidateQueries();
          setDraft(null); // re-seed from the saved copy
          onSaved?.();
        },
        onError: () => setError("The server rejected these settings."),
      },
    );
  };

  const patch = (changes: Partial<LeagueSettings>) =>
    setDraft((current) => (current ? { ...current, ...changes } : current));

  const toggleRound = (round: number) =>
    setDraft((current) => {
      if (!current) return current;
      const missing = current.missingRounds.includes(round)
        ? current.missingRounds.filter((r) => r !== round)
        : [...current.missingRounds, round].sort((a, b) => a - b);
      return { ...current, missingRounds: missing };
    });

  if (!draft) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Teams">
          <NumberInput
            value={draft.teamCount}
            min={4}
            max={20}
            testId="input-team-count"
            onChange={(teamCount) => patch({ teamCount })}
          />
        </Field>
        <Field label="Your draft slot">
          <NumberInput
            value={draft.draftSlot}
            min={1}
            max={draft.teamCount}
            testId="input-draft-slot"
            onChange={(draftSlot) => patch({ draftSlot })}
          />
        </Field>
        <Field label="Scoring">
          <select
            className={inputClass}
            value={draft.scoring}
            data-testid="select-scoring"
            onChange={(event) =>
              patch({ scoring: event.target.value as LeagueSettings["scoring"] })
            }
          >
            {Object.entries(SCORING_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Draft type">
          <select
            className={inputClass}
            value={draft.draftType}
            data-testid="select-draft-type"
            onChange={(event) =>
              patch({ draftType: event.target.value as LeagueSettings["draftType"] })
            }
          >
            <option value="snake">Snake</option>
            <option value="auction">Auction</option>
          </select>
        </Field>
        {draft.draftType === "auction" && (
          <Field label="Auction budget">
            <NumberInput
              value={draft.auctionBudget}
              min={1}
              max={1000}
              testId="input-auction-budget"
              onChange={(auctionBudget) => patch({ auctionBudget })}
            />
          </Field>
        )}
      </div>
      <div>
        <span className="mono block text-[9px] uppercase tracking-[0.13em] text-muted-foreground">
          Roster spots
        </span>
        <div className="mt-1.5 grid grid-cols-4 gap-2">
          {ROSTER_SPOTS.map((spot) => (
            <label key={spot} className="block text-center">
              <span className="mono block text-[9px] text-muted-foreground">{spot}</span>
              <input
                type="number"
                className={`${inputClass} mt-1 text-center`}
                value={draft.roster[spot]}
                min={0}
                max={12}
                data-testid={`input-roster-${spot.toLowerCase()}`}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next >= 0) {
                    patch({ roster: { ...draft.roster, [spot]: Math.trunc(next) } });
                  }
                }}
              />
            </label>
          ))}
        </div>
      </div>
      <div>
        <span className="mono block text-[9px] uppercase tracking-[0.13em] text-muted-foreground">
          Rounds you hold a pick in
        </span>
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
          Click a round to mark it traded away — it leaves your remaining-picks math and the
          suggestions adjust.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="grid-round-ownership">
          {Array.from({ length: totalRounds }, (_, index) => index + 1).map((round) => {
            const missing = draft.missingRounds.includes(round);
            return (
              <button
                type="button"
                key={round}
                onClick={() => toggleRound(round)}
                data-testid={`button-round-${round}`}
                title={missing ? `Round ${round}: traded away` : `Round ${round}: yours`}
                className={`mono rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition ${
                  missing
                    ? "border-destructive/40 bg-destructive/10 text-destructive line-through"
                    : "border-border bg-card text-foreground hover:border-primary/40"
                }`}
              >
                R{round}
              </button>
            );
          })}
        </div>
      </div>
      {error && <p className="text-[11px] font-semibold text-destructive">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={update.isPending}
          data-testid="button-settings-save"
          className="flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 disabled:opacity-60"
        >
          {update.isPending && <Loader2 size={12} className="animate-spin" />}
          Save settings
        </button>
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="button-league-settings"
          aria-label="League settings"
          className="rounded-xl border border-border bg-card p-2 text-muted-foreground shadow-sm hover:text-foreground"
        >
          <SlidersHorizontal size={15} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="display text-lg font-bold tracking-tight">
            League settings
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Needs, scoring and pick math all derive from this. Saved on your machine.
          </DialogDescription>
        </DialogHeader>
        <SettingsForm onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
