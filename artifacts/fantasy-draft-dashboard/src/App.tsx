import { useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowDown, ArrowUp, BarChart3, Bell, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Command, ExternalLink, Filter, Flame, LayoutGrid, LineChart, ListFilter, Loader2, Menu, Moon, Newspaper, PanelRight, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Sparkles, Sun, Target, TrendingDown, TrendingUp, Users, X, Zap } from "lucide-react";
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  getGetDraftSummaryQueryKey,
  getGetNewsQueryKey,
  getGetOLImpactQueryKey,
  getGetPlayersQueryKey,
  getGetTeamsQueryKey,
  getGetPlayerQueryKey,
  useGetDraftSummary,
  useGetNews,
  useGetOLImpact,
  useGetPlayer,
  useGetPlayers,
  useGetTeams,
  useHealthCheck,
  useRefreshData,
} from "@workspace/api-client-react";
import type { DraftPick, DraftSummary, NewsItem, OLImpactAnalysis, RBOLImpact, OLTeamScore, Player, Team } from "@workspace/api-client-react";
import { useDraftBoard, usePlayerNote } from "@/hooks/use-draft-state";
import { NO_DATA, barWidth, finish, hasValue, int, num, pct, valueScore as fmtValueScore, valueScoreBar, valueTone } from "@/lib/format";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

const formatTime = (value?: string) => {
  if (!value) return "awaiting refresh";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};

const initials = (name: string) => name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

function Surface({ children, className = "", ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-[18px] border border-border bg-card text-card-foreground shadow-sm ${className}`} {...props}>{children}</section>;
}

function Kicker({ children }: { children: ReactNode }) {
  return <div className="mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{children}</div>;
}

function PositionBadge({ position }: { position: string }) {
  const color = position === "RB" ? "bg-accent/15 text-accent-foreground border-accent/30" : position === "WR" ? "bg-primary/12 text-primary border-primary/25" : position === "QB" ? "bg-chart-3/15 text-chart-3 border-chart-3/25" : "bg-chart-5/15 text-chart-5 border-chart-5/25";
  return <span className={`inline-flex h-6 min-w-8 items-center justify-center rounded-md border px-1.5 mono text-[10px] font-medium ${color}`}>{position}</span>;
}

function ScoreBar({ value, color = "primary" }: { value: number; color?: "primary" | "accent" | "chart-3" }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full bg-${color}`} style={{ width: `${clamp(value)}%` }} /></div>;
}

function LoadingRows() {
  return <div className="space-y-2 p-3" data-testid="status-loading-players">{[1, 2, 3, 4, 5, 6].map((row) => <div key={row} className="h-[58px] animate-pulse rounded-xl bg-muted/65" />)}</div>;
}

function ErrorState({ label, onRetry }: { label: string; onRetry?: () => void }) {
  return <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 p-6 text-center" data-testid="status-error">
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"><ShieldAlert size={18} /></div>
    <div><p className="text-sm font-semibold">Signal interrupted</p><p className="mt-1 max-w-xs text-xs text-muted-foreground">{label}</p></div>
    {onRetry && <button type="button" onClick={onRetry} data-testid="button-retry" className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">Try again</button>}
  </div>;
}

function EmptyState({ label }: { label: string }) {
  return <div className="flex min-h-[180px] flex-col items-center justify-center p-8 text-center" data-testid="status-empty">
    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles size={19} /></div>
    <p className="text-sm font-semibold">No edges in this slice</p>
    <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{label}</p>
  </div>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [dark, setDark] = useState(() => localStorage.getItem("draft-command-center:theme") === "dark");
  const [mobileOpen, setMobileOpen] = useState(false);
  const refresh = useRefreshData();
  const client = useQueryClient();
  const health = useHealthCheck();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("draft-command-center:theme", dark ? "dark" : "light");
  }, [dark]);

  const doRefresh = () => {
    refresh.mutate(undefined, {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: getGetPlayersQueryKey() });
        void client.invalidateQueries({ queryKey: getGetTeamsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetNewsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetDraftSummaryQueryKey() });
        void client.invalidateQueries({ queryKey: getGetOLImpactQueryKey() });
      },
    });
  };

  const links = [
    { href: "/", label: "Draft room", icon: Command, detail: "Rankings + board" },
    { href: "/teams", label: "Team context", icon: LayoutGrid, detail: "Line play matrix" },
    { href: "/ol-impact", label: "OL Impact", icon: Activity, detail: "RB vs line analysis" },
    { href: "/news", label: "Signal feed", icon: Newspaper, detail: "Injury + market" },
  ];

  return <div className="min-h-[100dvh] bg-background text-foreground">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-[76px] items-center justify-between border-b border-sidebar-border px-5">
        <Link href="/" onClick={() => setMobileOpen(false)} data-testid="link-brand" className="flex items-center gap-3">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><Command size={18} /><span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-sidebar" /></span>
          <span><span className="display block text-[15px] font-bold tracking-tight">The Draft Room</span><span className="mono block text-[9px] uppercase tracking-[0.14em] text-sidebar-foreground/50">2026 / analyst terminal</span></span>
        </Link>
        <button type="button" onClick={() => setMobileOpen(false)} data-testid="button-close-menu" className="rounded-lg p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent lg:hidden"><X size={17} /></button>
      </div>
      <div className="px-4 pt-7"><Kicker>Workspace</Kicker><nav className="mt-3 space-y-1.5">
        {links.map(({ href, label, icon: Icon, detail }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return <Link href={href} key={href} onClick={() => setMobileOpen(false)} data-testid={`link-nav-${label.toLowerCase().replaceAll(" ", "-")}`} className={`group flex items-center gap-3 rounded-xl px-3 py-3 transition-colors ${active ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"}`}>
            <Icon size={17} strokeWidth={active ? 2.2 : 1.7} /><span className="min-w-0"><span className="block text-[13px] font-semibold">{label}</span><span className="block text-[10px] text-sidebar-foreground/40">{detail}</span></span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}
          </Link>;
        })}
      </nav></div>
      <div className="mt-auto p-4">
        <div className="rounded-2xl border border-sidebar-border bg-sidebar-accent/55 p-3.5">
          <div className="flex items-center justify-between"><Kicker>System pulse</Kicker><span className={`h-2 w-2 rounded-full ${health.isError ? "bg-destructive" : "bg-sidebar-primary pulse-dot"}`} /></div>
          <div className="mt-3 flex items-end justify-between"><span className="mono text-xl font-medium">{health.isLoading ? "--" : health.isError ? "ERR" : "OK"}</span><span className="text-[10px] text-sidebar-foreground/45">API / live</span></div>
          <div className="mt-3 h-px bg-sidebar-border" /><p className="mt-2 text-[10px] leading-4 text-sidebar-foreground/45">Feeds are cached and normalized for draft speed.</p>
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] text-sidebar-foreground/45"><span>Draft kit v0.8.6</span><CircleHelp size={13} /></div>
      </div>
    </aside>
    {mobileOpen && <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-foreground/35 lg:hidden" data-testid="button-overlay-menu" />}
    <div className="lg:pl-[252px]">
      <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-xl sm:px-6 lg:px-9">
        <div className="flex items-center gap-3"><button type="button" onClick={() => setMobileOpen(true)} data-testid="button-open-menu" className="rounded-lg border border-border p-2 lg:hidden"><Menu size={17} /></button><div><Kicker>League room / 01</Kicker><p className="mt-1 hidden text-[11px] text-muted-foreground sm:block">Your board is private. The market is not.</p></div></div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden items-center gap-2 mono text-[10px] text-muted-foreground md:flex"><span className={`h-1.5 w-1.5 rounded-full ${health.isError ? "bg-destructive" : "bg-primary pulse-dot"}`} />{health.isError ? "feed degraded" : "feeds live"}<span className="text-border">/</span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          <button type="button" onClick={doRefresh} disabled={refresh.isPending} data-testid="button-refresh-data" className="group flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold shadow-sm transition hover:border-primary/40 hover:text-primary disabled:opacity-60"><RefreshCw size={14} className={refresh.isPending ? "animate-spin" : "transition-transform group-hover:rotate-45"} /> <span className="hidden sm:inline">{refresh.isPending ? "Refreshing" : "Refresh"}</span></button>
          <button type="button" onClick={() => setDark((value) => !value)} data-testid="button-toggle-theme" aria-label="Toggle theme" className="rounded-xl border border-border bg-card p-2 text-muted-foreground shadow-sm hover:text-foreground">{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
          <div className="hidden h-8 w-8 items-center justify-center rounded-xl bg-foreground text-[10px] font-bold text-background sm:flex">DC</div>
        </div>
      </header>
      <main className="terminal-grid min-h-[calc(100dvh-76px)] px-4 py-6 sm:px-6 lg:px-9 lg:py-8">{children}</main>
    </div>
  </div>;
}

function SectionHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="mb-5 flex items-end justify-between gap-4"><div><Kicker>{eyebrow}</Kicker><h1 className="display mt-1.5 text-[27px] font-bold tracking-[-0.04em] sm:text-[32px]">{title}</h1>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>{action}</div>;
}

