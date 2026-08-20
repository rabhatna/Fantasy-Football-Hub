import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileUp,
  Loader2,
  Lock,
  Pencil,
  Search,
  X,
} from "lucide-react";
import {
  getGetDraftSummaryQueryKey,
  getGetKeepersQueryKey,
  getGetRecommendationsQueryKey,
  useDeleteKeeper,
  useGetKeepers,
  useGetPlayers,
  useGetSettings,
  useImportKeepers,
  useSaveKeeper,
  useUpdateKeeper,
} from "@workspace/api-client-react";
import type { Keeper, KeeperImportResult, KeeperInput, Player } from "@workspace/api-client-react";
import { SettingsForm } from "@/components/settings-dialog";

const inputClass =
  "mono w-full rounded-lg border border-border bg-card px-2.5 py-2 text-[12px] font-medium focus:border-primary/50 focus:outline-none";

const SHEET_TEMPLATE = `player,team,owner,round,dollars
Christian McCaffrey,SF,me,3,
Ja'Marr Chase,CIN,Team Rocket,1,
Josh Allen,BUF,The Bills Mafia,,45
`;

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </span>
  );
}

function Panel({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm" data-testid={testId}>
      {children}
    </section>
  );
}

/**
 * One keeper, editable in place. The player is fixed — a wrong player is a
 * remove-and-re-add — but the owner, team label and cost can all be corrected
 * without touching the sheet again.
 */
