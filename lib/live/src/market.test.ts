import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  consensusAdp,
  marketByPlayer,
  readMarketCache,
  refreshMarket,
  type MarketCache,
} from "./market.ts";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "market-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const ffcPayload = {
  players: [
    { name: "Kenneth Walker III", position: "RB", team: "SEA", adp: 22.4, stdev: 3.1 },
    { name: "Marvin Harrison Jr.", position: "WR", team: "ARI", adp: 18.9, stdev: 2.2 },
    { name: "Justin Tucker", position: "PK", team: "BAL", adp: 140.0, stdev: 9 },
  ],
};

const sleeperPayload = [
  {
    player_id: "9999",
    player: { first_name: "Kenneth", last_name: "Walker", position: "RB", team: "SEA" },
    stats: { adp_ppr: 24.0, pts_ppr: 210.5, pts_half_ppr: 195.0, pts_std: 180.1 },
  },
  {
    player_id: "9998",
    player: { first_name: "Marvin", last_name: "Harrison", position: "WR", team: "ARI" },
    stats: { adp_ppr: 999.0, pts_ppr: 240.2, pts_half_ppr: 220.0, pts_std: 200.0 },
  },
];

const espnPayload = {
  players: [
    {
      player: {
        fullName: "Kenneth Walker III",
        defaultPositionId: 2,
        proTeamId: 26,
        ownership: { averageDraftPosition: 21.0, auctionValueAverage: 18.4 },
      },
    },
    {
      player: {
        fullName: "Marvin Harrison Jr.",
        defaultPositionId: 3,
        proTeamId: 22,
        ownership: { averageDraftPosition: 17.5, auctionValueAverage: 24.9 },
      },
    },
  ],
};

const ecrCsv = [
  "fp_page,page_type,ecr_type,player,pos,tm,ecr,sd,rank_delta,scrape_date",
  "x,redraft-overall,rp,Kenneth Walker III,RB,SEA,21,3,2,2026-08-14",
  "x,redraft-overall,rp,Marvin Harrison Jr.,WR,ARI,17,2,-1,2026-08-14",
  "x,best-overall,rp,Best Ball Guy,RB,KC,5,1,0,2026-08-14",
].join("\n");

function jsonResponse(body: unknown): Response {
  // Strings are served raw (the ECR fixture is CSV); everything else as JSON.
  return typeof body === "string"
    ? new Response(body, { status: 200, headers: { "content-type": "text/csv" } })
    : new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
}

type SourceKey = "ffc" | "sleeper" | "espn" | "ecr";

function fakeFetch(overrides: Partial<Record<SourceKey, unknown>> = {}) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const routes: [string, SourceKey, unknown][] = [
      ["fantasyfootballcalculator", "ffc", ffcPayload],
      ["sleeper", "sleeper", sleeperPayload],
      ["espn", "espn", espnPayload],
      ["githubusercontent", "ecr", ecrCsv],
    ];
    for (const [needle, key, fallback] of routes) {
      if (!url.includes(needle)) continue;
      const body = key in overrides ? overrides[key] : fallback;
      if (body instanceof Error) throw body;
      return jsonResponse(body);
    }
    throw new Error(`unexpected URL: ${url}`);
  }) as typeof fetch;
}

const players = [
  // Dataset names carry the suffixes the sources sometimes drop; normalizeName
  // strips them on both sides.
  { id: "00-001", name: "Kenneth Walker III", team: "SEA", position: "RB" },
  { id: "00-002", name: "Marvin Harrison Jr.", team: "ARI", position: "WR" },
  { id: "00-003", name: "Nobody Matched", team: "KC", position: "TE" },
];