function Metric({ label, value, detail, accent = false }: { label: string; value: string | number; detail: string; accent?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${accent ? "border-primary/30 bg-primary/[0.06]" : "border-border bg-card"}`}><Kicker>{label}</Kicker><div className="mt-2 flex items-end justify-between gap-2"><span className="mono text-[23px] font-medium tracking-tight">{value}</span><span className={`text-right text-[10px] ${accent ? "text-primary" : "text-muted-foreground"}`}>{detail}</span></div></div>;
}

function PlayerRow({ player, drafted, onDraft, onInspect }: { player: Player; drafted: boolean; onDraft: (player: Player) => void; onInspect: (player: Player) => void }) {
  const delta = player.adp - player.rank;
  // No availability data exists in this dataset yet, so an absent status is
  // shown as unknown rather than coloured as though it were bad news.
  const injuryTone = !player.injuryStatus ? "text-muted-foreground" : player.injuryStatus.toLowerCase().includes("active") ? "text-primary" : player.injuryStatus.toLowerCase().includes("question") ? "text-accent-foreground" : "text-destructive";
  return <div className={`data-row group grid grid-cols-[30px_minmax(170px,1.5fr)_58px_76px_72px_68px_82px] items-center gap-3 border-b border-border/70 px-4 py-3 last:border-b-0 ${drafted ? "opacity-45" : ""}`} data-testid={`row-player-${player.id}`}>
    <span className="mono text-[11px] text-muted-foreground">{String(player.rank).padStart(2, "0")}</span>
    <button type="button" onClick={() => onInspect(player)} data-testid={`button-inspect-player-${player.id}`} className="flex min-w-0 items-center gap-2 text-left">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-[10px] font-bold">{initials(player.name)}</span>
      <span className="min-w-0"><span className="block truncate text-[12px] font-bold group-hover:text-primary">{player.name}</span><span className="mono block text-[10px] text-muted-foreground">{player.team} / {player.byeWeek === 0 ? "BYE —" : `BYE ${player.byeWeek}`}</span></span>
    </button>
    <span><PositionBadge position={player.position} /></span>
    <span className="mono text-right text-[11px]">{player.adp.toFixed(1)}</span>
    <span className={`mono text-right text-[11px] font-medium ${delta > 0 ? "text-primary" : "text-destructive"}`}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}</span>
    <span className="text-right"><span className={`mono text-[12px] font-medium ${valueTone(player.valueScore)}`}>{fmtValueScore(player.valueScore)}</span><ScoreBar value={valueScoreBar(player.valueScore)} color="accent" /></span>
    <span className="text-right"><button type="button" onClick={() => onDraft(player)} disabled={drafted} data-testid={`button-draft-player-${player.id}`} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition ${drafted ? "cursor-default bg-muted text-muted-foreground" : "bg-primary text-primary-foreground hover:-translate-y-0.5 hover:shadow-md"}`}>{drafted ? <Check size={12} /> : <Target size={12} />}{drafted ? "Drafted" : "Draft"}</button></span>
    <span className={`col-span-full -mt-1 pl-[42px] text-[10px] ${injuryTone} sm:hidden`}>{player.injuryStatus}</span>
  </div>;
}

function NewsRail({ news, players }: { news: NewsItem[]; players: Player[] }) {
  const playerById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  return <Surface className="scanline overflow-hidden"><div className="flex items-center justify-between border-b border-border px-4 py-4"><div><Kicker>Live pulse</Kicker><h2 className="mt-1 text-sm font-bold">Injury & market radar</h2></div><Bell size={15} className="text-primary" /></div>
    {news.length === 0 ? <EmptyState label="No live feed connected. Injury and beat reporting arrive when a live source is wired up — the player dataset carries none." /> : <div className="divide-y divide-border/70">{news.slice(0, 5).map((item) => {
      const player = item.playerId ? playerById.get(item.playerId) : undefined;
      return <div className="group px-4 py-3.5 transition-colors hover:bg-primary/[0.04]" key={item.id} data-testid={`news-item-${item.id}`}><div className="flex items-center justify-between gap-3"><span className="mono text-[9px] uppercase tracking-[0.13em] text-primary">{item.source}</span><span className="mono text-[9px] text-muted-foreground">{formatTime(item.timestamp)}</span></div><p className="mt-1.5 text-[11px] font-semibold leading-4">{item.headline}</p><div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">{player && <span className="rounded bg-secondary px-1.5 py-0.5 font-semibold text-foreground">{player.name}</span>}<span className={item.sentiment.toLowerCase().includes("positive") ? "text-primary" : item.sentiment.toLowerCase().includes("negative") ? "text-destructive" : "text-muted-foreground"}>{item.status}</span><span className="ml-auto">{item.author}</span></div></div>;
    })}</div>}
    <Link href="/news" data-testid="link-view-all-news" className="flex items-center justify-between border-t border-border px-4 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-primary hover:bg-primary/[0.04]">Open signal feed <ChevronRight size={14} /></Link>
  </Surface>;
}