function KeeperRow({
  keeper,
  onRemove,
  removing,
  onSaved,
}: {
  keeper: Keeper;
  onRemove: (id: string) => void;
  removing: boolean;
  onSaved: () => void;
}) {
  const updateKeeper = useUpdateKeeper();
  const [editing, setEditing] = useState(false);
  const [owner, setOwner] = useState<Keeper["owner"]>(keeper.owner);
  const [ownerName, setOwnerName] = useState(keeper.ownerName);
  const [costType, setCostType] = useState<Keeper["costType"]>(keeper.costType);
  const [costValue, setCostValue] = useState(keeper.costValue);

  const beginEdit = () => {
    setOwner(keeper.owner);
    setOwnerName(keeper.ownerName);
    setCostType(keeper.costType);
    setCostValue(keeper.costValue);
    setEditing(true);
  };

  const save = () => {
    updateKeeper.mutate(
      { id: keeper.id, data: { owner, ownerName, costType, costValue } },
      {
        onSuccess: () => {
          setEditing(false);
          onSaved();
        },
      },
    );
  };

  return (
    <div className="group rounded-xl bg-muted/60 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="mono w-8 text-[10px] text-muted-foreground">{keeper.position}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-bold">{keeper.playerName}</span>
          <span className="mono text-[9px] text-muted-foreground">{keeper.team}</span>
        </span>
        {!editing && (
          <span className="mono text-[10px] text-muted-foreground">
            {keeper.costType === "round" ? `round ${keeper.costValue}` : `$${keeper.costValue}`}
          </span>
        )}
        <button
          type="button"
          onClick={() => (editing ? setEditing(false) : beginEdit())}
          data-testid={`button-edit-keeper-${keeper.playerId}`}
          aria-label={`Edit keeper ${keeper.playerName}`}
          className={`rounded-md p-1 transition hover:bg-primary/10 hover:text-primary ${
            editing ? "text-primary" : "text-muted-foreground opacity-50 group-hover:opacity-100"
          }`}
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={() => onRemove(keeper.id)}
          disabled={removing}
          data-testid={`button-remove-keeper-${keeper.playerId}`}
          aria-label={`Remove keeper ${keeper.playerName}`}
          className="rounded-md p-1 text-muted-foreground opacity-50 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:opacity-30"
        >
          {removing ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
        </button>
      </div>
      {editing && (
        <div className="mt-2.5 border-t border-border/60 pt-2.5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block">
              <Kicker>Whose team</Kicker>
              <select
                className={`${inputClass} mt-1`}
                value={owner}
                data-testid={`select-edit-owner-${keeper.playerId}`}
                onChange={(event) => setOwner(event.target.value as Keeper["owner"])}
              >
                <option value="me">Mine</option>
                <option value="other">Another team</option>
              </select>
            </label>
            {owner === "other" ? (
              <label className="block">
                <Kicker>Team name</Kicker>
                <input
                  type="text"
                  className={`${inputClass} mt-1`}
                  value={ownerName}
                  placeholder="e.g. Team Rocket"
                  data-testid={`input-edit-owner-name-${keeper.playerId}`}
                  onChange={(event) => setOwnerName(event.target.value)}
                />
              </label>
            ) : (
              <span className="hidden sm:block" />
            )}
            <label className="block">
              <Kicker>{costType === "round" ? "Round" : "Dollars"}</Kicker>
              <div className="mt-1 flex gap-1.5">
                <select
                  className={`${inputClass} w-16`}
                  value={costType}
                  data-testid={`select-edit-cost-type-${keeper.playerId}`}
                  onChange={(event) => setCostType(event.target.value as Keeper["costType"])}
                >
                  <option value="round">Rd</option>
                  <option value="dollars">$</option>
                </select>
                <input
                  type="number"
                  min={costType === "round" ? 1 : 0}
                  value={costValue}
                  data-testid={`input-edit-cost-${keeper.playerId}`}
                  className={inputClass}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next) && next >= 0) setCostValue(Math.trunc(next));
                  }}
                />
              </div>
            </label>
            <div className="flex items-end gap-1.5">
              <button
                type="button"
                onClick={save}
                disabled={updateKeeper.isPending || (costType === "round" && costValue < 1)}
                data-testid={`button-save-keeper-${keeper.playerId}`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 py-2 text-[11px] font-bold text-primary-foreground disabled:opacity-50"
              >
                {updateKeeper.isPending ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Check size={11} />
                )}
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-border px-2.5 py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
          {updateKeeper.isError && (
            <p className="mt-1.5 text-[10px] font-semibold text-destructive">
              The change could not be saved.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SheetUpload({ onDone, onReview }: { onDone: () => void; onReview: () => void }) {
  const importKeepers = useImportKeepers();
  const [replace, setReplace] = useState(true);
  const [result, setResult] = useState<KeeperImportResult | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const upload = async (file: File) => {
    const csv = await file.text();
    importKeepers.mutate(
      { data: { csv, replace } },
      {
        onSuccess: (outcome) => {
          setResult(outcome);
          onDone();
        },
      },
    );
  };

  const copyTemplate = () => {
    void navigator.clipboard.writeText(SHEET_TEMPLATE).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const downloadTemplate = () => {
    const blob = new Blob([SHEET_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "keeper-sheet-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel testId="panel-keeper-upload">
      <div className="flex items-center justify-between">
        <div>
          <Kicker>Bulk import</Kicker>
          <h2 className="mt-1 text-sm font-bold">Upload the league's keeper sheet</h2>
        </div>
        <FileUp size={15} className="text-muted-foreground" />
      </div>
      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        A CSV with one keeper per row. <span className="mono">owner</span> is{" "}
        <span className="mono">me</span> for your team or the league team's name;{" "}
        <span className="mono">team</span> only matters when two ranked players share a name;
        fill <span className="mono">round</span> for snake keepers or{" "}
        <span className="mono">dollars</span> for auction ones. Anything the upload gets wrong
        can be fixed afterwards — every keeper is editable in place.
      </p>
      <pre className="mono mt-2 overflow-x-auto rounded-lg bg-muted/60 p-2.5 text-[10px] leading-4 text-muted-foreground">
        {SHEET_TEMPLATE}
      </pre>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          data-testid="input-keeper-sheet"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={importKeepers.isPending}
          data-testid="button-upload-sheet"
          className="flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 disabled:opacity-60"
        >
          {importKeepers.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <FileUp size={12} />
          )}
          Choose CSV
        </button>
        <button
          type="button"
          onClick={downloadTemplate}
          data-testid="button-download-template"
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        >
          <Download size={12} />
          Download template
        </button>
        <button
          type="button"
          onClick={copyTemplate}
          data-testid="button-copy-template"
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check size={12} className="text-primary" /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy template"}
        </button>
        <label className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
          <input
            type="checkbox"
            checked={replace}
            data-testid="checkbox-replace-keepers"
            onChange={(event) => setReplace(event.target.checked)}
          />
          Replace existing keepers
        </label>
      </div>
      {importKeepers.isError && (
        <p className="mt-2 text-[11px] font-semibold text-destructive">
          The sheet was rejected — check it has player and owner columns.
        </p>
      )}
      {result && (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-[11px]" data-testid="status-import-result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              Imported {result.imported} keeper{result.imported === 1 ? "" : "s"}
              {result.skipped.length > 0 && `, ${result.skipped.length} row${result.skipped.length === 1 ? "" : "s"} skipped`}.
            </p>
            {result.imported > 0 && (
              <button
                type="button"
                onClick={onReview}
                data-testid="button-review-keepers"
                className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-[10px] font-bold text-primary hover:bg-primary/15"
              >
                Review &amp; edit the list →
              </button>
            )}
          </div>
          {result.skipped.length > 0 && (
            <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto text-[10px] text-muted-foreground">
              {result.skipped.map((skip) => (
                <li key={skip.line}>
                  Line {skip.line}: {skip.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function AddKeeper({ keptIds, onDone }: { keptIds: ReadonlySet<string>; onDone: () => void }) {
  const { data: players } = useGetPlayers();
  const { data: settings } = useGetSettings();
  const saveKeeper = useSaveKeeper();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Player | null>(null);
  const [owner, setOwner] = useState<KeeperInput["owner"]>("me");
  const [ownerName, setOwnerName] = useState("");
  const [costType, setCostType] = useState<KeeperInput["costType"]>("round");
  const [costValue, setCostValue] = useState(1);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length < 2) return [];
    return (players ?? [])
      .filter((player) => !keptIds.has(player.id) && player.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [players, search, keptIds]);

  const add = () => {
    if (!selected) return;
    saveKeeper.mutate(
      { data: { playerId: selected.id, owner, ownerName, costType, costValue } },
      {
        onSuccess: () => {
          setSelected(null);
          setSearch("");
          onDone();
        },
      },
    );
  };

  return (
    <Panel testId="panel-add-keeper">
      <Kicker>Add one keeper</Kicker>
      <div className="relative mt-2">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={selected ? selected.name : search}
          onChange={(event) => {
            setSelected(null);
            setSearch(event.target.value);
          }}
          placeholder="Search the 250-player board"
          data-testid="input-keeper-search"
          className={`${inputClass} pl-8`}
        />
        {matches.length > 0 && !selected && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            {matches.map((player) => (
              <button
                type="button"
                key={player.id}
                onClick={() => setSelected(player)}
                data-testid={`button-keeper-candidate-${player.id}`}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-muted"
              >
                <span className="mono w-8 text-[10px] text-muted-foreground">{player.position}</span>
                <span className="font-semibold">{player.name}</span>
                <span className="mono ml-auto text-[10px] text-muted-foreground">
                  {player.team} · ADP {(player.adpConsensus ?? player.adp).toFixed(1)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block">
          <Kicker>Whose team</Kicker>
          <select
            className={`${inputClass} mt-1`}
            value={owner}
            data-testid="select-keeper-owner"
            onChange={(event) => setOwner(event.target.value as KeeperInput["owner"])}
          >
            <option value="me">Mine</option>
            <option value="other">Another team</option>
          </select>
        </label>
        {owner === "other" ? (
          <label className="block">
            <Kicker>Team name</Kicker>
            <input
              type="text"
              className={`${inputClass} mt-1`}
              value={ownerName}
              placeholder="e.g. Team Rocket"
              data-testid="input-keeper-owner-name"
              onChange={(event) => setOwnerName(event.target.value)}
            />
          </label>
        ) : (
          <span />
        )}
        <label className="block">
          <Kicker>{costType === "round" ? "Round" : "Dollars"}</Kicker>
          <div className="mt-1 flex gap-1.5">
            <select
              className={`${inputClass} w-20`}
              value={costType}
              data-testid="select-keeper-cost-type"
              onChange={(event) => setCostType(event.target.value as KeeperInput["costType"])}
            >
              <option value="round">Rd</option>
              <option value="dollars">$</option>
            </select>
            <input
              type="number"
              min={costType === "round" ? 1 : 0}
              max={costType === "round" ? 30 : (settings?.auctionBudget ?? 200)}
              value={costValue}
              data-testid="input-keeper-cost"
              className={inputClass}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next) && next >= 0) setCostValue(Math.trunc(next));
              }}
            />
          </div>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={add}
            disabled={!selected || saveKeeper.isPending}
            data-testid="button-add-keeper"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            {saveKeeper.isPending ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
            Keep player
          </button>
        </div>
      </div>
      {saveKeeper.isError && (
        <p className="mt-2 text-[11px] font-semibold text-destructive">
          The keeper could not be saved.
        </p>
      )}
    </Panel>
  );
}

/** One league team's keepers, collapsible so a full 12-team sheet stays scannable. */
function TeamGroup({
  name,
  keepers,
  onRemove,
  pendingId,
  onSaved,
}: {
  name: string;
  keepers: Keeper[];
  onRemove: (id: string) => void;
  pendingId: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        data-testid={`button-toggle-team-${name}`}
        className="flex w-full items-center gap-1.5 rounded-md py-0.5 text-left"
      >
        {open ? (
          <ChevronDown size={11} className="text-muted-foreground" />
        ) : (
          <ChevronRight size={11} className="text-muted-foreground" />
        )}
        <span className="mono text-[10px] font-semibold text-foreground">{name}</span>
        <span className="mono ml-auto text-[9px] text-muted-foreground">{keepers.length}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          {keepers.map((keeper) => (
            <KeeperRow
              key={keeper.id}
              keeper={keeper}
              onRemove={onRemove}
              removing={pendingId === keeper.id}
              onSaved={onSaved}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type LeagueView = "book" | "import" | "add";

/**
 * The league tab: rules, pick ownership, and keepers in one place. Everything
 * here persists on disk and reshapes the draft room — needs, remaining picks,
 * the available pool, and the suggestions. The keeper side is split into
 * views (book / import / add) so a full league's sheet never turns the page
 * into one long scroll.
 */
export default function LeaguePage() {
  const { data: keepers, isLoading } = useGetKeepers();
  const deleteKeeper = useDeleteKeeper();
  const client = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [view, setView] = useState<LeagueView>("book");

  const keptIds = useMemo(
    () => new Set((keepers ?? []).map((keeper) => keeper.playerId)),
    [keepers],
  );

  const refreshKeepers = () => {
    void client.invalidateQueries({ queryKey: getGetKeepersQueryKey() });
    void client.invalidateQueries({ queryKey: getGetDraftSummaryQueryKey() });
    void client.invalidateQueries({ queryKey: getGetRecommendationsQueryKey() });
  };

  const removeKeeper = (id: string) => {
    setPendingId(id);
    deleteKeeper.mutate(
      { id },
      { onSuccess: refreshKeepers, onSettled: () => setPendingId(null) },
    );
  };

  const mine = (keepers ?? []).filter((keeper) => keeper.owner === "me");
  const others = (keepers ?? []).filter((keeper) => keeper.owner === "other");
  const byTeam = useMemo(() => {
    const map = new Map<string, Keeper[]>();
    for (const keeper of others) {
      const label = keeper.ownerName || "Unnamed team";
      map.set(label, [...(map.get(label) ?? []), keeper]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [others]);

  const views: { value: LeagueView; label: string }[] = [
    { value: "book", label: `Keeper book (${(keepers ?? []).length})` },
    { value: "import", label: "Import sheet" },
    { value: "add", label: "Add one" },
  ];

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-5">
        <Kicker>League room</Kicker>
        <h1 className="display mt-1.5 text-[27px] font-bold tracking-[-0.04em] sm:text-[32px]">
          Your league, your rules
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Rules, pick ownership and keepers — the draft room reshapes itself around what you set
          here, and it all persists between sessions.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-6">
          <Panel testId="panel-league-settings">
            <Kicker>Rules &amp; picks</Kicker>
            <h2 className="mb-4 mt-1 text-sm font-bold">League settings</h2>
            <SettingsForm />
          </Panel>
        </div>

        <div className="min-w-0">
          <div className="mb-4 flex gap-2 overflow-x-auto" data-testid="nav-keeper-views">
            {views.map((entry) => (
              <button
                type="button"
                key={entry.value}
                onClick={() => setView(entry.value)}
                data-testid={`button-view-${entry.value}`}
                className={`shrink-0 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
                  view === entry.value
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {view === "import" && (
            <SheetUpload onDone={refreshKeepers} onReview={() => setView("book")} />
          )}
          {view === "add" && <AddKeeper keptIds={keptIds} onDone={refreshKeepers} />}
          {view === "book" && (
            <div className="space-y-6">
              <Panel testId="panel-my-keepers">
                <div className="flex items-center justify-between">
                  <Kicker>My keepers</Kicker>
                  <span className="mono text-[10px] text-muted-foreground">{mine.length}</span>
                </div>
                <div className="mt-3 max-h-[300px] space-y-2 overflow-y-auto pr-1">
                  {isLoading ? (
                    <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  ) : mine.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No keepers yet. Import the league sheet or add one by hand.
                    </p>
                  ) : (
                    mine.map((keeper) => (
                      <KeeperRow
                        key={keeper.id}
                        keeper={keeper}
                        onRemove={removeKeeper}
                        removing={pendingId === keeper.id}
                        onSaved={refreshKeepers}
                      />
                    ))
                  )}
                </div>
              </Panel>

              <Panel testId="panel-league-keepers">
                <div className="flex items-center justify-between">
                  <Kicker>The rest of the league</Kicker>
                  <span className="mono text-[10px] text-muted-foreground">{others.length} kept</span>
                </div>
                {others.length === 0 ? (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    No other keepers entered. Upload the sheet so they come off your board.
                  </p>
                ) : (
                  <div className="mt-3 max-h-[480px] space-y-4 overflow-y-auto pr-1">
                    {byTeam.map(([teamName, teamKeepers]) => (
                      <TeamGroup
                        key={teamName}
                        name={teamName}
                        keepers={teamKeepers}
                        onRemove={removeKeeper}
                        pendingId={pendingId}
                        onSaved={refreshKeepers}
                      />
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
