import path from "node:path";
import { Router, type IRouter } from "express";
import {
  createStore,
  resolveDataDir,
  type DraftPickRecord,
  type RosterSettings,
} from "@workspace/store";
import {
  loadSnapshot,
  normalizeName,
  type DatasetPlayer,
  type DatasetTeam,
  type Snapshot,
} from "@workspace/dataset";
import {
  DeleteDraftPickParams,
  GetDraftPicksResponse,
  GetDraftSummaryResponse,
  GetLiveStatusResponse,
  GetNewsResponse,
  GetNotesResponse,
  GetOLImpactResponse,
  GetPlayerParams,
  GetPlayerResponse,
  GetPlayersQueryParams,
  GetPlayersResponse,
  GetSettingsResponse,
  GetTeamsResponse,
  RefreshDataResponse,
  SaveDraftPickBody,
  SaveDraftPickResponse,
  SavePlayerNoteBody,
  SavePlayerNoteParams,
  SavePlayerNoteResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@workspace/api-zod";
import {
  consensusAdp,
  injuriesByPlayer,
  marketByPlayer,
  newsItems,
  readLiveCache,
  readLiveStatus,
  readMarketCache,
  readMarketStatus,
  refreshLive,
  refreshMarket,
  type LiveCache,
  type LiveStatus,
  type MarketCache,
  type PlayerInjury,
} from "@workspace/live";
import { VALUE_TARGET_SD, isUnavailableStatus } from "@workspace/shared";
import { logger } from "../lib/logger";
import { consensusValueScores } from "../lib/value";

// Draft picks and notes persist as CSV under the data directory; the player
// board is read from a dated snapshot in the same place.
//
// Anchored to the repository root rather than the working directory. pnpm runs
// package scripts with the cwd set to the package, so `pnpm start` (root) and
// `pnpm dev` (artifacts/api-server) would otherwise read and write two
// different draft boards. The bundle lives at artifacts/api-server/dist.
const defaultDataDir = path.resolve(import.meta.dirname, "..", "..", "..", "data");
const store = createStore(process.env, defaultDataDir);
const dataDir = resolveDataDir(process.env, defaultDataDir);

let snapshotPromise: Promise<Snapshot> | null = null;
let loadedAt = new Date().toISOString();

// The live and market caches are read from disk, never fetched implicitly: a
// page load must not cause an outbound request. Only POST /data/refresh fetches.
let livePromise: Promise<LiveCache | null> | null = null;
let marketPromise: Promise<MarketCache | null> | null = null;

function live(): Promise<LiveCache | null> {
  const pending = (livePromise ??= readLiveCache(dataDir));
  return pending;
}

function market(): Promise<MarketCache | null> {
  const pending = (marketPromise ??= readMarketCache(dataDir));
  return pending;
}

/** A dataset player with everything merged in at request time. */
type ApiPlayer = DatasetPlayer & {
  injuryBodyPart: string | null;
  adpConsensus: number | null;
  adpConsensusStdev: number | null;
  adpSources: { source: string; adp: number }[];
  valueScoreConsensus: number | null;
};

/**
 * Merge live availability, cached market data and the league's scoring format
 * onto the ranked players.
 *
 * A player the injury source has no record of keeps a null status. Null means
 * unknown — it is never rendered or treated as "healthy". Points per game is
 * served in the scoring the league settings ask for; the dataset's primary
 * scoring (and the consistency profile) remains full PPR.
 *
 * Consensus ADP averages the market sources with the dataset's own ADP, but
 * only exists once at least one market source has matched — before the first
 * refresh, `adp` remains the only price and consensus fields are null.
 */
async function enrichedPlayers(): Promise<ApiPlayer[]> {
  const [{ players }, cache, marketCache, settings] = await Promise.all([
    snapshot(),
    live(),
    market(),
    store.leagueSettings.read(),
  ]);
  const injuries = cache ? injuriesByPlayer(cache, players) : new Map<string, PlayerInjury>();
  const marketData = marketByPlayer(marketCache, players);

  const enriched: ApiPlayer[] = players.map((player) => {
    const injury = injuries.get(player.id);
    const playerMarket = marketData.get(player.id);
    const ppg =
      settings.scoring === "half_ppr"
        ? player.ppgByScoring.halfPpr
        : settings.scoring === "standard"
          ? player.ppgByScoring.standard
          : player.ppg;

    const marketAdps = playerMarket?.adpSources ?? [];
    const adpSources = [
      { source: player.adpSource ?? "dataset", adp: player.adp },
      ...marketAdps.map((entry) => ({ source: entry.source, adp: entry.adp })),
    ];
    const consensus =
      marketAdps.length > 0
        ? consensusAdp(adpSources.map((entry) => entry.adp))
        : { mean: null, stdev: null };

    return {
      ...player,
      ppg,
      injuryStatus: injury?.status ?? player.injuryStatus,
      injuryBodyPart: injury?.bodyPart ?? null,
      adpConsensus: consensus.mean === null ? null : Number(consensus.mean.toFixed(1)),
      adpConsensusStdev: consensus.stdev === null ? null : Number(consensus.stdev.toFixed(1)),
      adpSources,
      valueScoreConsensus: null,
    };
  });

  const valueScores = consensusValueScores(enriched);
  for (const player of enriched) {
    player.valueScoreConsensus = valueScores.get(player.id) ?? null;
  }
  return enriched;
}

function snapshot(): Promise<Snapshot> {
  if (snapshotPromise === null) {
    snapshotPromise = loadSnapshot(dataDir).then((loaded) => {
      loadedAt = new Date().toISOString();
      logger.info(
        { version: loaded.version, players: loaded.players.length, skipped: loaded.skipped.length },
        "Loaded dataset snapshot",
      );
      for (const skip of loaded.skipped) {
        logger.warn({ rank: skip.rank, reason: skip.reason }, "Skipped dataset row");
      }
      return loaded;
    });
  }
  return snapshotPromise;
}

// ── Draft pick reconciliation ────────────────────────────────────────────────

/**
 * Match a saved pick to a player in the current snapshot.
 *
 * Picks saved before this dataset landed used ids derived from the player's
 * name; ids are now nflverse gsis_ids, so those saved ids match nothing. Each
 * pick also stores the player's name (written for exactly this reason), so a
 * board built against the old ids can be recovered by name.
 */
function findPlayerForPick(pick: DraftPickRecord, players: DatasetPlayer[]): DatasetPlayer | undefined {
  const byId = players.find((player) => player.id === pick.playerId);
  if (byId) return byId;

  if (!pick.playerName) return undefined;
  const target = normalizeName(pick.playerName);
  return players.find((player) => normalizeName(player.name) === target);
}

/**
 * Re-key any saved picks whose player id no longer resolves but whose name
 * does, writing the healed ids back to disk once.
 */
async function reconcilePicks(players: DatasetPlayer[]): Promise<DraftPickRecord[]> {
  const picks = await store.draftPicks.all();
  const needsHealing = picks.filter(
    (pick) => !players.some((player) => player.id === pick.playerId),
  );
  if (needsHealing.length === 0) return picks;

  const healed = new Map<string, DatasetPlayer>();
  for (const pick of needsHealing) {
    const match = findPlayerForPick(pick, players);
    if (match) healed.set(pick.playerId, match);
  }
  if (healed.size === 0) return picks;

  logger.info({ count: healed.size }, "Re-linked saved draft picks to current dataset ids");

  return store.draftPicks.update((records) => {
    const next = records.map((record) => {
      const match = healed.get(record.playerId);
      if (!match) return record;
      return {
        ...record,
        id: `pick-${match.id}`,
        playerId: match.id,
        playerName: match.name,
        team: match.team,
        position: match.position,
      };
    });
    return { next, result: next };
  });
}

// ── Positional needs ─────────────────────────────────────────────────────────

/**
 * Starting spots still to fill, from the league's roster settings.
 *
 * FLEX is consumed only by RB/WR/TE drafted beyond their base spots: a third
 * WR in a 2-WR league fills the flex, not a phantom WR3 slot. K and DST are
 * not tracked on the board, so they carry no need here.
 */
function positionalNeeds(roster: RosterSettings, drafted: DatasetPlayer[]) {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const player of drafted) {
    if (player.position in counts) counts[player.position as keyof typeof counts] += 1;
  }

  const flexUsed = (["RB", "WR", "TE"] as const).reduce(
    (used, position) => used + Math.max(0, counts[position] - roster[position]),
    0,
  );

  return {
    QB: Math.max(0, roster.QB - counts.QB),
    RB: Math.max(0, roster.RB - counts.RB),
    WR: Math.max(0, roster.WR - counts.WR),
    TE: Math.max(0, roster.TE - counts.TE),
    FLEX: Math.max(0, roster.FLEX - flexUsed),
  };
}