test("a full refresh caches all three sources and matches suffix names", async () => {
  const { cache, status } = await refreshMarket(dataDir, { fetchImpl: fakeFetch() });
  assert.equal(status.stale, false);
  assert.equal(status.sources.length, 4);
  assert.ok(cache);

  const market = marketByPlayer(cache, players);

  const walker = market.get("00-001");
  assert.ok(walker);
  assert.deepEqual(
    walker.adpSources.map((entry) => entry.source).sort(),
    ["espn", "ffc", "sleeper"],
  );
  assert.equal(walker.adpStdev, 3.1);
  assert.equal(walker.projection?.ppr, 210.5);
  assert.equal(walker.aav, 18.4);
  // Live ECR overlays the newest expert consensus; best-ball rows are ignored.
  assert.equal(walker.ecrRank, 21);
  assert.equal(walker.ecrDelta, 2);

  // Harrison's Sleeper ADP is the 999 sentinel — projection kept, ADP dropped.
  const harrison = market.get("00-002");
  assert.ok(harrison);
  assert.deepEqual(harrison.adpSources.map((entry) => entry.source).sort(), ["espn", "ffc"]);
  assert.equal(harrison.projection?.ppr, 240.2);

  assert.equal(market.get("00-003"), undefined);

  // The kicker was filtered out before caching.
  assert.ok(cache.adp.ffc.every((record) => record.position !== "PK"));
});

test("a failed source keeps its previous records and marks the refresh stale", async () => {
  await refreshMarket(dataDir, { fetchImpl: fakeFetch() });

  const { cache, status } = await refreshMarket(dataDir, {
    fetchImpl: fakeFetch({ ffc: new Error("connection refused") }),
  });

  assert.equal(status.stale, true);
  const ffcResult = status.sources.find((source) => source.name === "FFC ADP");
  assert.equal(ffcResult?.ok, false);

  // FFC records survive from the previous refresh; the others are fresh.
  assert.ok(cache);
  assert.equal(cache.adp.ffc.length, 2);
  assert.equal(cache.projections.sleeper.length, 2);
});

test("when every source fails the previous cache is left untouched", async () => {
  await refreshMarket(dataDir, { fetchImpl: fakeFetch() });
  const before = await readMarketCache(dataDir);

  const failure = new Error("offline");
  const { status } = await refreshMarket(dataDir, {
    fetchImpl: fakeFetch({ ffc: failure, sleeper: failure, espn: failure, ecr: failure }),
  });

  assert.equal(status.stale, true);
  assert.deepEqual(await readMarketCache(dataDir), before);
});

test("an empty payload counts as a failure, not an empty success", async () => {
  await refreshMarket(dataDir, { fetchImpl: fakeFetch() });
  const { cache, status } = await refreshMarket(dataDir, {
    fetchImpl: fakeFetch({ ffc: { players: [] } }),
  });

  assert.equal(status.sources.find((source) => source.name === "FFC ADP")?.ok, false);
  assert.ok(cache);
  assert.equal(cache.adp.ffc.length, 2); // previous records kept
});

test("consensus is the mean with a sample spread", () => {
  assert.deepEqual(consensusAdp([]), { mean: null, stdev: null });
  assert.deepEqual(consensusAdp([10]), { mean: 10, stdev: null });

  const { mean, stdev } = consensusAdp([20, 22, 24]);
  assert.equal(mean, 22);
  assert.equal(stdev, 2);
});

test("marketByPlayer with no cache returns an empty map", () => {
  assert.equal(marketByPlayer(null, players).size, 0);
});

test("same name and position on different teams stays separated by team", async () => {
  const cache: MarketCache = {
    fetchedAt: "2026-08-18T00:00:00Z",
    adp: {
      ffc: [
        { gsisId: null, name: "Josh Allen", team: "BUF", position: "QB", adp: 20, stdev: null },
        { gsisId: null, name: "Josh Allen", team: "JAX", position: "QB", adp: 180, stdev: null },
      ],
      sleeper: [],
      espn: [],
    },
    projections: { sleeper: [] },
    auction: { espn: [] },
  };

  const market = marketByPlayer(cache, [
    { id: "qb-buf", name: "Josh Allen", team: "BUF", position: "QB" },
  ]);
  assert.equal(market.get("qb-buf")?.adpSources[0]?.adp, 20);
});
