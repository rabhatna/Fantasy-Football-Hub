import { Router, type IRouter } from "express";
import { createStore, resolveDataDir, type DraftPickRecord } from "@workspace/store";
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
  GetNewsResponse,
  GetNotesResponse,
  GetOLImpactResponse,
  GetPlayerParams,
  GetPlayerResponse,
  GetPlayersQueryParams,
  GetPlayersResponse,
  GetTeamsResponse,
  RefreshDataResponse,
  SaveDraftPickBody,
  SaveDraftPickResponse,
  SavePlayerNoteBody,
  SavePlayerNoteParams,
  SavePlayerNoteResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

// Draft picks and notes persist as CSV under the data directory; the player
// board is read from a dated snapshot in the same place.
const store = createStore();
const dataDir = resolveDataDir();

let snapshotPromise: Promise<Snapshot> | null = null;
let loadedAt = new Date().toISOString();

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

/** A player's value score at or above this is a genuine market discount. */
const VALUE_TARGET_SD = 0.5;

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
    const { players } = await snapshot();
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
      // No availability data exists in this dataset, so this filter cannot be
      // honoured yet; it is a no-op rather than a filter that silently lies.
      if (excludeUnhealthy && player.injuryStatus !== null) {
        return !["PUP", "IR", "Out"].includes(player.injuryStatus);
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

    const { players } = await snapshot();
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

router.get("/news", (_req, res) => {
  // The dataset carries no injury or beat reporting, and this endpoint
  // previously returned invented headlines about invented players. It stays
  // empty until a live source is wired up rather than fabricating a feed.
  res.json(GetNewsResponse.parse([]));
});

router.get("/draft/summary", async (_req, res, next) => {
  try {
    const { players, version } = await snapshot();
    const picks = await reconcilePicks(players);

    const draftedPlayers = players.filter((player) =>
      picks.some((pick) => pick.playerId === player.id),
    );

    const needs = { QB: 1, RB: 2, WR: 3, TE: 1 };
    for (const player of draftedPlayers) {
      if (player.position in needs && needs[player.position as keyof typeof needs] > 0) {
        needs[player.position as keyof typeof needs] -= 1;
      }
    }

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
    // Drop both caches so a newly added snapshot, or an edit made directly in
    // Excel, is picked up without restarting the server.
    store.invalidate();
    snapshotPromise = null;
    const { version, players, teams } = await snapshot();

    res.json(
      RefreshDataResponse.parse({
        status: "ok",
        refreshedAt: loadedAt,
        sources: [
          { name: `dataset snapshot ${version}`, status: `${players.length} players` },
          { name: "team context", status: `${teams.length} teams` },
          { name: "draft board", status: "reloaded from disk" },
        ],
      }),
    );
  } catch (error) {
    next(error);
  }
});

export default router;