// ── Offensive line impact ────────────────────────────────────────────────────

function impactLabel(valueScore: number | null, olScore: number | null): string {
  if (valueScore === null || olScore === null) return "Unrated";
  const goodValue = valueScore >= VALUE_TARGET_SD;
  const goodLine = olScore >= 60;
  if (goodValue && goodLine) return "Favorable";
  if (!goodValue && goodLine) return "Buy Low";
  if (goodValue && !goodLine) return "Landmine";
  return "Avoid";
}

function describeImpact(player: DatasetPlayer, team: DatasetTeam, label: string): string {
  const line =
    team.compositeScore === null
      ? `${team.fullName}'s line is unrated in this snapshot`
      : `${team.fullName} grades ${team.compositeScore.toFixed(0)}/100 up front (${team.tier.toLowerCase()})`;

  const blocking =
    team.runBlockGrade === null
      ? "run blocking is unrated"
      : `run blocking grades ${team.runBlockGrade.toFixed(0)}`;

  const continuity =
    team.snapContinuity === null
      ? "continuity is unknown"
      : `${team.snapContinuity.toFixed(0)}% of last year's line snaps return`;

  const market =
    player.valueScore === null
      ? "He has no 2025 production to price against"
      : player.valueScore >= 0
        ? `He produced ${player.valueScore.toFixed(1)} SD better than his cost implies`
        : `The market is charging ${Math.abs(player.valueScore).toFixed(1)} SD more than his production`;

  const verdict =
    label === "Favorable"
      ? "Both the line and the price point the same direction."
      : label === "Buy Low"
        ? "The blocking is there even if the production has not been."
        : label === "Landmine"
          ? "The production is real, but the line in front of him is not."
          : label === "Avoid"
            ? "Neither the blocking nor the price is working in his favour."
            : "Not enough data to grade this pairing.";

  return `${line}: ${blocking}, and ${continuity}. ${market}. ${verdict}`;
}

