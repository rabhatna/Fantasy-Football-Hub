import { Database, RefreshCw } from "lucide-react";
import { useGetDraftSummary, useGetLiveStatus } from "@workspace/api-client-react";

/** What each live source feeds the app, so the status page reads as a map, not a log. */
const SOURCE_NOTES: Record<string, { provides: string; from: string }> = {
  "Sleeper injury designations": {
    provides: "Injury designations, body parts, roster status — board badges and the Healthy filter",
    from: "api.sleeper.app · one call covers every player",
  },
  "ESPN depth charts": {
    provides: "Team depth charts — the depth ranks on the board and the O-Line center's starting five",
    from: "ESPN via nflverse — newest daily snapshot only",
  },
  "FFC ADP": {
    provides: "Live PPR mock-draft ADP with pick spread — one leg of the consensus",
    from: "fantasyfootballcalculator.com · updates daily",
  },
  "Sleeper projections": {
    provides: "2026 season point projections (all scorings) plus Sleeper ADP",
    from: "api.sleeper.com projections",
  },
  "ESPN market values": {
    provides: "Crowd average auction values and ESPN ADP from live drafts",
    from: "ESPN fantasy API",
  },
  "ESPN NFL": { provides: "Headlines for the signal feed", from: "RSS" },
  "CBS Sports NFL": { provides: "Headlines for the signal feed", from: "RSS" },
  ProFootballTalk: { provides: "Headlines for the signal feed", from: "RSS" },
  "Yahoo Sports NFL": { provides: "Headlines for the signal feed", from: "RSS" },
};

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </span>
  );
}

const formatWhen = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never";

/**
 * Every data source in one place: what it feeds, where it comes from, whether
 * the last refresh reached it, and how old what you are looking at is. The
 * page never fetches anything itself — it reads the cached status files.
 */
export default function SourcesPage() {
  const { data: live } = useGetLiveStatus();
  const { data: summary } = useGetDraftSummary();
  const sources = live?.sources ?? [];
  const failing = sources.filter((source) => !source.ok);

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-5">
        <Kicker>Provenance</Kicker>
        <h1 className="display mt-1.5 text-[27px] font-bold tracking-[-0.04em] sm:text-[32px]">
          Where the numbers come from
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing here fetches — the app only reaches out when you hit Refresh, and this page
          shows what that last refresh brought home.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <Kicker>Last successful fetch</Kicker>
          <p className="mono mt-2 text-[13px] font-medium">{formatWhen(live?.fetchedAt)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <Kicker>Last attempt</Kicker>
          <p className="mono mt-2 text-[13px] font-medium">{formatWhen(live?.attemptedAt)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${live?.stale ? "border-destructive/30 bg-destructive/[0.05]" : "border-primary/25 bg-primary/[0.05]"}`}>
          <Kicker>Freshness</Kicker>
          <p className={`mono mt-2 text-[13px] font-medium ${live?.stale ? "text-destructive" : "text-primary"}`}>
            {!live?.fetchedAt ? "nothing fetched yet" : live.stale ? `stale — ${failing.length} source${failing.length === 1 ? "" : "s"} failing` : "all sources current"}
          </p>
        </div>
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <Kicker>Live sources</Kicker>
            <h2 className="mt-1 text-sm font-bold">Fetched on every refresh</h2>
          </div>
          <RefreshCw size={15} className="text-muted-foreground" />
        </div>
        {sources.length === 0 ? (
          <p className="p-5 text-[11px] text-muted-foreground">
            No refresh has run yet. Hit Refresh in the header — until then the app makes zero
            outbound requests.
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {sources.map((source) => {
              const note = SOURCE_NOTES[source.name];
              return (
                <div className="flex items-start gap-3 px-5 py-3.5" key={source.name} data-testid={`source-${source.name.toLowerCase().replaceAll(" ", "-")}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${source.ok ? "bg-primary" : "bg-destructive"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[12px] font-bold">{source.name}</span>
                      {note && <span className="mono text-[9px] text-muted-foreground">{note.from}</span>}
                    </div>
                    {note && <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{note.provides}</p>}
                    <p className={`mono mt-1 text-[10px] ${source.ok ? "text-muted-foreground" : "text-destructive"}`}>
                      {source.ok ? source.detail : `failed: ${source.detail}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <Kicker>Static dataset</Kicker>
            <h2 className="mt-1 text-sm font-bold">The 250-player snapshot</h2>
          </div>
          <Database size={15} className="text-muted-foreground" />
        </div>
        <div className="mt-3 grid gap-3 text-[11px] sm:grid-cols-2">
          <div className="rounded-lg bg-muted/50 p-3">
            <span className="mono block text-[9px] text-muted-foreground">SNAPSHOT VERSION</span>
            <span className="mono mt-1 block text-[13px] font-medium">{summary?.snapshotVersion ?? "—"}</span>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <span className="mono block text-[9px] text-muted-foreground">LOADED</span>
            <span className="mono mt-1 block text-[13px] font-medium">{formatWhen(summary?.lastRefresh)}</span>
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
          Built offline by the ff_analytics pipeline from nflverse (2025 play-by-play, snap
          counts, Next Gen Stats, PFR advanced stats) and FantasyPros ECR. It carries the 2025
          production and market baseline; everything live above is layered on top at read time.
          ADP data courtesy of{" "}
          <a href="https://fantasyfootballcalculator.com" target="_blank" rel="noreferrer noopener" className="underline hover:text-foreground">
            FantasyFootballCalculator.com
          </a>.
        </p>
      </section>
    </div>
  );
}
