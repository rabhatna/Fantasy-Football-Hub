import { Printer } from "lucide-react";
import {
  useGetDraftSummary,
  useGetKeepers,
  useGetPlayers,
  useGetSettings,
  useGetTargets,
} from "@workspace/api-client-react";
import type { Player } from "@workspace/api-client-react";

const SCORING_LABELS: Record<string, string> = {
  ppr: "Full PPR",
  half_ppr: "Half PPR",
  standard: "Standard",
};

const fmt = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? "—" : value.toFixed(digits);

/**
 * The draft-day sheet: everything worth having on paper when the clock is
 * running — your picks, your keepers, the hit list by round with boxes to
 * tick, and a positional cheat sheet. "Export as PDF" opens the browser's
 * print dialog; save as PDF there or send it straight to a printer. The
 * layout is print-first: black on white, compact, two pages at most.
 */
export default function DraftSheetPage() {
  const { data: players } = useGetPlayers();
  const { data: targets } = useGetTargets();
  const { data: keepers } = useGetKeepers();
  const { data: summary } = useGetDraftSummary();
  const { data: settings } = useGetSettings();

  const pool = players ?? [];
  const keptIds = new Set((keepers ?? []).map((keeper) => keeper.playerId));
  const available = pool.filter((player) => !keptIds.has(player.id));
  const myKeepers = (keepers ?? []).filter((keeper) => keeper.owner === "me");
  const rounds = [...new Set((targets ?? []).map((target) => target.targetRound))].sort(
    (a, b) => a - b,
  );
  const targetById = new Map(pool.map((player) => [player.id, player]));

  const topByPosition = (position: string, count: number): Player[] =>
    available.filter((player) => player.position === position).slice(0, count);

  return (
    <div className="print-sheet mx-auto max-w-[900px]">
      <div className="mb-5 flex items-end justify-between gap-4 print:hidden">
        <div>
          <span className="mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Draft day
          </span>
          <h1 className="display mt-1.5 text-[27px] font-bold tracking-[-0.04em]">
            The sheet you draft from
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Kept players are already off this board. Export, then save as PDF in the print
            dialog — or send it straight to paper.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          data-testid="button-export-pdf"
          className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:-translate-y-0.5"
        >
          <Printer size={14} /> Export as PDF
        </button>
      </div>

      <div className="sheet-body space-y-5 rounded-2xl border border-border bg-card p-6 print:space-y-4 print:rounded-none print:border-0 print:p-0">
        {/* ── Masthead ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-foreground pb-2">
          <h2 className="display text-xl font-bold">Draft sheet</h2>
          <span className="mono text-[11px]">
            {settings
              ? `${settings.teamCount} teams · ${SCORING_LABELS[settings.scoring] ?? settings.scoring} · ${settings.draftType} · slot ${settings.draftSlot}`
              : ""}
            {" · "}
            {new Date().toLocaleDateString([], { dateStyle: "medium" })}
          </span>
        </div>

        {/* ── My picks + keepers ───────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mono text-[11px] font-bold uppercase tracking-[0.12em]">My picks</h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(summary?.remainingPicks ?? []).map((slot) => (
                <span key={slot.overall} className="mono rounded border border-border px-2 py-1 text-[11px] print:border-black">
                  R{slot.round}·{slot.overall}
                </span>
              ))}
              {(summary?.remainingPicks ?? []).length === 0 && (
                <span className="text-[11px] text-muted-foreground">roster complete</span>
              )}
            </div>
          </div>
          <div>
            <h3 className="mono text-[11px] font-bold uppercase tracking-[0.12em]">My keepers</h3>
            {myKeepers.length === 0 ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">none</p>
            ) : (
              <div className="mt-1.5 space-y-1">
                {myKeepers.map((keeper) => (
                  <p key={keeper.id} className="text-[12px]">
                    <span className="font-bold">{keeper.playerName}</span>{" "}
                    <span className="mono text-[10px]">
                      {keeper.position} · {keeper.team} ·{" "}
                      {keeper.costType === "round" ? `round ${keeper.costValue}` : `$${keeper.costValue}`}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Targets by round ─────────────────────────────────────────── */}
        <div>
          <h3 className="mono border-b border-border pb-1 text-[11px] font-bold uppercase tracking-[0.12em] print:border-black">
            Hit list — tick them off as they go
          </h3>
          {rounds.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              No targets yet — star players on the board first.
            </p>
          ) : (
            <div className="mt-2 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {rounds.map((round) => (
                <div key={round} className="break-inside-avoid">
                  <span className="mono text-[11px] font-bold">ROUND {round}</span>
                  {(targets ?? [])
                    .filter((target) => target.targetRound === round)
                    .map((target) => {
                      const player = targetById.get(target.playerId);
                      return (
                        <div key={target.playerId} className="mt-1 flex items-center gap-2 text-[12px]">
                          <span className="inline-block h-3.5 w-3.5 shrink-0 border border-foreground print:border-black" />
                          <span className="font-semibold">{target.playerName}</span>
                          <span className="mono text-[10px] text-muted-foreground">
                            {target.position} · {target.team}
                            {player ? ` · ADP ${fmt(player.adpConsensus ?? player.adp)}` : ""}
                            {player?.byeWeek ? ` · bye ${player.byeWeek}` : ""}
                          </span>
                          {target.note && <span className="text-[10px] italic">{target.note}</span>}
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Positional cheat sheet ───────────────────────────────────── */}
        <div>
          <h3 className="mono border-b border-border pb-1 text-[11px] font-bold uppercase tracking-[0.12em] print:border-black">
            Cheat sheet — best available by position (keepers removed)
          </h3>
          <div className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {(["RB", "WR", "QB", "TE"] as const).map((position) => (
              <table key={position} className="w-full break-inside-avoid border-collapse text-left">
                <thead>
                  <tr className="mono border-b border-border text-[10px] uppercase text-muted-foreground print:border-black">
                    <th className="py-0.5 pr-1 font-semibold">{position}</th>
                    <th className="px-1 text-right font-semibold">ADP</th>
                    <th className="px-1 text-right font-semibold">Proj</th>
                    <th className="px-1 text-right font-semibold">$</th>
                    <th className="px-1 text-right font-semibold">Bye</th>
                  </tr>
                </thead>
                <tbody>
                  {topByPosition(position, 14).map((player) => (
                    <tr key={player.id} className="border-b border-border/50 text-[11px] leading-5 print:border-black/20">
                      <td className="pr-1">
                        <span className="font-semibold">{player.name}</span>{" "}
                        <span className="mono text-[9px] text-muted-foreground">{player.team}</span>
                      </td>
                      <td className="mono px-1 text-right">{fmt(player.adpConsensus ?? player.adp)}</td>
                      <td className="mono px-1 text-right">
                        {player.projectedPoints === null ? "—" : Math.round(player.projectedPoints)}
                      </td>
                      <td className="mono px-1 text-right">
                        {player.aav === null ? "—" : `$${Math.round(player.aav)}`}
                      </td>
                      <td className="mono px-1 text-right">{player.byeWeek || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </div>

        <p className="mono text-[9px] text-muted-foreground">
          Generated by The Draft Room · consensus ADP across FFC, Sleeper, ESPN and FantasyPros ·
          ADP data courtesy of FantasyFootballCalculator.com
        </p>
      </div>
    </div>
  );
}