// ── Routes ───────────────────────────────────────────────────────────────────

const router: IRouter = Router();

router.get("/players", async (req, res, next) => {
  try {
    const parsed = GetPlayersQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid player filters" });
      return;
    }

    const { position, search, maxAdp, minShare, excludeUnhealthy } = parsed.data;
    const players = await enrichedPlayers();
    const normalizedSearch = search?.trim().toLowerCase();

    const filtered = players.filter((player) => {
      if (position && position !== "ALL" && player.position !== position) return false;
      if (
        normalizedSearch &&
        !`${player.name} ${player.team}`.toLowerCase().includes(normalizedSearch)
      ) {
        return false;
      }
      if (typeof maxAdp === "number" && player.adp > maxAdp) return false;
      // A player with no recorded share has not been shown to fail the filter,
      // so an unknown share is not grounds for hiding him.
      if (typeof minShare === "number" && player.share !== null && player.share < minShare) {
        return false;
      }
      // A player with no known status is not filtered out: unknown is not the
      // same as unavailable, and hiding him would be a claim we cannot support.
      if (excludeUnhealthy && player.injuryStatus !== null) {
        return !isUnavailableStatus(player.injuryStatus);
      }
      return true;
    });

    res.json(GetPlayersResponse.parse(filtered));
  } catch (error) {
    next(error);
  }
});

router.get("/players/:id", async (req, res, next) => {
  try {
    const params = GetPlayerParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid player id" });
      return;
    }

    const players = await enrichedPlayers();
    const player = players.find((item) => item.id === params.data.id);
    if (!player) {
      res.status(404).json({ error: "Player not found" });
      return;
    }

    res.json(GetPlayerResponse.parse(player));
  } catch (error) {
    next(error);
  }
});

router.get("/teams", async (_req, res, next) => {
  try {
    const { teams } = await snapshot();
    res.json(GetTeamsResponse.parse(teams));
  } catch (error) {
    next(error);
  }
});

router.get("/news", async (_req, res, next) => {
  try {
    const [{ players }, cache] = await Promise.all([snapshot(), live()]);
    // Empty until the user runs a refresh. Reading this endpoint never
    // triggers a fetch, so opening the app makes no outbound request.
    const injuries = injuriesByPlayer(cache, players);
    res.json(GetNewsResponse.parse(newsItems(cache, players, injuries)));
  } catch (error) {
    next(error);
  }
});

