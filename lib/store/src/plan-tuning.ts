import { readFileOrNull, writeFileAtomic } from "./atomic.ts";

export type PlanRiskSetting = "safe" | "balanced" | "upside";

/**
 * The draft-plan engine's saved strategy: every knob in the Plan Room.
 * Persisted so a tuned engine stays tuned between sessions — the plan the
 * sheet prints tomorrow is the plan the user dialed in today.
 */
export interface PlanTuningRecord {
  risk: PlanRiskSetting;
  /** Picks of reach before a price stops fitting the pick, 6-72. */
  reach: number;
  /** Options per slot, primary included, 2-10. */
  options: number;
  biasQB: number;
  biasRB: number;
  biasWR: number;
  biasTE: number;
  /** Do not propose a QB before this round; 1 = no gate. */
  qbFrom: number;
  teFrom: number;
  /** Rookie appetite, 0.5-1.5 score multiplier. */
  rookies: number;
  /** Weight of the sleeper engine's reads, 0-2; 0 silences them. */
  sleepers: number;
}

export const DEFAULT_PLAN_TUNING: PlanTuningRecord = {
  risk: "balanced",
  reach: 24,
  options: 4,
  biasQB: 1,
  biasRB: 1,
  biasWR: 1,
  biasTE: 1,
  qbFrom: 1,
  teFrom: 1,
  rookies: 1,
  sleepers: 1,
};

const RISKS: PlanRiskSetting[] = ["safe", "balanced", "upside"];

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** Coerce whatever is on disk into a complete record; the file is hand-editable. */
export function sanitizePlanTuning(raw: unknown): PlanTuningRecord {
  const defaults = DEFAULT_PLAN_TUNING;
  if (typeof raw !== "object" || raw === null) return { ...defaults };
  const record = raw as Record<string, unknown>;

  return {
    risk: RISKS.includes(record["risk"] as PlanRiskSetting)
      ? (record["risk"] as PlanRiskSetting)
      : defaults.risk,
    reach: bounded(record["reach"], 6, 72, defaults.reach),
    options: Math.round(bounded(record["options"], 2, 10, defaults.options)),
    biasQB: bounded(record["biasQB"], 0.5, 1.5, defaults.biasQB),
    biasRB: bounded(record["biasRB"], 0.5, 1.5, defaults.biasRB),
    biasWR: bounded(record["biasWR"], 0.5, 1.5, defaults.biasWR),
    biasTE: bounded(record["biasTE"], 0.5, 1.5, defaults.biasTE),
    qbFrom: Math.round(bounded(record["qbFrom"], 1, 20, defaults.qbFrom)),
    teFrom: Math.round(bounded(record["teFrom"], 1, 20, defaults.teFrom)),
    rookies: bounded(record["rookies"], 0.5, 1.5, defaults.rookies),
    sleepers: bounded(record["sleepers"], 0, 2, defaults.sleepers),
  };
}

/**
 * One JSON document, same discipline as league settings: atomic writes,
 * serialized mutations, cache invalidated on external edits, and a missing
 * or mangled file meaning the defaults rather than an error.
 */
export class PlanTuningStore {
  private readonly filePath: string;
  private cache: Promise<PlanTuningRecord> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  read(): Promise<PlanTuningRecord> {
    this.cache ??= this.load();
    return this.cache;
  }

  private async load(): Promise<PlanTuningRecord> {
    const contents = await readFileOrNull(this.filePath);
    if (contents === null) return { ...DEFAULT_PLAN_TUNING };
    try {
      return sanitizePlanTuning(JSON.parse(contents));
    } catch {
      return { ...DEFAULT_PLAN_TUNING };
    }
  }

  write(tuning: PlanTuningRecord): Promise<PlanTuningRecord> {
    const task = this.queue.then(async () => {
      const clean = sanitizePlanTuning(tuning);
      await writeFileAtomic(this.filePath, `${JSON.stringify(clean, null, 2)}\n`);
      this.cache = Promise.resolve(clean);
      return clean;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  invalidate(): void {
    this.cache = null;
  }
}
