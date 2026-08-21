import path from "node:path";
import { Router, type IRouter } from "express";
import {
  createStore,
  parseCsv,
  resolveDataDir,
  type DraftPickRecord,
  type KeeperRecord,
  type LeagueSettingsRecord,
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
  DeleteKeeperParams,
  DeleteTargetParams,
  GetDraftPicksResponse,
  GetDraftPlanQueryParams,
  GetDraftPlanResponse,
  GetKeepersResponse,
  GetDraftSummaryResponse,
  GetLiveStatusResponse,
  GetNewsResponse,
  GetNotesResponse,
  GetOLImpactResponse,
  GetPlayerParams,
  GetPlayerResponse,
  GetPlayersQueryParams,
  GetPlayersResponse,
  GetRecommendationsResponse,
  GetSettingsResponse,
  GetSleepersResponse,
  GetTargetsResponse,
  GetTeamLineParams,
  GetTeamLineResponse,
  GetTeamsResponse,
  ImportKeepersBody,
  ImportKeepersResponse,
  RefreshDataResponse,
  SaveDraftPickBody,
  SaveDraftPickResponse,
  SaveKeeperBody,
  SaveKeeperResponse,
  SaveTargetBody,
  SaveTargetParams,
  SaveTargetResponse,
  SavePlayerNoteBody,
  SavePlayerNoteParams,
  SavePlayerNoteResponse,
  UpdateKeeperBody,
  UpdateKeeperParams,
  UpdateKeeperResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@workspace/api-zod";
import {
  consensusAdp,
  depthByPlayer,
  injuriesByPlayer,
  marketByPlayer,
  newsItems,
  offensiveLine,
  playersMentioned,
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
import { remainingPicks } from "../lib/draft-math";
import { buildDraftPlan, type PlanRisk } from "../lib/draft-plan";
import { positionalNeeds, recommend } from "../lib/recommend";
import { findSleepers } from "../lib/sleepers";
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
  ecrRank: number | null;
  ecrDelta: number | null;
  depthRank: number | null;
  projectedPoints: number | null;
  aav: number | null;
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
  const depthRanks = depthByPlayer(cache, players);

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

    // Projections arrive in all three scoring formats; serve the league's.
    const projection = playerMarket?.projection ?? null;
    const projectedPoints =
      projection === null
        ? null
        : settings.scoring === "half_ppr"
          ? projection.halfPpr
          : settings.scoring === "standard"
            ? projection.standard
            : projection.ppr;

    return {
      ...player,
      ppg,
      injuryStatus: injury?.status ?? player.injuryStatus,
      injuryBodyPart: injury?.bodyPart ?? null,
      adpConsensus: consensus.mean === null ? null : Number(consensus.mean.toFixed(1)),
      adpConsensusStdev: consensus.stdev === null ? null : Number(consensus.stdev.toFixed(1)),
      adpSources,
      valueScoreConsensus: null,
      ecrRank: playerMarket?.ecrRank ?? null,
      ecrDelta: playerMarket?.ecrDelta ?? null,
      depthRank: depthRanks.get(player.id) ?? null,
      projectedPoints: projectedPoints === null ? null : Number(projectedPoints.toFixed(1)),
      aav: playerMarket?.aav ?? null,
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
function findPlayerForPick(
  pick: { playerId: string; playerName: string },
  players: DatasetPlayer[],
): DatasetPlayer | undefined {
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

/** Keepers heal the same way picks do: by name, when their id stops resolving. */
async function reconcileKeepers(players: DatasetPlayer[]): Promise<KeeperRecord[]> {
  const keepers = await store.keepers.all();
  const needsHealing = keepers.filter(
    (keeper) => !players.some((player) => player.id === keeper.playerId),
  );
  if (needsHealing.length === 0) return keepers;

  const healed = new Map<string, DatasetPlayer>();
  for (const keeper of needsHealing) {
    const match = findPlayerForPick(keeper, players);
    if (match) healed.set(keeper.playerId, match);
  }
  if (healed.size === 0) return keepers;

  logger.info({ count: healed.size }, "Re-linked saved keepers to current dataset ids");

  return store.keepers.update((records) => {
    const next = records.map((record) => {
      const match = healed.get(record.playerId);
      if (!match) return record;
      return {
        ...record,
        id: `keeper-${match.id}`,
        playerId: match.id,
        playerName: match.name,
        team: match.team,
        position: match.position,
      };
    });
    return { next, result: next };
  });
}

/**
 * The user's picks still to come. Total rounds = every roster spot; the
 * rounds their round-cost keepers consume are gone before pick one.
 */
function myRemainingPicks(
  settings: LeagueSettingsRecord,
  myKeepers: readonly KeeperRecord[],
  picksMade: number,
) {
  const roster = settings.roster;
  const rounds = Object.values(roster).reduce((total, spots) => total + spots, 0);
  return remainingPicks({
    teamCount: settings.teamCount,
    draftSlot: settings.draftSlot,
    rounds,
    keeperRounds: myKeepers
      .filter((keeper) => keeper.costType === "round")
      .map((keeper) => keeper.costValue),
    missingRounds: settings.missingRounds,
    picksMade,
  });
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

router.get("/teams/:team/line", async (req, res, next) => {
  try {
    const params = GetTeamLineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid team" });
      return;
    }

    const [{ teams }, cache] = await Promise.all([snapshot(), live()]);
    const team = teams.find((candidate) => candidate.team === params.data.team.toUpperCase());
    if (!team) {
      res.status(404).json({ error: "Unknown team" });
      return;
    }

    // The most recent cached headline naming each lineman. Linemen are turned
    // into matchable shapes so the same full-name-only rule applies as for
    // board players: no headline is better than the wrong one.
    const line = offensiveLine(cache, team.team);
    const matchable = line.map((man, index) => ({
      id: String(index),
      name: man.name,
      team: team.team,
      position: man.slot,
    }));
    const headlineFor = new Map<string, { title: string; link: string | null }>();
    for (const headline of (cache?.headlines ?? []).slice(0, 60)) {
      for (const mentioned of playersMentioned(headline.title, matchable)) {
        if (!headlineFor.has(mentioned.id)) {
          headlineFor.set(mentioned.id, { title: headline.title, link: headline.link });
        }
      }
    }

    res.json(
      GetTeamLineResponse.parse({
        team: team.team,
        linemen: line.map((man, index) => ({
          ...man,
          headline: headlineFor.get(String(index))?.title ?? null,
          headlineUrl: headlineFor.get(String(index))?.link ?? null,
        })),
      }),
    );
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
    const [picks, keepers, settings] = await Promise.all([
      reconcilePicks(players),
      reconcileKeepers(players),
      store.leagueSettings.read(),
    ]);

    const draftedPlayers = players.filter((player) =>
      picks.some((pick) => pick.playerId === player.id),
    );
    const myKeepers = keepers.filter((keeper) => keeper.owner === "me");

    // Keepers are already on the roster, so they fill needs just like picks.
    const needs = positionalNeeds(settings.roster, [...draftedPlayers, ...myKeepers]);

    const myRoster = [
      ...myKeepers.map((keeper) => ({
        playerId: keeper.playerId,
        playerName: keeper.playerName,
        position: keeper.position,
        source: "keeper" as const,
      })),
      ...picks.map((pick) => ({
        playerId: pick.playerId,
        playerName: pick.playerName,
        position: pick.position,
        source: "pick" as const,
      })),
    ];

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
        remainingPicks: myRemainingPicks(settings, myKeepers, picks.length),
        myRoster,
        lastRefresh: loadedAt,
        snapshotVersion: version,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/draft/recommendations", async (_req, res, next) => {
  try {
    const players = await enrichedPlayers();
    const [picks, keepers, settings] = await Promise.all([
      reconcilePicks(players),
      reconcileKeepers(players),
      store.leagueSettings.read(),
    ]);
    const myKeepers = keepers.filter((keeper) => keeper.owner === "me");

    // My roster's positions and byes, for needs and bye-overlap checks.
    const byId = new Map(players.map((player) => [player.id, player]));
    const myRoster = [...myKeepers, ...picks].map((entry) => ({
      position: entry.position,
      byeWeek: byId.get(entry.playerId)?.byeWeek ?? null,
    }));

    const unavailableIds = new Set([
      ...picks.map((pick) => pick.playerId),
      ...keepers.map((keeper) => keeper.playerId),
    ]);

    const suggestions = recommend({
      players,
      unavailableIds,
      myRoster,
      roster: settings.roster,
      myNextPicks: myRemainingPicks(settings, myKeepers, picks.length).map(
        (slot) => slot.overall,
      ),
    });

    res.json(GetRecommendationsResponse.parse(suggestions));
  } catch (error) {
    next(error);
  }
});

router.get("/draft/plan", async (req, res, next) => {
  try {
    const query = GetDraftPlanQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Invalid plan tuning" });
      return;
    }
    const { risk, reach, options, biasQB, biasRB, biasWR, biasTE, qbFrom, teFrom } = query.data;

    const players = await enrichedPlayers();
    const [picks, keepers, settings] = await Promise.all([
      reconcilePicks(players),
      reconcileKeepers(players),
      store.leagueSettings.read(),
    ]);
    const myKeepers = keepers.filter((keeper) => keeper.owner === "me");

    const slots = buildDraftPlan({
      players,
      unavailableIds: new Set([
        ...picks.map((pick) => pick.playerId),
        ...keepers.map((keeper) => keeper.playerId),
      ]),
      myRoster: [...myKeepers, ...picks].map((entry) => ({ position: entry.position })),
      roster: settings.roster,
      myNextPicks: myRemainingPicks(settings, myKeepers, picks.length),
      tuning: {
        risk: risk as PlanRisk | undefined,
        reachTolerance: reach,
        optionsPerSlot: options,
        positionBias: { QB: biasQB, RB: biasRB, WR: biasWR, TE: biasTE },
        qbFromRound: qbFrom,
        teFromRound: teFrom,
      },
    });

    res.json(GetDraftPlanResponse.parse({ slots }));
  } catch (error) {
    next(error);
  }
});

router.get("/draft/sleepers", async (_req, res, next) => {
  try {
    const players = await enrichedPlayers();
    const [picks, keepers, settings] = await Promise.all([
      reconcilePicks(players),
      reconcileKeepers(players),
      store.leagueSettings.read(),
    ]);

    const sleepers = findSleepers({
      players,
      unavailableIds: new Set([
        ...picks.map((pick) => pick.playerId),
        ...keepers.map((keeper) => keeper.playerId),
      ]),
      teamCount: settings.teamCount,
    });

    res.json(GetSleepersResponse.parse(sleepers));
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

    // When the client does not name a pick number, assign the user's next
    // remaining overall (keeper-consumed rounds are already gone) — the
    // client cannot know that number, so the server's is authoritative.
    let pickNumber = body.data.pickNumber;
    if (pickNumber === undefined) {
      const [keepers, settings] = await Promise.all([
        store.keepers.all(),
        store.leagueSettings.read(),
      ]);
      const myKeepers = keepers.filter((keeper) => keeper.owner === "me");
      const next = myRemainingPicks(settings, myKeepers, existing.length)[0];
      pickNumber =
        next?.overall ?? Math.max(0, ...existing.map((record) => record.pickNumber)) + 1;
    }

    // Name, team and position ride along with the id so a board stays readable
    // in a spreadsheet and can be re-linked if the dataset is replaced.
    const pick = {
      id: `pick-${player.id}`,
      playerId: player.id,
      playerName: player.name,
      team: player.team,
      position: player.position,
      pickNumber,
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

router.get("/keepers", async (_req, res, next) => {
  try {
    const { players } = await snapshot();
    res.json(GetKeepersResponse.parse(await reconcileKeepers(players)));
  } catch (error) {
    next(error);
  }
});

router.post("/keepers", async (req, res, next) => {
  try {
    const body = SaveKeeperBody.safeParse(req.body);
    const { players } = await snapshot();
    const player = body.success
      ? players.find((candidate) => candidate.id === body.data.playerId)
      : undefined;

    if (!body.success || !player) {
      res.status(400).json({ error: "Invalid keeper" });
      return;
    }

    const existing = await store.keepers.all();
    const alreadyKept = existing.find((keeper) => keeper.playerId === player.id);
    // Same double-submit treatment as draft picks: keeping a kept player
    // returns the keeper that already exists.
    if (alreadyKept) {
      res.status(200).json(SaveKeeperResponse.parse(alreadyKept));
      return;
    }

    const keeper = {
      id: `keeper-${player.id}`,
      playerId: player.id,
      playerName: player.name,
      team: player.team,
      position: player.position,
      owner: body.data.owner,
      ownerName: body.data.owner === "me" ? "" : (body.data.ownerName?.trim() ?? ""),
      costType: body.data.costType,
      costValue: body.data.costValue,
      createdAt: new Date().toISOString(),
    };

    await store.keepers.append(keeper);
    res.status(201).json(SaveKeeperResponse.parse(keeper));
  } catch (error) {
    next(error);
  }
});

router.post("/keepers/import", async (req, res, next) => {
  try {
    const body = ImportKeepersBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid import request" });
      return;
    }

    let rows: Record<string, string>[];
    try {
      rows = parseCsv(body.data.csv);
    } catch {
      res.status(400).json({ error: "The sheet could not be parsed as CSV" });
      return;
    }
    if (rows.length === 0 || !("player" in rows[0]) || !("owner" in rows[0])) {
      res.status(400).json({
        error: "The sheet needs a header row with at least player and owner columns",
      });
      return;
    }

    const { players } = await snapshot();
    const byName = new Map<string, DatasetPlayer[]>();
    for (const player of players) {
      const key = normalizeName(player.name);
      const bucket = byName.get(key);
      if (bucket) bucket.push(player);
      else byName.set(key, [player]);
    }

    const existing = body.data.replace ? [] : await store.keepers.all();
    const keptIds = new Set(existing.map((keeper) => keeper.playerId));
    const additions: KeeperRecord[] = [];
    const skipped: { line: number; reason: string }[] = [];
    const now = new Date().toISOString();

    rows.forEach((row, index) => {
      const line = index + 2; // 1-based, after the header row
      const name = row["player"]?.trim();
      if (!name) {
        skipped.push({ line, reason: "no player name" });
        return;
      }

      const candidates = byName.get(normalizeName(name)) ?? [];
      const sheetTeam = row["team"]?.trim().toUpperCase();
      const player =
        candidates.length === 1
          ? candidates[0]
          : candidates.find((candidate) => candidate.team === sheetTeam);
      if (!player) {
        skipped.push({
          line,
          reason:
            candidates.length > 1
              ? `"${name}" matches several ranked players — add his team to the team column`
              : `"${name}" is not in the ranked 250`,
        });
        return;
      }
      if (keptIds.has(player.id)) {
        skipped.push({ line, reason: `${player.name} is already kept` });
        return;
      }

      const ownerRaw = row["owner"]?.trim() ?? "";
      const isMine = ["me", "mine", "myself", "my team"].includes(ownerRaw.toLowerCase());
      const dollars = row["dollars"]?.trim();
      const round = row["round"]?.trim();
      const costType = dollars ? ("dollars" as const) : ("round" as const);
      const costValue = Number(dollars || round);
      if (!Number.isFinite(costValue) || costValue < (costType === "round" ? 1 : 0)) {
        skipped.push({ line, reason: `${player.name} has no usable round or dollars value` });
        return;
      }

      keptIds.add(player.id);
      additions.push({
        id: `keeper-${player.id}`,
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        position: player.position,
        owner: isMine ? "me" : "other",
        ownerName: isMine ? "" : ownerRaw,
        costType,
        costValue,
        createdAt: now,
      });
    });

    const keepers = await store.keepers.update((records) => {
      const base = body.data.replace ? [] : records;
      const next = [...base, ...additions];
      return { next, result: next };
    });

    logger.info(
      { imported: additions.length, skipped: skipped.length, replace: body.data.replace ?? false },
      "Imported keepers from sheet",
    );
    res.json(ImportKeepersResponse.parse({ imported: additions.length, skipped, keepers }));
  } catch (error) {
    next(error);
  }
});

router.patch("/keepers/:id", async (req, res, next) => {
  try {
    const params = UpdateKeeperParams.safeParse(req.params);
    const body = UpdateKeeperBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid keeper update" });
      return;
    }

    type Outcome =
      | { kind: "missing" }
      | { kind: "invalid" }
      | { kind: "ok"; keeper: KeeperRecord };

    const outcome = await store.keepers.update((records): { next: KeeperRecord[]; result: Outcome } => {
      const index = records.findIndex((keeper) => keeper.id === params.data.id);
      if (index === -1) return { next: records, result: { kind: "missing" } };

      const current = records[index];
      const owner = body.data.owner ?? current.owner;
      const corrected: KeeperRecord = {
        ...current,
        owner,
        ownerName: owner === "me" ? "" : (body.data.ownerName ?? current.ownerName).trim(),
        costType: body.data.costType ?? current.costType,
        costValue: body.data.costValue ?? current.costValue,
      };
      // A snake keeper burns a round, so round costs start at 1; auction
      // dollars can legitimately be 0 (a free keeper).
      if (corrected.costType === "round" && corrected.costValue < 1) {
        return { next: records, result: { kind: "invalid" } };
      }

      const next = [...records];
      next[index] = corrected;
      return { next, result: { kind: "ok", keeper: corrected } };
    });

    if (outcome.kind === "missing") {
      res.status(404).json({ error: "No keeper with that id" });
      return;
    }
    if (outcome.kind === "invalid") {
      res.status(400).json({ error: "A round keeper needs a round of at least 1" });
      return;
    }

    res.json(UpdateKeeperResponse.parse(outcome.keeper));
  } catch (error) {
    next(error);
  }
});

router.delete("/keepers/:id", async (req, res, next) => {
  try {
    const params = DeleteKeeperParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid keeper id" });
      return;
    }

    const removed = await store.keepers.remove((keeper) => keeper.id === params.data.id);
    if (removed === 0) {
      res.status(404).json({ error: "No keeper with that id" });
      return;
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/targets", async (_req, res, next) => {
  try {
    const targets = await store.targets.all();
    // Draft order: the round you plan to spend, then when you added him.
    targets.sort(
      (a, b) => a.targetRound - b.targetRound || a.createdAt.localeCompare(b.createdAt),
    );
    res.json(GetTargetsResponse.parse(targets));
  } catch (error) {
    next(error);
  }
});

router.put("/targets/:playerId", async (req, res, next) => {
  try {
    const params = SaveTargetParams.safeParse(req.params);
    const body = SaveTargetBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid target" });
      return;
    }

    const { players } = await snapshot();
    const player = players.find((candidate) => candidate.id === params.data.playerId);
    if (!player) {
      res.status(404).json({ error: "Player not found" });
      return;
    }

    const target = {
      playerId: player.id,
      playerName: player.name,
      team: player.team,
      position: player.position,
      targetRound: body.data.targetRound,
      note: body.data.note ?? "",
      createdAt: new Date().toISOString(),
    };

    await store.targets.upsert(target, (existing) => existing.playerId === player.id);
    res.json(SaveTargetResponse.parse(target));
  } catch (error) {
    next(error);
  }
});

router.delete("/targets/:playerId", async (req, res, next) => {
  try {
    const params = DeleteTargetParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid player id" });
      return;
    }

    const removed = await store.targets.remove(
      (target) => target.playerId === params.data.playerId,
    );
    if (removed === 0) {
      res.status(404).json({ error: "No target for that player" });
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