/**
 * One combined view of the news/injury feeds and the market sources: stale if
 * either side is, fetchedAt is the older of the two so cached data is never
 * presented as fresher than its oldest part.
 */
function mergeStatuses(liveStatus: LiveStatus, marketStatus: LiveStatus): LiveStatus {
  const fetchTimes = [liveStatus.fetchedAt, marketStatus.fetchedAt].filter(
    (value): value is string => value !== null,
  );
  const attemptTimes = [liveStatus.attemptedAt, marketStatus.attemptedAt].filter(
    (value): value is string => value !== null,
  );
  return {
    fetchedAt: fetchTimes.length > 0 ? fetchTimes.sort()[0] : null,
    attemptedAt: attemptTimes.length > 0 ? attemptTimes.sort().at(-1)! : null,
    stale: liveStatus.stale || marketStatus.stale,
    sources: [...liveStatus.sources, ...marketStatus.sources],
  };
}

router.get("/live/status", async (_req, res, next) => {
  try {
    const [liveStatus, marketStatus] = await Promise.all([
      readLiveStatus(dataDir),
      readMarketStatus(dataDir),
    ]);
    res.json(GetLiveStatusResponse.parse(mergeStatuses(liveStatus, marketStatus)));
  } catch (error) {
    next(error);
  }
});

