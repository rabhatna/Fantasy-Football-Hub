import { Scale } from "lucide-react";
import type { Player } from "@workspace/api-client-react";
import { NO_DATA } from "@/lib/format";

const SOURCE_LABELS: Record<string, string> = {
  ffc: "FFC mock drafts",
  sleeper: "Sleeper",
  espn: "ESPN drafts",
  fantasypros_ecr: "FantasyPros ECR",
  dataset: "Dataset",
};

const sourceLabel = (source: string) => SOURCE_LABELS[source] ?? source;

/**
 * Where a player's price comes from: every ADP that went into the consensus,
 * one row per source. Before the first market refresh there is only the
 * dataset column, and the panel says so instead of dressing one number up as
 * a consensus.
 */
export function AdpSources({ player }: { player: Player }) {
  const hasConsensus = player.adpConsensus !== null;
  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm p-5" data-testid="panel-adp-sources">
      <div className="flex items-center justify-between">
        <div>
          <span className="mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            Market price
          </span>
          <h2 className="mt-1 text-sm font-bold">
            {hasConsensus ? "Consensus ADP" : "Dataset ADP"}
          </h2>
        </div>
        <Scale size={15} className="text-muted-foreground" />
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span className="mono text-2xl font-medium">
          {(player.adpConsensus ?? player.adp).toFixed(1)}
        </span>
        <span className="mono pb-1 text-[10px] text-muted-foreground">
          {hasConsensus
            ? `±${player.adpConsensusStdev?.toFixed(1) ?? NO_DATA} across ${player.adpSources.length} sources`
            : "single source"}
        </span>
      </div>
      <div className="mt-3 space-y-2 border-t border-border pt-3 text-[11px]">
        {(player.adpSources.length > 0
          ? player.adpSources
          : [{ source: player.adpSource ?? "dataset", adp: player.adp }]
        ).map((entry) => (
          <div className="flex justify-between" key={entry.source}>
            <span className="text-muted-foreground">{sourceLabel(entry.source)}</span>
            <span className="mono">{entry.adp.toFixed(1)}</span>
          </div>
        ))}
      </div>
      {!hasConsensus && (
        <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
          Hit Refresh to pull live ADP from FFC, Sleeper and ESPN and average them here.
        </p>
      )}
      <p className="mt-3 text-[9px] text-muted-foreground">
        ADP data courtesy of{" "}
        <a
          href="https://fantasyfootballcalculator.com"
          target="_blank"
          rel="noreferrer noopener"
          className="underline hover:text-foreground"
        >
          FantasyFootballCalculator.com
        </a>
      </p>
    </section>
  );
}
