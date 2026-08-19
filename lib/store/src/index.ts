import path from "node:path";
import { CsvTable, type TableSchema } from "./table.ts";
import { LeagueSettingsStore } from "./settings.ts";

export { CsvTable, type TableSchema } from "./table.ts";
export { parseCsv, stringifyCsv, type CsvRow } from "./csv.ts";
export { writeFileAtomic, readFileOrNull } from "./atomic.ts";
export {
  DEFAULT_LEAGUE_SETTINGS,
  LeagueSettingsStore,
  sanitizeLeagueSettings,
  type DraftType,
  type LeagueSettingsRecord,
  type RosterSettings,
  type ScoringFormat,
} from "./settings.ts";

/**
 * A drafted player.
 *
 * `playerId` is the join key, but it is derived from the player's name in the
 * current dataset, so it is *not* stable across a data refresh. Name, team and
 * position are stored alongside it so a pick can be re-linked when ids shift,
 * and so the file is legible when opened in a spreadsheet.
 */
export interface DraftPickRecord {
  id: string;
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  pickNumber: number;
  draftedAt: string;
}

/**
 * A keeper: a player already spoken for before the draft starts.
 *
 * `owner` is deliberately just "me" or "other" — the app tracks one user's
 * board, so another team's keeper only matters as a name off the pool, not as
 * part of a full league model. The cost is a round (snake leagues, where the
 * keeper consumes that round's pick) or dollars (auction budgets).
 */
export interface KeeperRecord {
  id: string;
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  owner: "me" | "other";
  costType: "round" | "dollars";
  costValue: number;
  createdAt: string;
}

/** A free-text note attached to a player. */
export interface PlayerNoteRecord {
  playerId: string;
  playerName: string;
  note: string;
  updatedAt: string;
}

function requireField(row: Record<string, string>, key: string): string | null {
  const value = row[key]?.trim();
  return value ? value : null;
}

const draftPickSchema: TableSchema<DraftPickRecord> = {
  columns: ["id", "player_id", "player_name", "team", "position", "pick_number", "drafted_at"],
  encode: (record) => ({
    id: record.id,
    player_id: record.playerId,
    player_name: record.playerName,
    team: record.team,
    position: record.position,
    pick_number: String(record.pickNumber),
    drafted_at: record.draftedAt,
  }),
  decode: (row) => {
    const playerId = requireField(row, "player_id");
    if (!playerId) return null; // a row with no player is not a pick

    const pickNumber = Number(row["pick_number"]);

    return {
      id: requireField(row, "id") ?? `pick-${playerId}`,
      playerId,
      playerName: row["player_name"] ?? "",
      team: row["team"] ?? "",
      position: row["position"] ?? "",
      pickNumber: Number.isFinite(pickNumber) ? pickNumber : 0,
      draftedAt: row["drafted_at"] ?? "",
    };
  },
};

const keeperSchema: TableSchema<KeeperRecord> = {
  columns: [
    "id",
    "player_id",
    "player_name",
    "team",
    "position",
    "owner",
    "cost_type",
    "cost_value",
    "created_at",
  ],
  encode: (record) => ({
    id: record.id,
    player_id: record.playerId,
    player_name: record.playerName,
    team: record.team,
    position: record.position,
    owner: record.owner,
    cost_type: record.costType,
    cost_value: String(record.costValue),
    created_at: record.createdAt,
  }),
  decode: (row) => {
    const playerId = requireField(row, "player_id");
    if (!playerId) return null;

    const costValue = Number(row["cost_value"]);

    return {
      id: requireField(row, "id") ?? `keeper-${playerId}`,
      playerId,
      playerName: row["player_name"] ?? "",
      team: row["team"] ?? "",
      position: row["position"] ?? "",
      owner: row["owner"] === "other" ? "other" : "me",
      costType: row["cost_type"] === "dollars" ? "dollars" : "round",
      costValue: Number.isFinite(costValue) ? costValue : 0,
      createdAt: row["created_at"] ?? "",
    };
  },
};

const playerNoteSchema: TableSchema<PlayerNoteRecord> = {
  columns: ["player_id", "player_name", "note", "updated_at"],
  encode: (record) => ({
    player_id: record.playerId,
    player_name: record.playerName,
    note: record.note,
    updated_at: record.updatedAt,
  }),
  decode: (row) => {
    const playerId = requireField(row, "player_id");
    if (!playerId) return null;

    return {
      playerId,
      playerName: row["player_name"] ?? "",
      note: row["note"] ?? "",
      updatedAt: row["updated_at"] ?? "",
    };
  },
};

/**
 * Everything the app persists between sessions.
 *
 * Files live under a single data directory that is bind-mounted from the host
 * when running in a container, so the draft board is an ordinary folder of CSVs
 * the user can open, edit, back up or check into version control.
 */
export class Store {
  readonly dataDir: string;
  readonly draftPicks: CsvTable<DraftPickRecord>;
  readonly playerNotes: CsvTable<PlayerNoteRecord>;
  readonly keepers: CsvTable<KeeperRecord>;
  readonly leagueSettings: LeagueSettingsStore;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    const userDir = path.join(dataDir, "user");
    const backupDir = path.join(userDir, "backups");

    this.leagueSettings = new LeagueSettingsStore(path.join(userDir, "league-settings.json"));

    this.draftPicks = new CsvTable(
      path.join(userDir, "draft_picks.csv"),
      draftPickSchema,
      backupDir,
    );
    this.playerNotes = new CsvTable(
      path.join(userDir, "player_notes.csv"),
      playerNoteSchema,
      backupDir,
    );
    this.keepers = new CsvTable(path.join(userDir, "keepers.csv"), keeperSchema, backupDir);
  }

  /** Force everything to re-read from disk (after an external edit). */
  invalidate(): void {
    this.draftPicks.invalidate();
    this.playerNotes.invalidate();
    this.keepers.invalidate();
    this.leagueSettings.invalidate();
  }
}

/**
 * Resolve the data directory.
 *
 * `DATA_DIR` wins when set. Otherwise `defaultDir` is used, which callers
 * should anchor to a fixed location rather than leaving to the process working
 * directory: package scripts run with the cwd set to their own package, so a
 * cwd-relative default silently produces a *different* draft board depending on
 * which command started the server.
 */
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  defaultDir = "data",
): string {
  return path.resolve(env["DATA_DIR"] ?? defaultDir);
}

export function createStore(
  env: NodeJS.ProcessEnv = process.env,
  defaultDir = "data",
): Store {
  return new Store(resolveDataDir(env, defaultDir));
}
