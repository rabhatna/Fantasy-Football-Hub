import { Link } from "wouter";
import { Printer, Star, X } from "lucide-react";
import type { Target } from "@workspace/api-client-react";

/**
 * The draft-day hit list: players the user has starred, grouped by the round
 * they plan to spend. Rounds are editable in place; the printable sheet is
 * one click away.
 */
export function TargetList({
  targets,
  onSetRound,
  onRemove,
  onInspect,
}: {
  targets: Target[];
  onSetRound: (target: Target, round: number) => void;
  onRemove: (playerId: string) => void;
  onInspect: (playerId: string) => void;
}) {
  const rounds = [...new Set(targets.map((target) => target.targetRound))].sort((a, b) => a - b);

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm" data-testid="panel-targets">
      <div className="flex items-center justify-between border-b border-border px-4 py-4">
        <div>
          <span className="mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Hit list
          </span>
          <h2 className="mt-1 text-sm font-bold">My targets</h2>
        </div>
        <Star size={16} className="text-accent" />
      </div>
      {targets.length === 0 ? (
        <p className="p-5 text-[11px] leading-4 text-muted-foreground">
          Star players on the board to build the list you draft from — then print it.
        </p>
      ) : (
        <div className="p-3">
          {rounds.map((round) => (
            <div key={round} className="mb-2 last:mb-0">
              <span className="mono block px-1 text-[10px] font-semibold text-muted-foreground">
                ROUND {round}
              </span>
              <div className="mt-1 space-y-1.5">
                {targets
                  .filter((target) => target.targetRound === round)
                  .map((target) => (
                    <div
                      key={target.playerId}
                      className="group flex items-center gap-2 rounded-xl bg-muted/60 px-2.5 py-2"
                      data-testid={`target-${target.playerId}`}
                    >
                      <span className="mono w-8 shrink-0 text-[10px] text-muted-foreground">
                        {target.position}
                      </span>
                      <button
                        type="button"
                        onClick={() => onInspect(target.playerId)}
                        className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold hover:text-primary"
                      >
                        {target.playerName}
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={target.targetRound}
                        title="The round you plan to take him"
                        data-testid={`input-target-round-${target.playerId}`}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next) && next >= 1) {
                            onSetRound(target, Math.trunc(next));
                          }
                        }}
                        className="mono w-12 rounded-md border border-border bg-card px-1.5 py-1 text-center text-[11px] focus:border-primary/50 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => onRemove(target.playerId)}
                        data-testid={`button-untarget-${target.playerId}`}
                        aria-label={`Remove target ${target.playerName}`}
                        className="rounded-md p-1 text-muted-foreground opacity-50 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <Link
        href="/draft-sheet"
        data-testid="link-draft-sheet"
        className="flex items-center justify-between border-t border-border px-4 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-primary hover:bg-primary/[0.06]"
      >
        Print the draft sheet <Printer size={14} />
      </Link>
    </section>
  );
}