function MarketArbitrage({ players, draftedIds, onInspect }: { players: Player[]; draftedIds: string[]; onInspect: (player: Player) => void }) {
  const targets = [...players].filter((player) => !draftedIds.includes(player.id)).sort((a, b) => (b.adp - b.rank) - (a.adp - a.rank)).slice(0, 4);
  return <Surface><div className="border-b border-border px-4 py-4"><div className="flex items-center justify-between"><div><Kicker>Market dislocation</Kicker><h2 className="mt-1 text-sm font-bold">Arbitrage board</h2></div><TrendingUp size={16} className="text-primary" /></div><p className="mt-1 text-[10px] text-muted-foreground">ADP lagging the room model.</p></div><div className="p-2">{targets.length === 0 ? <EmptyState label="Draft a few names to reveal the next price errors." /> : targets.map((player) => <button type="button" key={player.id} onClick={() => onInspect(player)} data-testid={`button-arbitrage-${player.id}`} className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left hover:bg-muted"><span className="mono w-7 text-[10px] text-muted-foreground">#{player.rank}</span><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-[9px] font-bold text-primary">{initials(player.name)}</span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-bold group-hover:text-primary">{player.name}</span><span className="mono text-[9px] text-muted-foreground">{player.position} / ADP {player.adp.toFixed(1)}</span></span><span className="mono text-[11px] font-medium text-primary">+{(player.adp - player.rank).toFixed(1)}</span></button>)}</div></Surface>;
}

function DraftBoard({ draftedPlayers, summary, onUndraft, pendingId }: { draftedPlayers: { pick: DraftPick; player?: Player }[]; summary?: DraftSummary; onUndraft: (playerId: string) => void; pendingId: string | null }) {
  const drafted = draftedPlayers.slice(0, 6);
  const draftedIds = draftedPlayers.map((entry) => entry.pick.playerId);
  return <Surface><div className="flex items-center justify-between border-b border-border px-4 py-4"><div><Kicker>Room state</Kicker><h2 className="mt-1 text-sm font-bold">Your draft board</h2></div><span className="mono rounded-md bg-accent/15 px-2 py-1 text-[10px] text-accent-foreground">{draftedIds.length.toString().padStart(2, "0")} on board</span></div><div className="p-3">{drafted.length === 0 ? <div className="rounded-xl border border-dashed border-border p-5 text-center"><div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-secondary"><PanelRight size={15} className="text-muted-foreground" /></div><p className="mt-3 text-[11px] font-semibold">Your board is clear</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Draft a player to start measuring roster shape.</p></div> : <div className="space-y-2">{drafted.map(({ pick, player }, index) => <div key={pick.playerId} className="group flex items-center gap-2 rounded-xl bg-muted/60 px-2.5 py-2"><span className="mono w-4 text-[9px] text-muted-foreground">{index + 1}</span><PositionBadge position={pick.position || player?.position || "?"} /><span className="truncate text-[11px] font-semibold">{pick.playerName || player?.name || pick.playerId}</span><span className="mono ml-auto text-[10px] text-muted-foreground">{player ? fmtValueScore(player.valueScore) : NO_DATA}</span><button type="button" onClick={() => onUndraft(pick.playerId)} disabled={pendingId === pick.playerId} data-testid={`button-undraft-${pick.playerId}`} title={`Undo ${pick.playerName || pick.playerId}`} aria-label={`Undo pick: ${pick.playerName || pick.playerId}`} className="ml-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-50 transition hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30">{pendingId === pick.playerId ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}</button></div>)}</div>}<div className="mt-3 grid grid-cols-4 gap-1.5">{(["QB", "RB", "WR", "TE"] as const).map((position) => <div key={position} className="rounded-lg bg-secondary/70 px-1.5 py-2 text-center"><span className="mono block text-[9px] text-muted-foreground">{position}</span><span className="mono mt-1 block text-[12px] font-medium">{summary?.positionalNeeds[position] ?? "—"}</span></div>)}</div></div></Surface>;
}

function HomePage() {
  const { data: playersData, isLoading, isError, refetch } = useGetPlayers();
  const { data: summary } = useGetDraftSummary();
  const { data: newsData } = useGetNews();
  const [, setLocation] = useLocation();
  const players = playersData ?? [];
  const board = useDraftBoard(players);
  const { draftedIds, draftPlayer, pendingId } = board;
  const [position, setPosition] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"rank" | "value" | "adp">("rank");
  const [showHealthyOnly, setShowHealthyOnly] = useState(false);
  const news = newsData ?? [];
  const filteredPlayers = useMemo(() => players.filter((player) => (position === "ALL" || player.position === position) && player.name.toLowerCase().includes(search.toLowerCase()) && (!showHealthyOnly || !player.injuryStatus || player.injuryStatus.toLowerCase().includes("active"))).sort((a, b) => sort === "value" ? (b.valueScore ?? -Infinity) - (a.valueScore ?? -Infinity) : sort === "adp" ? a.adp - b.adp : a.rank - b.rank), [players, position, search, showHealthyOnly, sort]);
  return <div className="mx-auto max-w-[1500px]">
    <div className="enter"><SectionHeading eyebrow="Live draft room" title="Make the next pick count." detail="Top 250 board · ranked by your composite value model" action={<div className="hidden items-center gap-2 sm:flex"><span className="mono text-[10px] text-muted-foreground">last sync</span><span className="mono rounded-lg bg-card px-2.5 py-2 text-[10px] font-medium shadow-sm">{formatTime(summary?.lastRefresh)}</span></div>} /></div>
    <div className="enter enter-1 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:gap-3"><Metric label="Players tracked" value={(summary?.playersTracked ?? players.length) || "—"} detail="of 250" /><Metric label="Drafted" value={draftedIds.length} detail={`${draftedIds.length ? "saved to disk" : "start picking"}`} accent /><Metric label="Room avg ADP" value={summary?.averageAdp?.toFixed(1) ?? "—"} detail="current room" /><Metric label="Value targets" value={summary?.valueTargets ?? "—"} detail="above market" /></div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_350px]">
      <div className="min-w-0">
        <Surface className="enter enter-2 overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-3"><div className="relative min-w-0 flex-1 sm:w-[230px] sm:flex-none"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search player or team" data-testid="input-search-players" className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-xs outline-none ring-primary/20 placeholder:text-muted-foreground focus:ring-4" /></div><div className="hidden items-center gap-1.5 text-[10px] text-muted-foreground md:flex"><ListFilter size={13} /> {filteredPlayers.length} shown</div></div>
            <div className="flex items-center gap-2 overflow-x-auto"><div className="flex rounded-xl border border-border bg-muted/55 p-0.5">{["ALL", "QB", "RB", "WR", "TE"].map((item) => <button type="button" key={item} onClick={() => setPosition(item)} data-testid={`button-filter-${item.toLowerCase()}`} className={`rounded-lg px-2.5 py-1.5 mono text-[10px] transition ${position === item ? "bg-card font-medium text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{item}</button>)}</div><button type="button" onClick={() => setShowHealthyOnly((value) => !value)} data-testid="button-filter-healthy" className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[10px] font-semibold ${showHealthyOnly ? "border-primary/35 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}><ShieldAlert size={12} /> Healthy</button></div>
          </div>
          <div className="grid grid-cols-[30px_minmax(170px,1.5fr)_58px_76px_72px_68px_82px] gap-3 border-b border-border bg-muted/45 px-4 py-2.5 text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground"><span>#</span><span>Player</span><span>Pos</span><button type="button" onClick={() => setSort("adp")} className="text-right hover:text-primary" data-testid="button-sort-adp">ADP</button><button type="button" onClick={() => setSort("rank")} className="text-right hover:text-primary" data-testid="button-sort-rank">Market Δ</button><button type="button" onClick={() => setSort("value")} className="text-right hover:text-primary" data-testid="button-sort-value">Value</button><span className="text-right">Action</span></div>
          {isLoading ? <LoadingRows /> : isError ? <ErrorState label="The player feed did not answer. Your local board is safe." onRetry={() => void refetch()} /> : filteredPlayers.length === 0 ? <EmptyState label="Try another position, search term, or remove the health filter." /> : <div className="max-h-[610px] overflow-y-auto scrollbar-thin">{filteredPlayers.map((player) => <PlayerRow key={player.id} player={player} drafted={draftedIds.includes(player.id)} onDraft={draftPlayer} onInspect={(selected) => setLocation(`/players/${selected.id}`)} />)}</div>}
          <div className="flex items-center justify-between border-t border-border px-4 py-3"><span className="mono text-[9px] text-muted-foreground">Showing {filteredPlayers.length} / {summary?.playersTracked ?? players.length} · model v26.04</span><span className="flex items-center gap-1 text-[10px] text-muted-foreground"><SlidersHorizontal size={12} /> sort by column</span></div>
        </Surface>
      </div>
      <div className="space-y-6"><div className="enter enter-3"><MarketArbitrage players={players} draftedIds={draftedIds} onInspect={(player) => setLocation(`/players/${player.id}`)} /></div><div className="enter enter-3"><DraftBoard draftedPlayers={board.draftedPlayers} summary={summary} onUndraft={board.undraftPlayer} pendingId={pendingId} /></div><div className="enter enter-3"><NewsRail news={news} players={players} /></div></div>
    </div>
    {board.isUnavailable && <div className="fixed bottom-5 right-5 z-30 rounded-xl border border-destructive/30 bg-card px-4 py-3 text-xs shadow-lg" data-testid="status-board-unavailable">Could not read your saved board. It is still on disk — reconnect before drafting.</div>}
    {board.saveFailed && !board.isUnavailable && <div className="fixed bottom-5 right-5 z-30 rounded-xl border border-destructive/30 bg-card px-4 py-3 text-xs shadow-lg" data-testid="status-draft-error">That change was not written to disk. Retry before relying on the board.</div>}
    {pendingId && <div className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-xs font-semibold text-background shadow-xl" data-testid="status-drafting"><Loader2 size={13} className="animate-spin" /> saving pick</div>}
  </div>;
}

function MetricBar({ label, value, display, fill }: { label: string; value: number | null | undefined; display: string; fill: number }) {
  return <div><div className="mb-1.5 flex items-center justify-between text-[10px]"><span className="text-muted-foreground">{label}</span><span className={`mono font-medium ${hasValue(value) ? "" : "text-muted-foreground"}`}>{display}</span></div><div className="relative h-1.5 rounded-full bg-muted">{hasValue(value) && <div className="absolute left-0 top-0 h-full rounded-full bg-primary" style={{ width: `${fill}%` }} />}</div></div>;
}

/**
 * Next Gen Stats radar.
 *
 * These metrics are only recorded for the positions they describe — separation
 * and catch rate for receivers, rushing yards over expected and eight-plus-box
 * rate for backs — so most players legitimately have only half of them, and
 * quarterbacks have none. Missing axes are drawn at the centre and labelled
 * with an em-dash rather than plotted as zero, which would read as "bad".
 */
function Radar({ player }: { player: Player }) {
  // Each metric has its own units, so each gets its own realistic range.
  const metrics = [
    { key: "SEP", value: player.nextGen.separation, display: num(player.nextGen.separation, 2), min: 1.5, max: 5 },
    { key: "CATCH", value: player.nextGen.catchPct, display: pct(player.nextGen.catchPct, 0), min: 45, max: 85 },
    { key: "RYOE", value: player.nextGen.ryoe, display: num(player.nextGen.ryoe, 0), min: -60, max: 180 },
    { key: "BOX", value: player.nextGen.boxCount, display: pct(player.nextGen.boxCount, 0), min: 0, max: 40 },
  ];
  const recorded = metrics.filter((metric) => hasValue(metric.value));
  const points = metrics.map((metric, index) => {
    const angle = (-Math.PI / 2) + (index * Math.PI * 2) / metrics.length;
    const radius = 68 * barWidth(metric.value, metric.min, metric.max) / 100;
    return `${90 + Math.cos(angle) * radius},${90 + Math.sin(angle) * radius}`;
  }).join(" ");

  if (recorded.length === 0) {
    // Absent for two different reasons, and saying the wrong one is worse than
    // saying nothing: a quarterback is never tracked, while a back or receiver
    // with no recorded snaps simply has no sample yet.
    const reason = player.position === "QB"
      ? "These are tracked for receivers and running backs, not for quarterbacks."
      : player.note ?? "No tracked snaps recorded for this player in 2025.";
    return <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center"><CircleHelp size={20} className="text-muted-foreground" /><p className="text-[11px] font-semibold">No next-gen metrics</p><p className="max-w-[210px] text-[10px] leading-4 text-muted-foreground">{reason}</p></div>;
  }

  return <div><div className="relative mx-auto h-[220px] w-[220px]"><svg viewBox="0 0 180 180" className="h-full w-full overflow-visible"><polygon points="90,22 158,90 90,158 22,90" fill="none" stroke="hsl(var(--border))" /><polygon points="56,56 124,56 124,124 56,124" fill="none" stroke="hsl(var(--border))" strokeDasharray="2 4" /><line x1="90" y1="22" x2="90" y2="158" stroke="hsl(var(--border))" /><line x1="22" y1="90" x2="158" y2="90" stroke="hsl(var(--border))" /><polygon points={points} fill="hsl(var(--primary) / .18)" stroke="hsl(var(--primary))" strokeWidth="2" /></svg></div><div className="mt-2 grid grid-cols-4 gap-1 text-center">{metrics.map((metric) => <div key={metric.key}><span className="mono block text-[9px] text-muted-foreground">{metric.key}</span><span className={`mono block text-[11px] ${hasValue(metric.value) ? "font-medium" : "text-muted-foreground"}`}>{metric.display}</span></div>)}</div></div>;
}

/**
 * Weekly consistency, as a floor/median/ceiling distribution.
 *
 * The dataset records the shape of a player's weekly scoring — 25th percentile,
 * median, 85th percentile, boom and bust rates — but not the individual weekly
 * scores, so there is no per-week line to draw. The previous chart plotted a
 * hardcoded twelve-week series whenever it had nothing, which showed every
 * player an identical invented season.
 */
function ConsistencyProfile({ player }: { player: Player }) {
  const { floor, median, ceiling, boomRate, bustRate, weeksPlayed } = player.consistency;

  if (!hasValue(floor) && !hasValue(median) && !hasValue(ceiling)) {
    return <div className="flex h-[130px] flex-col items-center justify-center gap-2 text-center"><CircleHelp size={20} className="text-muted-foreground" /><p className="text-[11px] font-semibold">No 2025 weekly scoring</p><p className="max-w-[230px] text-[10px] leading-4 text-muted-foreground">{player.note ?? "This player recorded no 2025 regular-season snaps."}</p></div>;
  }

  const max = Math.max(ceiling ?? 0, median ?? 0, floor ?? 0, 1);
  const pos = (value: number | null | undefined) => hasValue(value) ? (value / max) * 100 : 0;

  return <div className="mt-4">
    <div className="relative h-9 rounded-lg bg-muted">
      {hasValue(floor) && hasValue(ceiling) && <div className="absolute top-0 h-full rounded-lg bg-primary/20" style={{ left: `${pos(floor)}%`, width: `${Math.max(0, pos(ceiling) - pos(floor))}%` }} />}
      {hasValue(median) && <div className="absolute top-0 h-full w-[2px] bg-primary" style={{ left: `${pos(median)}%` }} />}
    </div>
    <div className="mt-1.5 flex justify-between mono text-[9px] text-muted-foreground"><span>0</span><span>{num(max, 0)} pts</span></div>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
      <div><Kicker>Floor</Kicker><span className="mono mt-1 block text-sm">{num(floor)}</span></div>
      <div><Kicker>Median</Kicker><span className="mono mt-1 block text-sm">{num(median)}</span></div>
      <div><Kicker>Ceiling</Kicker><span className="mono mt-1 block text-sm">{num(ceiling)}</span></div>
    </div>
    <p className="mt-3 text-[10px] leading-4 text-muted-foreground">Across {int(weeksPlayed)} weeks played: boomed in {pct(boomRate, 0)} of them, busted in {pct(bustRate, 0)}.</p>
  </div>;
}

/**
 * 2025 production, as recorded.
 *
 * This panel used to show a "2026 model" column that was the 2025 value
 * multiplied by 1.03-1.05 — a fabricated projection presented as a forecast.
 * The dataset contains no 2026 projections, so this shows what was actually
 * measured and prices it against ADP, which is real market data.
 */
function ProductionProfile({ player }: { player: Player }) {
  return <div className="space-y-4">
    <MetricBar label="2025 positional finish" value={player.productionFinish} display={finish(player.productionFinish)} fill={100 - barWidth(player.productionFinish, 1, 60)} />
    <MetricBar label="Points per game (PPR)" value={player.ppg} display={num(player.ppg)} fill={barWidth(player.ppg, 0, 25)} />
    <MetricBar label={player.position === "RB" ? "Carry share" : "Target share"} value={player.share} display={pct(player.share)} fill={barWidth(player.share, 0, 35)} />
    <MetricBar label="O-line grade" value={player.oLineGrade} display={num(player.oLineGrade)} fill={barWidth(player.oLineGrade, 0, 100)} />
    <MetricBar label="Snap share" value={player.snapShare} display={pct(player.snapShare, 0)} fill={barWidth(player.snapShare, 0, 100)} />
  </div>;
}

function PlayerDetail({ player, close, olImpact }: { player: Player; close: () => void; olImpact?: RBOLImpact }) {
  const { note, updateNote, status: noteStatus } = usePlayerNote(player);
  const injuryGood = player.injuryStatus?.toLowerCase().includes("active") ?? false;
  return <div className="mx-auto max-w-[1250px]">
    <button type="button" onClick={close} data-testid="button-close-player" className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary"><ChevronLeft size={15} /> Back to board</button>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Surface className="overflow-hidden"><div className="relative overflow-hidden border-b border-border bg-secondary/55 p-6 sm:p-8"><div className="absolute -right-10 -top-20 h-64 w-64 rounded-full border-[34px] border-primary/10" /><div className="relative flex flex-wrap items-start justify-between gap-6"><div className="flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-foreground text-lg font-bold text-background">{initials(player.name)}</div><div><div className="flex items-center gap-2"><PositionBadge position={player.position} /><span className="mono text-[10px] text-muted-foreground">{player.team}</span><span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${!player.injuryStatus ? "text-muted-foreground" : injuryGood ? "text-primary" : "text-destructive"}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{player.injuryStatus ?? "status unknown"}</span></div><h1 className="display mt-2 text-3xl font-bold tracking-[-0.05em] sm:text-4xl">{player.name}</h1><p className="mt-1 text-xs text-muted-foreground">Tier {player.tier} · {player.byeWeek ? `Bye week ${player.byeWeek}` : "Bye pending"} · durability {int(player.durabilityScore)}{player.isRookie ? " · rookie" : ""}</p></div></div><div className="text-left sm:text-right"><Kicker>Composite rank</Kicker><div className="mono mt-1 text-4xl font-medium text-primary">#{player.rank}</div><p className="mono text-[10px] text-muted-foreground">ADP {player.adp.toFixed(1)}</p></div></div></div><div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-4"><div className="p-4"><Kicker>Value score</Kicker><strong className={`mono mt-1 block text-lg ${valueTone(player.valueScore)}`}>{fmtValueScore(player.valueScore)}</strong><span className="mono text-[9px] text-muted-foreground">SD vs price</span></div><div className="p-4"><Kicker>PPG</Kicker><strong className="mono mt-1 block text-lg">{num(player.ppg)}</strong></div><div className="p-4"><Kicker>{player.position === "RB" ? "Carry share" : "Target share"}</Kicker><strong className="mono mt-1 block text-lg">{pct(player.share)}</strong></div><div className="p-4"><Kicker>O-line</Kicker><strong className="mono mt-1 block text-lg">{num(player.oLineGrade)}</strong></div></div></Surface>
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]"><Surface className="p-5"><div className="flex items-start justify-between"><div><Kicker>Production profile</Kicker><h2 className="mt-1 text-sm font-bold">2025 actuals</h2></div><LineChart size={16} className="text-primary" /></div><div className="mt-6"><ProductionProfile player={player} /></div><p className="mt-5 text-[9px] leading-4 text-muted-foreground">Measured 2025 production. The dataset carries no 2026 projections, so nothing here is forecast.</p></Surface><Surface className="p-5"><div className="flex items-start justify-between"><div><Kicker>Next-gen profile</Kicker><h2 className="mt-1 text-sm font-bold">Trait radar</h2></div><BarChart3 size={16} className="text-accent-foreground" /></div><Radar player={player} /><p className="mx-auto max-w-[230px] text-center text-[10px] leading-4 text-muted-foreground">Separation, route efficiency, rushing value, and box-count context normalized to position.</p></Surface></div>
        <Surface className="p-5"><div className="flex items-start justify-between"><div><Kicker>Volatility log</Kicker><h2 className="mt-1 text-sm font-bold">Weekly consistency</h2></div><div className="flex gap-3 mono text-[10px]"><span className="text-primary">FLOOR {num(player.consistency.floor)}</span><span className="text-accent-foreground">CEILING {num(player.consistency.ceiling)}</span></div></div><ConsistencyProfile player={player} /><div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-4 sm:grid-cols-4"><div><Kicker>Boom rate</Kicker><span className="mono mt-1 block text-sm">{pct(player.consistency.boomRate)}</span></div><div><Kicker>Bust rate</Kicker><span className="mono mt-1 block text-sm">{pct(player.consistency.bustRate)}</span></div><div><Kicker>Durability</Kicker><span className="mono mt-1 block text-sm">{int(player.durabilityScore)}</span></div><div><Kicker>Games</Kicker><span className="mono mt-1 block text-sm">{int(player.gamesPlayed)}</span></div></div></Surface>
      </div>
      <div className="space-y-6"><Surface className="border-primary/25 bg-primary/[0.045] p-5"><div className="flex items-center gap-2 text-primary"><Zap size={15} /><Kicker>Analyst read</Kicker></div><p className="display mt-4 text-xl font-semibold leading-tight">The room is pricing the name at {player.adp.toFixed(1)}. Your model wants him at {player.rank}.</p><div className="mt-5 flex items-center justify-between border-t border-primary/15 pt-4"><span className="text-[10px] text-muted-foreground">market edge</span><span className={`mono text-lg font-medium ${player.adp - player.rank > 0 ? "text-primary" : "text-destructive"}`}>{player.adp - player.rank > 0 ? "+" : ""}{(player.adp - player.rank).toFixed(1)} picks</span></div></Surface><Surface className="p-5"><div className="flex items-center justify-between"><div><Kicker>Private notes</Kicker><h2 className="mt-1 text-sm font-bold">Keep your read</h2></div><BookOpen size={15} className="text-muted-foreground" /></div><textarea value={note} onChange={(event) => updateNote(event.target.value)} placeholder="What are you seeing that the market is not?" data-testid={`textarea-notes-${player.id}`} className="mt-4 min-h-[150px] w-full resize-none rounded-xl border border-input bg-background p-3 text-xs leading-5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" /><div className="mt-2 flex items-center justify-between"><span className="mono text-[9px] text-muted-foreground">{note.length}/500</span><span className={`flex items-center gap-1 text-[9px] ${noteStatus === "error" ? "text-destructive" : "text-primary"}`} data-testid="status-note-save">{noteStatus === "saving" ? <><Loader2 size={11} className="animate-spin" /> saving…</> : noteStatus === "error" ? <><ShieldAlert size={11} /> not saved</> : <><Check size={11} /> saved to disk</>}</span></div></Surface><Surface className="p-5"><Kicker>Draft context</Kicker><div className="mt-4 space-y-3 text-[11px]"><div className="flex justify-between"><span className="text-muted-foreground">Team offense</span><span className="mono">{player.team}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Production finish</span><span className="mono">{finish(player.productionFinish)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">O-line grade</span><span className="mono">{num(player.oLineGrade)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Market verdict</span><span className="mono">{player.marketVerdict ?? NO_DATA}</span></div></div><Link href="/teams" data-testid="link-team-context" className="mt-5 flex items-center justify-between rounded-xl border border-border px-3 py-2.5 text-[10px] font-semibold hover:border-primary/40 hover:text-primary">Inspect team context <ExternalLink size={13} /></Link></Surface>
        {olImpact && <Surface className="p-5"><div className="flex items-center gap-2"><Activity size={15} className="text-accent-foreground" /><Kicker>OL Impact analysis</Kicker></div><div className="mt-3 flex items-center gap-2"><span className={`inline-flex items-center rounded-md border px-2 py-0.5 mono text-[10px] font-medium ${olImpact.impactLabel === "Favorable" ? "border-primary/30 bg-primary/10 text-primary" : olImpact.impactLabel === "Buy Low" ? "border-accent/30 bg-accent/10 text-accent-foreground" : olImpact.impactLabel === "Landmine" ? "border-chart-3/30 bg-chart-3/10 text-chart-3" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>{olImpact.impactLabel}</span><span className="mono text-[10px] text-muted-foreground">OL {int(olImpact.olCompositeScore)}/100 · {olImpact.olTier}</span></div><p className="mt-3 text-[11px] leading-5 text-muted-foreground">{olImpact.blurb}</p><Link href="/ol-impact" data-testid="link-ol-impact" className="mt-4 flex items-center justify-between rounded-xl border border-border px-3 py-2.5 text-[10px] font-semibold hover:border-primary/40 hover:text-primary">Full OL Impact board <ExternalLink size={13} /></Link></Surface>}
      </div>
    </div>
  </div>;
}

function PlayerPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { data: player, isLoading, isError, refetch } = useGetPlayer(params.id, { query: { enabled: Boolean(params.id), queryKey: getGetPlayerQueryKey(params.id) } });
  const { data: olData } = useGetOLImpact({ query: { queryKey: getGetOLImpactQueryKey() } });
  const olImpact = player?.position === "RB" ? olData?.rbImpacts.find((r) => r.playerId === player.id) : undefined;
  if (isLoading) return <div className="mx-auto max-w-[1250px]"><div className="h-8 w-48 animate-pulse rounded bg-muted" /><div className="mt-6 h-[600px] animate-pulse rounded-[18px] bg-card" /></div>;
  if (isError || !player) return <div className="mx-auto max-w-[650px] pt-12"><Surface><ErrorState label="This player profile could not be retrieved." onRetry={() => void refetch()} /></Surface></div>;
  return <PlayerDetail player={player} close={() => setLocation("/")} olImpact={olImpact} />;
}

const IMPACT_COLORS: Record<string, { dot: string; badge: string; label: string }> = {
  "Favorable": { dot: "bg-primary", badge: "border-primary/30 bg-primary/10 text-primary", label: "Favorable" },
  "Buy Low":   { dot: "bg-accent-foreground", badge: "border-accent/30 bg-accent/10 text-accent-foreground", label: "Buy Low" },
  "Landmine":  { dot: "bg-chart-3", badge: "border-chart-3/30 bg-chart-3/10 text-chart-3", label: "Landmine" },
  "Avoid":     { dot: "bg-destructive", badge: "border-destructive/30 bg-destructive/10 text-destructive", label: "Avoid" },
};

function OLScatterPlot({ rbImpacts }: { rbImpacts: RBOLImpact[]; onSelect: (rb: RBOLImpact) => void }) {
  const W = 480;
  const H = 320;
  const PAD = { top: 24, right: 24, bottom: 40, left: 48 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;
  const minOL = 30;
  const maxOL = 100;
  const minVal = 0;
  const maxVal = 11;
  const midOL = (minOL + maxOL) / 2;
  const midVal = (minVal + maxVal) / 2;
  const xScale = (v: number) => PAD.left + ((v - minOL) / (maxOL - minOL)) * iW;
  const yScale = (v: number) => PAD.top + iH - ((v - minVal) / (maxVal - minVal)) * iH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px] sm:h-[280px] overflow-visible">
      {/* Quadrant dividers */}
      <line x1={xScale(midOL)} y1={PAD.top} x2={xScale(midOL)} y2={PAD.top + iH} stroke="hsl(var(--border))" strokeDasharray="4 4" />
      <line x1={PAD.left} y1={yScale(midVal)} x2={PAD.left + iW} y2={yScale(midVal)} stroke="hsl(var(--border))" strokeDasharray="4 4" />
      {/* Quadrant labels */}
      <text x={xScale(midOL) + 6} y={PAD.top + 12} className="fill-primary" style={{ fontSize: 8, fontFamily: "var(--font-mono, monospace)" }}>FAVORABLE</text>
      <text x={PAD.left + 6} y={PAD.top + 12} className="fill-chart-3" style={{ fontSize: 8, fontFamily: "var(--font-mono, monospace)" }}>LANDMINE</text>
      <text x={xScale(midOL) + 6} y={yScale(midVal) + 14} className="fill-accent-foreground" style={{ fontSize: 8, fontFamily: "var(--font-mono, monospace)" }}>BUY LOW</text>
      <text x={PAD.left + 6} y={yScale(midVal) + 14} className="fill-destructive/80" style={{ fontSize: 8, fontFamily: "var(--font-mono, monospace)" }}>AVOID</text>
      {/* Axes */}
      <line x1={PAD.left} y1={PAD.top + iH} x2={PAD.left + iW} y2={PAD.top + iH} stroke="hsl(var(--border))" />
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + iH} stroke="hsl(var(--border))" />
      {/* Axis labels */}
      <text x={PAD.left + iW / 2} y={H - 2} textAnchor="middle" style={{ fontSize: 8, fill: "hsl(var(--muted-foreground))", fontFamily: "var(--font-mono, monospace)" }}>OL COMPOSITE SCORE →</text>
      <text x={10} y={PAD.top + iH / 2} textAnchor="middle" style={{ fontSize: 8, fill: "hsl(var(--muted-foreground))", fontFamily: "var(--font-mono, monospace)" }} transform={`rotate(-90, 10, ${PAD.top + iH / 2})`}>VALUE SCORE →</text>
      {/* Data points */}
      {rbImpacts.filter((rb) => hasValue(rb.olCompositeScore) && hasValue(rb.valueScore)).map((rb) => {
        // Plotting a back with no value score at 0,0 would place a rookie in
        // the "avoid" quadrant purely for having no 2025 production.
        const cx = xScale(clamp(rb.olCompositeScore as number, minOL, maxOL));
        const cy = yScale(clamp(rb.valueScore as number, minVal, maxVal));
        const color = rb.impactLabel === "Favorable" ? "hsl(var(--primary))" : rb.impactLabel === "Buy Low" ? "hsl(var(--accent-foreground))" : rb.impactLabel === "Landmine" ? "hsl(var(--chart-3))" : "hsl(var(--destructive))";
        return (
          <g key={rb.playerId}>
            <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity={0.8} stroke="hsl(var(--card))" strokeWidth={1.5} />
            {rb.rank <= 12 && <text x={cx + 7} y={cy + 3} style={{ fontSize: 7, fill: "hsl(var(--foreground))", fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>{rb.playerName.split(" ").at(-1)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function OLImpactPage() {
  const { data, isLoading, isError, refetch } = useGetOLImpact({ query: { queryKey: getGetOLImpactQueryKey() } });
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState<RBOLImpact | null>(null);
  const rbImpacts = data?.rbImpacts ?? [];
  const teamScores = data?.teamScores ?? [];
  const filtered = filter === "All" ? rbImpacts : rbImpacts.filter((rb) => rb.impactLabel === filter);

  return (
    <div className="mx-auto max-w-[1500px]">
      <SectionHeading
        eyebrow="OL Impact analysis"
        title="Follow the blocks."
        detail="Running backs plotted against their team's offensive line composite score — find the edges before the market does."
        action={<Link href="/teams" data-testid="link-teams-from-ol" className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[10px] font-semibold hover:border-primary/40 hover:text-primary"><LayoutGrid size={13} />Team matrix<ExternalLink size={11} /></Link>}
      />

      {isLoading ? (
        <LoadingRows />
      ) : isError ? (
        <ErrorState label="OL impact data could not be loaded." onRetry={() => void refetch()} />
      ) : (
        <>
          {/* Scatter + team scores */}
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_340px]">
            <Surface className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div><Kicker>Value vs line strength</Kicker><h2 className="mt-1 text-sm font-bold">RB scatter — OL composite vs value score</h2></div>
                <BarChart3 size={15} className="text-primary" />
              </div>
              <div className="px-4 py-4">
                <OLScatterPlot rbImpacts={rbImpacts} onSelect={setSelected} />
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
                {Object.values(IMPACT_COLORS).map(({ dot, badge, label }) => (
                  <span key={label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className={`h-2 w-2 rounded-full ${dot}`} />{label}
                  </span>
                ))}
              </div>
            </Surface>

            <div className="space-y-4">
              <Surface className="overflow-hidden">
                <div className="border-b border-border px-4 py-4"><Kicker>OL team scores</Kicker><h2 className="mt-1 text-sm font-bold">Composite grades</h2></div>
                <div className="divide-y divide-border/70">
                  {[...teamScores].sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1)).map((t) => (
                    <div key={t.team} className="flex items-center gap-3 px-4 py-3" data-testid={`ol-team-${t.team}`}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary mono text-[10px] font-medium">{t.team}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold">{t.fullName}</span>
                          <span className="mono text-[11px] font-medium">{int(t.compositeScore)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <ScoreBar value={t.compositeScore ?? 0} color="primary" />
                          <span className={`shrink-0 mono text-[9px] ${t.tier === "Elite" ? "text-primary" : t.tier === "Above Average" ? "text-primary/70" : t.tier === "Average" ? "text-accent-foreground" : "text-destructive"}`}>{t.tier}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Surface>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(IMPACT_COLORS).map(([key, { badge }]) => (
                  <div key={key} className="rounded-2xl border border-border bg-card p-3">
                    <span className={`inline-flex rounded-md border px-1.5 py-0.5 mono text-[9px] font-medium ${badge}`}>{key}</span>
                    <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                      {key === "Favorable" ? "Elite RB + strong line" : key === "Buy Low" ? "Underpriced RB, good line" : key === "Landmine" ? "Skilled RB, poor support" : "Low RB + weak line"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RB ranked matrix */}
          <div className="mt-6">
            <Surface className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div><Kicker>RB ranking matrix</Kicker><h2 className="mt-1 text-sm font-bold">{rbImpacts.length} running backs · ranked by composite rank</h2></div>
                <div className="flex flex-wrap gap-1.5">
                  {["All", "Favorable", "Buy Low", "Landmine", "Avoid"].map((label) => (
                    <button
                      type="button"
                      key={label}
                      onClick={() => setFilter(label)}
                      data-testid={`button-ol-filter-${label.toLowerCase().replace(" ", "-")}`}
                      className={`rounded-xl border px-2.5 py-1.5 mono text-[10px] font-semibold transition ${filter === label ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[780px]">
                  <div className="grid grid-cols-[36px_minmax(160px,1.6fr)_64px_80px_80px_90px_minmax(200px,1fr)] gap-3 border-b border-border bg-muted/45 px-5 py-2.5 text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                    <span>#</span><span>Player</span><span>Team</span><span>OL Score</span><span>OL Tier</span><span>Impact</span><span>PPG / Value</span>
                  </div>
                  {filtered.length === 0 ? (
                    <EmptyState label="No RBs match this filter." />
                  ) : (
                    filtered.map((rb) => {
                      const col = IMPACT_COLORS[rb.impactLabel] ?? IMPACT_COLORS["Avoid"];
                      return (
                        <div
                          key={rb.playerId}
                          className="data-row grid grid-cols-[36px_minmax(160px,1.6fr)_64px_80px_80px_90px_minmax(200px,1fr)] items-center gap-3 border-b border-border/70 px-5 py-3 last:border-b-0 hover:bg-primary/[0.03] cursor-pointer"
                          data-testid={`row-rb-ol-${rb.playerId}`}
                          onClick={() => setLocation(`/players/${rb.playerId}`)}
                        >
                          <span className="mono text-[11px] text-muted-foreground">{String(rb.rank).padStart(2, "0")}</span>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-[10px] font-bold">{initials(rb.playerName)}</span>
                            <span className="truncate text-[12px] font-bold hover:text-primary">{rb.playerName}</span>
                          </div>
                          <span className="mono text-[11px] text-muted-foreground">{rb.team}</span>
                          <span className="mono text-[12px] font-medium">{int(rb.olCompositeScore)}<span className="text-muted-foreground text-[9px]">/100</span></span>
                          <span className={`mono text-[10px] font-medium ${rb.olTier === "Elite" ? "text-primary" : rb.olTier === "Above Average" ? "text-primary/70" : rb.olTier === "Average" ? "text-accent-foreground" : "text-destructive"}`}>{rb.olTier}</span>
                          <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 mono text-[9px] font-medium ${col.badge}`}>{rb.impactLabel}</span>
                          <span className="mono text-[10px] text-muted-foreground">{num(rb.ppg)} PPG · <span className={`font-medium ${valueTone(rb.valueScore)}`}>{fmtValueScore(rb.valueScore)} val</span></span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-border px-5 py-3">
                <span className="mono text-[9px] text-muted-foreground">Click any row to open the player detail · OL composite = weighted ALY + stuff rate + pass block + snap continuity</span>
              </div>
            </Surface>
          </div>

          {/* Selected RB blurb */}
          {selected && (
            <div className="mt-6">
              <Surface className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Activity size={15} className="text-accent-foreground" /><Kicker>Analyst blurb — {selected.playerName}</Kicker></div>
                  <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-1 text-muted-foreground hover:bg-muted"><X size={14} /></button>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 mono text-[10px] font-medium ${IMPACT_COLORS[selected.impactLabel]?.badge ?? ""}`}>{selected.impactLabel}</span>
                  <span className="mono text-[10px] text-muted-foreground">OL {int(selected.olCompositeScore)}/100 · {selected.olTier}</span>
                </div>
                <p className="mt-3 text-[12px] leading-6 text-muted-foreground">{selected.blurb}</p>
                <button type="button" onClick={() => setLocation(`/players/${selected.playerId}`)} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[10px] font-bold text-primary-foreground hover:-translate-y-0.5 hover:shadow-md transition"><Target size={12} />Open player detail</button>
              </Surface>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TeamsPage() {
  const { data: teamsData, isLoading, isError, refetch } = useGetTeams();
  const teams = teamsData ?? [];
  const [search, setSearch] = useState("");
  const [trend, setTrend] = useState("all");
  const filtered = teams.filter((team) => team.fullName.toLowerCase().includes(search.toLowerCase()) || team.team.toLowerCase().includes(search.toLowerCase())).filter((team) => trend === "all" || team.trend.toLowerCase().includes(trend));
  // Thresholds are relative to each metric's real range across the 32 teams.
  // A flat "good is >= 65" only worked on the old generated numbers: real
  // adjusted line yards top out around 3.5, so every team graded red.
  const colorMetric = (value: number | null | undefined, range: { min: number; max: number }, inverse = false) => {
    if (!hasValue(value)) return "text-muted-foreground";
    const position = inverse ? 100 - barWidth(value, range.min, range.max) : barWidth(value, range.min, range.max);
    return position >= 65 ? "text-primary" : position < 35 ? "text-destructive" : "text-accent-foreground";
  };
  const RANGE = { aly: { min: 2.2, max: 3.7 }, stuffRate: { min: 9, max: 27 }, grade: { min: 0, max: 100 } };
  return <div className="mx-auto max-w-[1500px]"><SectionHeading eyebrow="Context matrix" title="Follow the blocking." detail="Offensive environment changes the shape of every player bet." action={<div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"><Users size={14} className="text-primary" /><span className="mono text-[10px]">{teams.length || "—"} teams indexed</span></div>} /><Surface className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:w-[260px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a team" data-testid="input-search-teams" className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-xs outline-none focus:ring-4 focus:ring-primary/10" /></div><div className="flex items-center gap-2"><Filter size={13} className="text-muted-foreground" /><select value={trend} onChange={(event) => setTrend(event.target.value)} data-testid="select-team-trend" className="rounded-xl border border-input bg-background px-3 py-2 text-[10px] font-semibold outline-none"><option value="all">All trends</option><option value="up">Rising</option><option value="down">Falling</option></select></div></div>{isLoading ? <LoadingRows /> : isError ? <ErrorState label="Team context is temporarily out of range." onRetry={() => void refetch()} /> : filtered.length === 0 ? <EmptyState label="No team matches this filter." /> : <div className="overflow-x-auto"><div className="min-w-[980px]"><div className="grid grid-cols-[1.6fr_repeat(7,1fr)] gap-3 border-b border-border bg-muted/45 px-5 py-3 text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground"><span>Team / offense</span><span>ALY</span><span>Stuff rate</span><span>Pass block</span><span>PROE</span><span>Snap cont.</span><span>Vacated opp.</span><span>Trend</span></div>{filtered.map((team) => <div key={team.team} data-testid={`row-team-${team.team}`} className="data-row grid grid-cols-[1.6fr_repeat(7,1fr)] items-center gap-3 border-b border-border/70 px-5 py-4 last:border-b-0"><div><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary mono text-[10px] font-medium">{team.team}</span><div><p className="text-[11px] font-bold">{team.fullName}</p><p className="mono mt-0.5 text-[9px] text-muted-foreground">offensive environment</p></div></div></div><span className={`mono text-[11px] font-medium ${colorMetric(team.aly, RANGE.aly)}`}>{num(team.aly, 2)}</span><span className={`mono text-[11px] ${colorMetric(team.stuffRate, RANGE.stuffRate, true)}`}>{pct(team.stuffRate)}</span><span className={`mono text-[11px] font-medium ${colorMetric(team.passBlockGrade, RANGE.grade)}`}>{num(team.passBlockGrade)}</span><span className={`mono text-[11px] ${!hasValue(team.proe) ? "text-muted-foreground" : team.proe >= 0 ? "text-primary" : "text-destructive"}`}>{hasValue(team.proe) && team.proe > 0 ? "+" : ""}{pct(team.proe)}</span><span className="mono text-[11px]">{pct(team.snapContinuity)}</span><span className="mono text-[11px]">{pct(team.vacatedOpportunity)}</span><span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${team.trend.toLowerCase().includes("up") || team.trend.toLowerCase().includes("rise") ? "text-primary" : "text-destructive"}`}>{team.trend.toLowerCase().includes("up") || team.trend.toLowerCase().includes("rise") ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{team.trend}</span></div>)}</div></div>}<div className="flex items-center justify-between border-t border-border px-5 py-3"><span className="text-[10px] text-muted-foreground">Grades normalized to 2025 league baseline</span><span className="mono text-[9px] text-muted-foreground">select a row to compare</span></div></Surface><div className="mt-6 grid gap-4 md:grid-cols-3"><Surface className="p-5"><Kicker>How to read it</Kicker><h2 className="mt-2 text-sm font-bold">Context is a multiplier.</h2><p className="mt-2 text-[11px] leading-5 text-muted-foreground">Prioritize skill players attached to stable snaps, efficient blocking, and positive pass rate over expectation.</p></Surface><Surface className="border-accent/25 bg-accent/[0.06] p-5"><Kicker>Opportunity watch</Kicker><h2 className="mt-2 text-sm font-bold">Vacated targets are live capital.</h2><p className="mt-2 text-[11px] leading-5 text-muted-foreground">Use the vacated opportunity column to spot offenses where a role can expand before the market moves.</p></Surface><Surface className="p-5"><Kicker>RB impact analysis</Kicker><h2 className="mt-2 text-sm font-bold">See which RBs the line helps.</h2><p className="mt-2 text-[11px] leading-5 text-muted-foreground">The OL Impact view plots every RB against their team's composite line score to surface buy-lows and landmines.</p><Link href="/ol-impact" data-testid="link-ol-impact-from-teams" className="mt-3 flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline">Open OL Impact <ExternalLink size={11} /></Link></Surface></div></div>;
}

function NewsPage() {
  const { data: newsData, isLoading, isError, refetch } = useGetNews();
  const { data: playersData } = useGetPlayers();
  const news = newsData ?? [];
  const players = playersData ?? [];
  const [filter, setFilter] = useState("all");
  const playerById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const visible = news.filter((item) => filter === "all" || item.status.toLowerCase().includes(filter) || item.sentiment.toLowerCase().includes(filter));
  return <div className="mx-auto max-w-[1250px]"><SectionHeading eyebrow="Signal feed" title="Know what changed." detail="The stories that can move a pick, filtered for draft relevance." action={<div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" /><span className="mono text-[10px] text-muted-foreground">no live source</span></div>} /><div className="mb-5 flex gap-2 overflow-x-auto">{[["all", "All signals"], ["injury", "Injury"], ["positive", "Positive"], ["negative", "Negative"]].map(([value, label]) => <button type="button" key={value} onClick={() => setFilter(value)} data-testid={`button-news-filter-${value}`} className={`shrink-0 rounded-xl border px-3 py-2 text-[10px] font-semibold ${filter === value ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div><div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_310px]"><Surface className="overflow-hidden">{isLoading ? <LoadingRows /> : isError ? <ErrorState label="The signal feed is not responding." onRetry={() => void refetch()} /> : visible.length === 0 ? <EmptyState label={news.length === 0 ? "No live feed connected. The player dataset is built from completed-season production and market data, and carries no injury or beat reporting." : "No reports match the current lens."} /> : <div className="divide-y divide-border">{visible.map((item, index) => { const player = item.playerId ? playerById.get(item.playerId) : undefined; const positive = item.sentiment.toLowerCase().includes("positive"); const negative = item.sentiment.toLowerCase().includes("negative"); return <article key={item.id} className="enter flex gap-4 p-5 transition-colors hover:bg-primary/[0.035]" style={{ animationDelay: `${index * 55}ms` }} data-testid={`article-news-${item.id}`}><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[10px] font-bold ${positive ? "bg-primary/12 text-primary" : negative ? "bg-destructive/10 text-destructive" : "bg-secondary text-secondary-foreground"}`}>{initials(item.source)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="mono text-[9px] font-medium uppercase tracking-[0.15em] text-primary">{item.source}</span><span className="text-border">/</span><span className="mono text-[9px] text-muted-foreground">{formatTime(item.timestamp)}</span>{player && <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[9px] font-semibold">{player.name}</span>}</div><h2 className="mt-2 text-sm font-bold leading-5">{item.headline}</h2><div className="mt-3 flex items-center gap-3"><span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${positive ? "text-primary" : negative ? "text-destructive" : "text-muted-foreground"}`}>{positive ? <TrendingUp size={12} /> : negative ? <TrendingDown size={12} /> : <ActivityIcon />}{item.status}</span><span className="text-[10px] text-muted-foreground">reported by {item.author}</span></div></div><button type="button" data-testid={`button-save-news-${item.id}`} aria-label={`Save ${item.headline}`} className="self-start rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-primary"><BookOpen size={14} /></button></article>; })}</div>}<div className="border-t border-border px-5 py-3 mono text-[9px] text-muted-foreground">Source timestamps are normalized to your local clock.</div></Surface><div className="space-y-6"><Surface className="p-5"><div className="flex items-center justify-between"><div><Kicker>Radar legend</Kicker><h2 className="mt-1 text-sm font-bold">Read the tape</h2></div><ShieldAlert size={15} className="text-accent-foreground" /></div><div className="mt-5 space-y-4"><div className="flex gap-3"><span className="mt-1 h-2 w-2 rounded-full bg-destructive" /><div><p className="text-[11px] font-bold">Negative / risk</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Injuries, role erosion, or market pressure.</p></div></div><div className="flex gap-3"><span className="mt-1 h-2 w-2 rounded-full bg-primary" /><div><p className="text-[11px] font-bold">Positive / tailwind</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Usage, health, or opportunity breaking right.</p></div></div><div className="flex gap-3"><span className="mt-1 h-2 w-2 rounded-full bg-accent" /><div><p className="text-[11px] font-bold">Monitor</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Worth a flag before your next nomination.</p></div></div></div></Surface><Surface className="p-5"><Kicker>Draft room protocol</Kicker><h2 className="mt-2 display text-xl font-semibold leading-tight">Read once. Verify twice. Act before the room does.</h2><div className="mt-5 flex items-center gap-2 text-[10px] text-muted-foreground"><span className="mono rounded bg-secondary px-1.5 py-1">01</span><span>Scan the headline</span></div><div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground"><span className="mono rounded bg-secondary px-1.5 py-1">02</span><span>Check player context</span></div><div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground"><span className="mono rounded bg-secondary px-1.5 py-1">03</span><span>Re-price your board</span></div></Surface></div></div></div>;
}

function ActivityIcon() {
  return <span className="h-2 w-2 rounded-full bg-accent" />;
}

function Router() {
  const [location, setLocation] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={HomePage} /><Route path="/players/:id" component={PlayerPage} /><Route path="/teams" component={TeamsPage} /><Route path="/ol-impact" component={OLImpactPage} /><Route path="/news" component={NewsPage} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}><Shell><Router /></Shell></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;