router.get("/draft/summary", async (_req, res, next) => {
  try {
    const { players, version } = await snapshot();
    const [picks, settings] = await Promise.all([
      reconcilePicks(players),
      store.leagueSettings.read(),
    ]);

    const draftedPlayers = players.filter((player) =>
      picks.some((pick) => pick.playerId === player.id),
    );

    const needs = positionalNeeds(settings.roster, draftedPlayers);

    // Averaged over picks that resolve to a player in this snapshot; a pick
    // carried over from an older dataset has no ADP to average.
    const adps = draftedPlayers.map((player) => player.adp);
    const averageAdp =
      adps.length > 0
        ? Number((adps.reduce((total, adp) => total + adp, 0) / adps.length).toFixed(1))
        : 0;

    res.json(
      GetDraftSummaryResponse.parse({
        playersTracked: players.length,
        draftedCount: picks.length,
        averageAdp,
        valueTargets: players.filter((player) => (player.valueScore ?? -Infinity) >= VALUE_TARGET_SD)
          .length,
        positionalNeeds: needs,
        lastRefresh: loadedAt,
        snapshotVersion: version,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/draft/picks", async (_req, res, next) => {
  try {
    const { players } = await snapshot();
    res.json(GetDraftPicksResponse.parse(await reconcilePicks(players)));
  } catch (error) {
    next(error);
  }
});

router.post("/draft/picks", async (req, res, next) => {
  try {
    const body = SaveDraftPickBody.safeParse(req.body);
    const { players } = await snapshot();
    const player = body.success
      ? players.find((candidate) => candidate.id === body.data.playerId)
      : undefined;

    if (!body.success || !player) {
      res.status(400).json({ error: "Invalid draft pick" });
      return;
    }

    const existing = await store.draftPicks.all();
    const alreadyDrafted = existing.find((pick) => pick.playerId === player.id);

    // Drafting the same player twice is a double-submit, not an error worth
    // surfacing — return the pick that already exists.
    if (alreadyDrafted) {
      res.status(200).json(SaveDraftPickResponse.parse(alreadyDrafted));
      return;
    }

    // Name, team and position ride along with the id so a board stays readable
    // in a spreadsheet and can be re-linked if the dataset is replaced.
    const pick = {
      id: `pick-${player.id}`,
      playerId: player.id,
      playerName: player.name,
      team: player.team,
      position: player.position,
      pickNumber: body.data.pickNumber,
      draftedAt: new Date().toISOString(),
    };

    await store.draftPicks.append(pick);
    res.status(201).json(SaveDraftPickResponse.parse(pick));
  } catch (error) {
    next(error);
  }
});

router.delete("/draft/picks/:playerId", async (req, res, next) => {
  try {
    const params = DeleteDraftPickParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid player id" });
      return;
    }

    const removed = await store.draftPicks.remove(
      (pick) => pick.playerId === params.data.playerId,
    );

    if (removed === 0) {
      res.status(404).json({ error: "No pick found for that player" });
      return;
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/notes", async (_req, res, next) => {
  try {
    res.json(GetNotesResponse.parse(await store.playerNotes.all()));
  } catch (error) {
    next(error);
  }
});

router.put("/notes/:playerId", async (req, res, next) => {
  try {
    const params = SavePlayerNoteParams.safeParse(req.params);
    const body = SavePlayerNoteBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid note" });
      return;
    }

    const { players } = await snapshot();
    const player = players.find((candidate) => candidate.id === params.data.playerId);
    if (!player) {
      res.status(404).json({ error: "Player not found" });
      return;
    }

    const note = {
      playerId: player.id,
      playerName: player.name,
      note: body.data.note,
      updatedAt: new Date().toISOString(),
    };

    // An empty note means "clear it" — keeping blank rows would just litter
    // the CSV the user opens in a spreadsheet.
    if (note.note.trim() === "") {
      await store.playerNotes.remove((existing) => existing.playerId === player.id);
    } else {
      await store.playerNotes.upsert(note, (existing) => existing.playerId === player.id);
    }

    res.json(SavePlayerNoteResponse.parse(note));
  } catch (error) {
    next(error);
  }
});

router.get("/settings", async (_req, res, next) => {
  try {
    res.json(GetSettingsResponse.parse(await store.leagueSettings.read()));
  } catch (error) {
    next(error);
  }
});

router.put("/settings", async (req, res, next) => {
  try {
    const body = UpdateSettingsBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid league settings" });
      return;
    }
    // Cross-field rule the schema cannot express: the user must actually have
    // a slot in the draft order they configured.
    if (body.data.draftSlot > body.data.teamCount) {
      res.status(400).json({ error: "Draft slot is beyond the last team" });
      return;
    }

    const saved = await store.leagueSettings.write(body.data);
    res.json(UpdateSettingsResponse.parse(saved));
  } catch (error) {
    next(error);
  }
});

router.get("/ol-impact", async (_req, res, next) => {
  try {
    const { players, teams } = await snapshot();
    const teamsByCode = new Map(teams.map((team) => [team.team, team]));

    const teamScores = teams.map((team) => ({
      team: team.team,
      fullName: team.fullName,
      compositeScore: team.compositeScore,
      aly: team.aly,
      stuffRate: team.stuffRate,
      passBlockGrade: team.passBlockGrade,
      snapContinuity: team.snapContinuity,
      trend: team.trend,
      tier: team.tier,
    }));

    const rbImpacts = players
      .filter((player) => player.position === "RB")
      .map((player) => {
        const team = teamsByCode.get(player.team);
        const olCompositeScore = team?.compositeScore ?? null;
        const label = impactLabel(player.valueScore, olCompositeScore);

        return {
          playerId: player.id,
          playerName: player.name,
          team: player.team,
          rank: player.rank,
          valueScore: player.valueScore,
          ppg: player.ppg,
          olCompositeScore,
          olTier: team?.tier ?? "Unrated",
          impactLabel: label,
          blurb: team
            ? describeImpact(player, team, label)
            : `No 2026 team context available for ${player.name}.`,
        };
      });

    res.json(GetOLImpactResponse.parse({ teamScores, rbImpacts }));
  } catch (error) {
    next(error);
  }
});

router.post("/data/refresh", async (_req, res, next) => {
  try {
    // Drop cached rows so a newly added snapshot, or an edit made directly in
    // Excel, is picked up without restarting the server.
    store.invalidate();
    snapshotPromise = null;
    livePromise = null;
    marketPromise = null;

    const { version, players, teams } = await snapshot();
    const settings = await store.leagueSettings.read();

    // The only outbound network calls in the app, and only from here.
    const [{ status }, { status: marketStatus }] = await Promise.all([
      refreshLive(dataDir),
      refreshMarket(dataDir, { teams: settings.teamCount }),
    ]);
    livePromise = null;
    marketPromise = null;

    const merged = mergeStatuses(status, marketStatus);

    res.json(
      RefreshDataResponse.parse({
        // "partial" when some feed failed: the caller should not treat a
        // degraded refresh as a clean one.
        status: merged.stale ? "partial" : "ok",
        refreshedAt: merged.attemptedAt ?? loadedAt,
        live: merged,
        sources: [
          { name: `dataset snapshot ${version}`, ok: true, detail: `${players.length} players` },
          { name: "team context", ok: true, detail: `${teams.length} teams` },
          { name: "draft board", ok: true, detail: "reloaded from disk" },
          ...merged.sources,
        ],
      }),
    );
  } catch (error) {
    next(error);
  }
});

export default router;
