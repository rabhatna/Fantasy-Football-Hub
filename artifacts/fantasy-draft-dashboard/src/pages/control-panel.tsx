import { useLocation } from "wouter";
import DraftPlanPage from "@/pages/draft-plan";
import DraftSheetPage from "@/pages/draft-sheet";
import LeaguePage from "@/pages/league";

/**
 * Draft HQ: one control panel over the whole draft-prep flow. The three
 * stations are a real sequence — set the league's rules and keepers, tune
 * and rerun the plan against the live board, then print the sheet the plan
 * produced — so they live under one roof with one switcher, and every
 * station reads the same stores: stars, keepers, settings, and the plan
 * engine's signal layer.
 */

type ViewKey = "league" | "plan" | "sheet";

const VIEWS: { key: ViewKey; path: string; step: string; label: string; matches: string[] }[] = [
  { key: "league", path: "/league", step: "1", label: "League & keepers", matches: ["/league", "/keepers"] },
  { key: "plan", path: "/plan", step: "2", label: "Plan room", matches: ["/plan", "/hq"] },
  { key: "sheet", path: "/draft-sheet", step: "3", label: "Draft sheet", matches: ["/draft-sheet"] },
];

export default function ControlPanelPage() {
  const [location, setLocation] = useLocation();
  const active =
    VIEWS.find((view) => view.matches.some((path) => location.startsWith(path))) ?? VIEWS[1];

  return (
    <div>
      <div className="mx-auto mb-5 max-w-[1250px] print:hidden">
        <div className="flex flex-wrap items-center gap-2" data-testid="nav-draft-hq">
          <span className="mono mr-1 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            Draft HQ
          </span>
          {VIEWS.map((view) => (
            <button
              type="button"
              key={view.key}
              onClick={() => setLocation(view.path)}
              data-testid={`button-hq-${view.key}`}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
                active.key === view.key
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`mono text-[9px] ${active.key === view.key ? "text-primary/60" : "text-muted-foreground/60"}`}>
                {view.step}
              </span>
              {view.label}
            </button>
          ))}
          <span className="mono ml-1 hidden text-[9px] text-muted-foreground sm:inline">
            rules &amp; keepers → tune the plan → print the sheet
          </span>
        </div>
      </div>

      {active.key === "league" && <LeaguePage />}
      {active.key === "plan" && <DraftPlanPage />}
      {active.key === "sheet" && <DraftSheetPage />}
    </div>
  );
}
