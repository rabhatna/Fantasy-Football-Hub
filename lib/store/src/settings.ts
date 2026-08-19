import { readFileOrNull, writeFileAtomic } from "./atomic.ts";

/** Roster spots the league starts (plus bench). Zero is a valid count. */
export interface RosterSettings {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  K: number;
  DST: number;
  BENCH: number;
}

export type ScoringFormat = "ppr" | "half_ppr" | "standard";
export type DraftType = "snake" | "auction";

export interface LeagueSettingsRecord {
  teamCount: number;
  scoring: ScoringFormat;
  draftType: DraftType;
  /** The user's draft position, 1..teamCount. */
  draftSlot: number;
  auctionBudget: number;
  /**
   * Rounds the user does not own a pick in (traded away). These disappear
   * from the remaining-picks math the same way keeper-consumed rounds do.
   */
  missingRounds: number[];
  roster: RosterSettings;
}

export const DEFAULT_LEAGUE_SETTINGS: LeagueSettingsRecord = {
  teamCount: 12,
  scoring: "ppr",
  draftType: "snake",
  draftSlot: 6,
  auctionBudget: 200,
  missingRounds: [],
  roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
};

const SCORING_FORMATS: ScoringFormat[] = ["ppr", "half_ppr", "standard"];
const DRAFT_TYPES: DraftType[] = ["snake", "auction"];

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function spotCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Coerce whatever is on disk into a complete settings record.
 *
 * The file is meant to be hand-editable, so a missing or mangled field falls
 * back to its default rather than taking the whole document down. A draft slot
 * outside the team count is clamped, not rejected — on read there is nobody to
 * show an error to.
 */
export function sanitizeLeagueSettings(raw: unknown): LeagueSettingsRecord {
  const defaults = DEFAULT_LEAGUE_SETTINGS;
  if (typeof raw !== "object" || raw === null) return structuredClone(defaults);
  const record = raw as Record<string, unknown>;
  const rosterRaw = (
    typeof record["roster"] === "object" && record["roster"] !== null ? record["roster"] : {}
  ) as Record<string, unknown>;

  const teamCount = positiveInt(record["teamCount"], defaults.teamCount);
  const scoring = SCORING_FORMATS.includes(record["scoring"] as ScoringFormat)
    ? (record["scoring"] as ScoringFormat)
    : defaults.scoring;
  const draftType = DRAFT_TYPES.includes(record["draftType"] as DraftType)
    ? (record["draftType"] as DraftType)
    : defaults.draftType;

  const roster: RosterSettings = {
    QB: spotCount(rosterRaw["QB"], defaults.roster.QB),
    RB: spotCount(rosterRaw["RB"], defaults.roster.RB),
    WR: spotCount(rosterRaw["WR"], defaults.roster.WR),
    TE: spotCount(rosterRaw["TE"], defaults.roster.TE),
    FLEX: spotCount(rosterRaw["FLEX"], defaults.roster.FLEX),
    K: spotCount(rosterRaw["K"], defaults.roster.K),
    DST: spotCount(rosterRaw["DST"], defaults.roster.DST),
    BENCH: spotCount(rosterRaw["BENCH"], defaults.roster.BENCH),
  };

  const missingRounds = Array.isArray(record["missingRounds"])
    ? [
        ...new Set(
          record["missingRounds"].filter(
            (value): value is number =>
              typeof value === "number" && Number.isInteger(value) && value > 0,
          ),
        ),
      ].sort((a, b) => a - b)
    : [];

  return {
    teamCount,
    scoring,
    draftType,
    draftSlot: Math.min(positiveInt(record["draftSlot"], defaults.draftSlot), teamCount),
    auctionBudget: positiveInt(record["auctionBudget"], defaults.auctionBudget),
    missingRounds,
    roster,
  };
}

/**
 * League settings as a single JSON document.
 *
 * Unlike picks and notes this is one nested record, not rows, so it lives in a
 * JSON file rather than a CsvTable — but with the same discipline: atomic
 * writes, serialized mutations, and a cache invalidated on external edits.
 * A missing file simply means the defaults.
 */
export class LeagueSettingsStore {
  private readonly filePath: string;
  private cache: Promise<LeagueSettingsRecord> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  read(): Promise<LeagueSettingsRecord> {
    this.cache ??= this.load();
    return this.cache;
  }

  private async load(): Promise<LeagueSettingsRecord> {
    const contents = await readFileOrNull(this.filePath);
    if (contents === null) return structuredClone(DEFAULT_LEAGUE_SETTINGS);
    try {
      return sanitizeLeagueSettings(JSON.parse(contents));
    } catch {
      // A hand-edit that breaks the JSON should not brick the app; the write
      // path will lay down a well-formed file again.
      return structuredClone(DEFAULT_LEAGUE_SETTINGS);
    }
  }

  write(settings: LeagueSettingsRecord): Promise<LeagueSettingsRecord> {
    const task = this.queue.then(async () => {
      const clean = sanitizeLeagueSettings(settings);
      await writeFileAtomic(this.filePath, `${JSON.stringify(clean, null, 2)}\n`);
      this.cache = Promise.resolve(clean);
      return clean;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  /** Drop the cache so the next read comes from disk (after an external edit). */
  invalidate(): void {
    this.cache = null;
  }
}
