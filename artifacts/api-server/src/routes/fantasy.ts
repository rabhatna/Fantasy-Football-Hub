import { Router, type IRouter } from "express";
import {
  GetDraftSummaryResponse,
  GetNewsResponse,
  GetOLImpactResponse,
  GetPlayerParams,
  GetPlayerResponse,
  GetPlayersQueryParams,
  GetPlayersResponse,
  GetTeamsResponse,
  RefreshDataResponse,
  SaveDraftPickBody,
  SaveDraftPickResponse,
} from "@workspace/api-zod";

type Player = {
  id: string;
  rank: number;
  name: string;
  team: string;
  position: string;
  adp: number;
  valueScore: number;
  ppg: number;
  share: number;
  oLineGrade: number;
  injuryStatus: string;
  byeWeek: number;
  tier: number;
  durabilityScore: number;
  productionFinish: number;
  nextGen: {
    separation: number;
    croe: number;
    ryoe: number;
    boxCount: number;
  };
  consistency: {
    floor: number;
    ceiling: number;
    boomRate: number;
    bustRate: number;
  };
  weeklyScores: number[];
};

// ── Seeded PRNG for deterministic generated data ──────────────────────────────
function makePrng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function rng(rand: () => number, min: number, max: number, decimals = 0) {
  const raw = min + rand() * (max - min);
  const factor = 10 ** decimals;
  return Math.round(raw * factor) / factor;
}

// ── Name pools ────────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  "Alvin", "Andre", "Antonio", "Austin", "Baker", "Ben", "Brandon", "Brandin", "Brock", "Byron",
  "Calvin", "Cameron", "Chase", "Chris", "Chuba", "CJ", "Cole", "Connor", "Cooper", "Curtis",
  "Dalton", "Dameon", "Daniel", "Dare", "Darius", "Darrell", "Davis", "DeAndre", "Deebo", "Derek",
  "Deshaun", "Devin", "Diontae", "DK", "Donovan", "Drake", "Dylan", "Elijah", "Emmanuel", "Evan",
  "Gabriel", "Gardner", "George", "Geno", "Greg", "Gunner", "Gus", "Hassan", "Hunter", "Isiah",
  "Jack", "Jake", "Jamaal", "James", "Jaret", "Jerome", "Jimmy", "Jordan", "Josh", "Kadarius",
  "Kayshon", "Keenan", "Kenny", "Kevin", "Khalil", "Kyler", "Kyren", "Lamar", "Laviska", "Leonard",
  "Marcus", "Marlon", "Marquise", "Matt", "Michael", "Mack", "Miles", "Najee", "Nico", "Nyheim",
  "Odell", "Patrick", "Preston", "Quentin", "Rachaad", "Raheem", "Randall", "Rashee", "Rashod", "Robert",
  "Romeo", "Rhamondre", "Royce", "Russell", "Ryan", "Sam", "Samaje", "Skyy", "Sony", "Stefon",
  "Tee", "Terry", "Tony", "Treylon", "Tua", "Tyler", "Van", "Velus", "Warren", "Zach",
  "Zay", "Taylor", "Jaylen", "Dak", "Joe", "Trevor", "Anthony", "Demarcus", "Jaxon", "Wan'Dale",
];

const LAST_NAMES = [
  "Adams", "Alexander", "Allen", "Anderson", "Andrews", "Bailey", "Barnes", "Bell", "Bennett", "Brooks",
  "Brown", "Bryant", "Butler", "Campbell", "Carter", "Clark", "Coleman", "Collins", "Conner", "Cook",
  "Cooper", "Cox", "Dalton", "Diggs", "Ekeler", "Evans", "Fields", "Flores", "Foster", "Garcia",
  "Gonzales", "Gray", "Green", "Griffin", "Hall", "Harris", "Henderson", "Henry", "Hernandez", "Hill",
  "Hopkins", "Howard", "Hughes", "Jackson", "James", "Jenkins", "Johnson", "Jones", "Kelly", "King",
  "Kupp", "Lawrence", "Lee", "Lewis", "Long", "Lopez", "Martin", "Martinez", "Mattison", "Miller",
  "Mitchell", "Moore", "Morgan", "Morris", "Murphy", "Parker", "Patterson", "Perry", "Peterson", "Phillips",
  "Pierce", "Pollard", "Powell", "Price", "Ramirez", "Reed", "Richardson", "Rivera", "Robinson", "Rodriguez",
  "Rogers", "Ross", "Russell", "Sanders", "Sanchez", "Scott", "Simmons", "Smith", "Stewart", "Taylor",
  "Thomas", "Thompson", "Torres", "Turner", "Walker", "Ward", "Washington", "Watson", "White", "Williams",
  "Wilson", "Wood", "Wright", "Young", "Burrow", "Stroud", "Love", "Murray", "Herbert", "Sermon",
  "Kelce", "Pollard", "Conner", "Minshew", "Cousins", "Carr", "Brissett", "Flacco", "Dalton", "Winston",
];

const NFL_TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN",
  "DET", "GB",  "HOU", "IND", "JAX", "KC",  "LAC", "LAR", "LV",  "MIA",
  "MIN", "NE",  "NO",  "NYG", "NYJ", "PHI", "PIT", "SEA", "SF",  "TB",
  "TEN", "WSH",
];

const BYE_WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const INJURY_STATUSES = [
  "Active", "Active", "Active", "Active", "Active", "Active", "Active", // ~70%
  "Questionable", "Questionable",                                        // ~13%
  "Doubtful",                                                            // ~7%
  "IR",                                                                  // ~5%
  "PUP",                                                                 // ~5%
];

// Position sequence for ranks 13-250 (238 players) mimicking realistic ADP mix
// WR: ~92, RB: ~71, TE: ~36, QB: ~39
const GEN_POSITIONS: string[] = (() => {
  // Build a repeating pattern for each tier of ~12
  // Tier 3 (ranks 13-24): 5 WR, 4 RB, 2 TE, 1 QB
  // Tier 4 (ranks 25-48): 10 WR, 7 RB, 3 TE, 4 QB (×2)
  // Tier 5 (ranks 49-96): 19 WR, 14 RB, 7 TE, 8 QB (×2 groups)
  // Tier 6 (ranks 97-250): 58 WR, 46 RB, 24 TE, 26 QB
  const seq = [
    // 13-24 (12 players)
    "WR","RB","WR","RB","TE","WR","RB","QB","WR","RB","WR","TE",
    // 25-36 (12)
    "WR","RB","WR","QB","TE","WR","RB","WR","QB","RB","WR","TE",
    // 37-48 (12)
    "WR","RB","WR","RB","QB","WR","TE","RB","WR","QB","RB","WR",
    // 49-60 (12)
    "WR","RB","QB","WR","TE","RB","WR","QB","RB","WR","TE","WR",
    // 61-72 (12)
    "RB","WR","QB","WR","RB","TE","WR","RB","WR","QB","RB","WR",
    // 73-84 (12)
    "TE","WR","RB","QB","WR","RB","WR","TE","QB","RB","WR","WR",
    // 85-96 (12)
    "RB","WR","QB","TE","WR","RB","WR","QB","RB","WR","TE","RB",
    // 97-108 (12)
    "WR","QB","RB","WR","TE","RB","QB","WR","RB","WR","TE","QB",
    // 109-120 (12)
    "WR","RB","WR","TE","QB","RB","WR","QB","RB","WR","TE","RB",
    // 121-132 (12)
    "WR","QB","WR","RB","TE","WR","QB","RB","WR","TE","RB","QB",
    // 133-144 (12)
    "WR","RB","WR","QB","TE","RB","WR","QB","WR","RB","TE","WR",
    // 145-156 (12)
    "QB","RB","WR","TE","WR","RB","QB","WR","RB","TE","WR","QB",
    // 157-168 (12)
    "WR","RB","TE","QB","WR","RB","WR","QB","TE","RB","WR","QB",
    // 169-180 (12)
    "WR","RB","WR","TE","QB","RB","WR","RB","QB","WR","TE","RB",
    // 181-192 (12)
    "WR","QB","RB","TE","WR","QB","RB","WR","TE","QB","RB","WR",
    // 193-204 (12)
    "QB","WR","RB","TE","QB","WR","RB","QB","WR","TE","RB","QB",
    // 205-216 (12)
    "WR","RB","QB","TE","WR","RB","QB","WR","TE","RB","QB","WR",
    // 217-228 (12)
    "RB","QB","WR","TE","QB","RB","WR","QB","RB","TE","WR","QB",
    // 229-240 (12)
    "WR","RB","QB","TE","WR","QB","RB","WR","QB","TE","RB","QB",
    // 241-250 (10)
    "WR","RB","QB","TE","WR","QB","RB","WR","QB","RB",
  ];
  return seq;
})();

// ── Generate weekly scores ────────────────────────────────────────────────────
function generateWeeklyScores(rand: () => number, ppg: number, injuryStatus: string): number[] {
  const weeks = 12;
  const missed = injuryStatus === "IR" ? 4 : injuryStatus === "PUP" ? 3 : injuryStatus === "Out" ? 2 : 0;
  return Array.from({ length: weeks }, (_, i) => {
    if (i < missed) return 0;
    const variance = ppg * 0.55 * (rand() * 2 - 1);
    return Math.max(0, Math.round((ppg + variance) * 10) / 10);
  });
}

// ── Generate the full 250-player pool ────────────────────────────────────────
function generatePlayers(): Player[] {
  const seed0 = 0x4e5f6a7b;
  const rand = makePrng(seed0);

  // Track used names and teams to keep some realism
  const usedNames = new Set<string>();
  const teamPlayerCount: Record<string, number> = {};

  const pickName = (): string => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
      const last  = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
      const full  = `${first} ${last}`;
      if (!usedNames.has(full)) {
        usedNames.add(full);
        return full;
      }
    }
    // Fallback: append a number suffix
    const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
    const last  = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
    return `${first} ${last} Jr.`;
  };

  const pickTeam = (): string => {
    // Limit teams to ~8 players each for realism
    const available = NFL_TEAMS.filter((t) => (teamPlayerCount[t] ?? 0) < 8);
    const pool = available.length > 0 ? available : NFL_TEAMS;
    const t = pool[Math.floor(rand() * pool.length)];
    teamPlayerCount[t] = (teamPlayerCount[t] ?? 0) + 1;
    return t;
  };

  const tier = (rank: number): number => {
    if (rank <= 5)   return 1;
    if (rank <= 20)  return 2;
    if (rank <= 48)  return 3;
    if (rank <= 96)  return 4;
    if (rank <= 180) return 5;
    return 6;
  };

  const statsByRank = (rank: number, pos: string) => {
    const t = tier(rank);
    // PPG drops with tier; QBs score higher but no share metric
    const ppgBase = pos === "QB"
      ? [22, 20, 18, 16.5, 15, 13][t - 1]
      : pos === "TE"
      ? [15, 13, 11.5, 10, 8.5, 7][t - 1]
      : [20, 17, 14.5, 12, 10, 8][t - 1];
    const ppg = Math.max(4, Math.round((ppgBase + rng(rand, -1.5, 1.5, 1)) * 10) / 10);

    const adpVariance = rng(rand, -3, 5, 1);
    const adp = Math.max(1, Math.round((rank + adpVariance) * 10) / 10);

    const valueScore = Math.max(0.5, Math.min(10, Math.round((11 - t * 1.3 + rng(rand, -1.5, 2, 1)) * 10) / 10));

    const shareBase = pos === "QB" ? 0 : pos === "TE" ? rng(rand, 12, 22, 1) : pos === "RB" ? rng(rand, 14, 28, 1) : rng(rand, 16, 32, 1);
    const share = shareBase;

    const oLineGrade = rng(rand, 55, 95);
    const durabilityScore = rng(rand, 55, 98);
    const productionFinish = rng(rand, rank - 8, rank + 15);

    const separation = pos === "QB" || pos === "RB" ? rng(rand, 0, 20) : rng(rand, 55, 95);
    const croe       = pos === "QB" || pos === "RB" ? rng(rand, 0, 20) : rng(rand, 55, 95);
    const ryoe       = pos === "WR" || pos === "TE" ? rng(rand, 0, 20) : rng(rand, 55, 98);
    const boxCount   = pos === "QB" || pos === "TE" ? rng(rand, 0, 20) : rng(rand, 45, 85);

    const floorBase   = Math.max(1, ppg * 0.6);
    const ceilingBase = ppg * 1.65;
    const boomRate    = Math.max(5, rng(rand, 15, 55));
    const bustRate    = Math.max(5, rng(rand, 8, 35));

    const injuryStatus = INJURY_STATUSES[Math.floor(rand() * INJURY_STATUSES.length)];
    const byeWeek = BYE_WEEKS[Math.floor(rand() * BYE_WEEKS.length)];

    return { ppg, adp, valueScore, share, oLineGrade, durabilityScore, productionFinish, separation, croe, ryoe, boxCount, floorBase, ceilingBase, boomRate, bustRate, injuryStatus, byeWeek };
  };

  const generated: Player[] = [];

  for (let i = 0; i < GEN_POSITIONS.length; i++) {
    const rank = 13 + i;
    const position = GEN_POSITIONS[i];
    const name = pickName();
    const team = pickTeam();
    const s = statsByRank(rank, position);
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) + rank;

    generated.push({
      id,
      rank,
      name,
      team,
      position,
      adp: s.adp,
      valueScore: s.valueScore,
      ppg: s.ppg,
      share: s.share,
      oLineGrade: s.oLineGrade,
      injuryStatus: s.injuryStatus,
      byeWeek: s.byeWeek,
      tier: tier(rank),
      durabilityScore: s.durabilityScore,
      productionFinish: Math.max(1, Math.round(s.productionFinish)),
      nextGen: {
        separation: s.separation,
        croe: s.croe,
        ryoe: s.ryoe,
        boxCount: s.boxCount,
      },
      consistency: {
        floor: Math.round(s.floorBase * 10) / 10,
        ceiling: Math.round(s.ceilingBase * 10) / 10,
        boomRate: s.boomRate,
        bustRate: s.bustRate,
      },
      weeklyScores: generateWeeklyScores(rand, s.ppg, s.injuryStatus),
    });
  }

  return generated;
}

// ── Static top-12 players ────────────────────────────────────────────────────
const TOP_12: Player[] = [
  {
    id: "jefferson",
    rank: 1,
    name: "Justin Jefferson",
    team: "MIN",
    position: "WR",
    adp: 2.4,
    valueScore: 8.8,
    ppg: 19.7,
    share: 31.2,
    oLineGrade: 84,
    injuryStatus: "Active",
    byeWeek: 6,
    tier: 1,
    durabilityScore: 94,
    productionFinish: 2,
    nextGen: { separation: 91, croe: 88, ryoe: 42, boxCount: 61 },
    consistency: { floor: 12.6, ceiling: 33.4, boomRate: 42, bustRate: 8 },
    weeklyScores: [17.2, 24.8, 15.1, 28.6, 18.3, 21.9, 14.4, 26.1, 19.7, 22.6, 13.9, 31.2],
  },
  {
    id: "chase",
    rank: 2,
    name: "Ja'Marr Chase",
    team: "CIN",
    position: "WR",
    adp: 3.1,
    valueScore: 7.4,
    ppg: 20.2,
    share: 29.4,
    oLineGrade: 79,
    injuryStatus: "Active",
    byeWeek: 10,
    tier: 1,
    durabilityScore: 88,
    productionFinish: 1,
    nextGen: { separation: 89, croe: 85, ryoe: 38, boxCount: 67 },
    consistency: { floor: 11.1, ceiling: 36.8, boomRate: 47, bustRate: 11 },
    weeklyScores: [23.4, 18.2, 29.1, 12.4, 21.8, 26.5, 16.1, 31.7, 19.3, 25.4, 14.6, 28.9],
  },
  {
    id: "hall",
    rank: 3,
    name: "Breece Hall",
    team: "NYJ",
    position: "RB",
    adp: 4.8,
    valueScore: 5.9,
    ppg: 18.4,
    share: 24.8,
    oLineGrade: 73,
    injuryStatus: "Active",
    byeWeek: 9,
    tier: 1,
    durabilityScore: 82,
    productionFinish: 4,
    nextGen: { separation: 78, croe: 73, ryoe: 92, boxCount: 71 },
    consistency: { floor: 9.2, ceiling: 31.4, boomRate: 38, bustRate: 16 },
    weeklyScores: [15.8, 8.9, 22.6, 27.1, 12.2, 19.4, 24.3, 10.1, 18.8, 29.4, 16.5, 14.7],
  },
  {
    id: "bijan",
    rank: 4,
    name: "Bijan Robinson",
    team: "ATL",
    position: "RB",
    adp: 5.3,
    valueScore: 6.7,
    ppg: 17.9,
    share: 22.7,
    oLineGrade: 88,
    injuryStatus: "Active",
    byeWeek: 5,
    tier: 1,
    durabilityScore: 96,
    productionFinish: 6,
    nextGen: { separation: 81, croe: 79, ryoe: 95, boxCount: 76 },
    consistency: { floor: 10.4, ceiling: 29.9, boomRate: 35, bustRate: 13 },
    weeklyScores: [17.2, 19.8, 15.7, 25.4, 12.8, 18.6, 20.1, 11.9, 23.6, 16.7, 21.4, 14.9],
  },
  {
    id: "lamb",
    rank: 5,
    name: "CeeDee Lamb",
    team: "DAL",
    position: "WR",
    adp: 6.2,
    valueScore: 4.8,
    ppg: 18.7,
    share: 28.1,
    oLineGrade: 76,
    injuryStatus: "Questionable",
    byeWeek: 10,
    tier: 1,
    durabilityScore: 79,
    productionFinish: 3,
    nextGen: { separation: 84, croe: 83, ryoe: 40, boxCount: 65 },
    consistency: { floor: 10.2, ceiling: 32.8, boomRate: 41, bustRate: 14 },
    weeklyScores: [14.2, 26.5, 18.6, 21.3, 9.8, 29.7, 16.4, 22.8, 12.1, 31.4, 17.7, 19.6],
  },
  {
    id: "mccaffrey",
    rank: 6,
    name: "Christian McCaffrey",
    team: "SF",
    position: "RB",
    adp: 7.5,
    valueScore: 3.1,
    ppg: 17.1,
    share: 25.9,
    oLineGrade: 92,
    injuryStatus: "PUP",
    byeWeek: 8,
    tier: 2,
    durabilityScore: 61,
    productionFinish: 8,
    nextGen: { separation: 76, croe: 71, ryoe: 88, boxCount: 81 },
    consistency: { floor: 8.8, ceiling: 34.7, boomRate: 39, bustRate: 23 },
    weeklyScores: [0, 24.6, 19.2, 28.8, 0, 17.4, 22.3, 13.1, 26.9, 18.7, 0, 29.4],
  },
  {
    id: "stbrown",
    rank: 7,
    name: "Amon-Ra St. Brown",
    team: "DET",
    position: "WR",
    adp: 8.9,
    valueScore: 4.2,
    ppg: 17.6,
    share: 27.5,
    oLineGrade: 90,
    injuryStatus: "Active",
    byeWeek: 8,
    tier: 2,
    durabilityScore: 93,
    productionFinish: 5,
    nextGen: { separation: 82, croe: 90, ryoe: 35, boxCount: 59 },
    consistency: { floor: 11.5, ceiling: 28.6, boomRate: 34, bustRate: 7 },
    weeklyScores: [18.8, 21.6, 16.1, 22.7, 14.5, 19.9, 24.1, 13.8, 20.4, 17.3, 25.2, 15.6],
  },
  {
    id: "kelce",
    rank: 8,
    name: "Travis Kelce",
    team: "KC",
    position: "TE",
    adp: 18.7,
    valueScore: 9.3,
    ppg: 14.8,
    share: 21.6,
    oLineGrade: 87,
    injuryStatus: "Active",
    byeWeek: 10,
    tier: 2,
    durabilityScore: 87,
    productionFinish: 7,
    nextGen: { separation: 86, croe: 81, ryoe: 28, boxCount: 58 },
    consistency: { floor: 8.9, ceiling: 27.4, boomRate: 27, bustRate: 10 },
    weeklyScores: [14.2, 18.9, 12.4, 21.1, 9.8, 16.7, 11.6, 24.8, 13.7, 15.9, 18.3, 10.4],
  },
  {
    id: "hurts",
    rank: 9,
    name: "Jalen Hurts",
    team: "PHI",
    position: "QB",
    adp: 29.8,
    valueScore: 7.8,
    ppg: 22.1,
    share: 0,
    oLineGrade: 86,
    injuryStatus: "Active",
    byeWeek: 9,
    tier: 2,
    durabilityScore: 91,
    productionFinish: 3,
    nextGen: { separation: 0, croe: 0, ryoe: 93, boxCount: 0 },
    consistency: { floor: 15.2, ceiling: 34.1, boomRate: 52, bustRate: 9 },
    weeklyScores: [23.6, 18.4, 29.1, 20.7, 26.8, 14.9, 31.2, 21.5, 19.8, 27.7, 16.6, 24.5],
  },
  {
    id: "nabers",
    rank: 10,
    name: "Malik Nabers",
    team: "NYG",
    position: "WR",
    adp: 12.6,
    valueScore: 10.6,
    ppg: 15.8,
    share: 30.6,
    oLineGrade: 68,
    injuryStatus: "Questionable",
    byeWeek: 14,
    tier: 2,
    durabilityScore: 74,
    productionFinish: 12,
    nextGen: { separation: 93, croe: 77, ryoe: 36, boxCount: 72 },
    consistency: { floor: 7.4, ceiling: 33.2, boomRate: 36, bustRate: 24 },
    weeklyScores: [9.3, 26.8, 11.4, 18.9, 7.6, 30.1, 15.8, 22.4, 8.7, 28.6, 13.2, 20.5],
  },
  {
    id: "williams",
    rank: 11,
    name: "Puka Nacua",
    team: "LAR",
    position: "WR",
    adp: 13.4,
    valueScore: 5.5,
    ppg: 16.4,
    share: 26.8,
    oLineGrade: 82,
    injuryStatus: "Active",
    byeWeek: 8,
    tier: 2,
    durabilityScore: 80,
    productionFinish: 9,
    nextGen: { separation: 79, croe: 86, ryoe: 31, boxCount: 63 },
    consistency: { floor: 9.7, ceiling: 31.5, boomRate: 33, bustRate: 15 },
    weeklyScores: [17.4, 12.8, 23.6, 14.9, 26.1, 10.7, 19.8, 21.4, 13.6, 29.2, 15.4, 18.1],
  },
  {
    id: "laporta",
    rank: 12,
    name: "Sam LaPorta",
    team: "DET",
    position: "TE",
    adp: 35.1,
    valueScore: 6.9,
    ppg: 12.9,
    share: 17.4,
    oLineGrade: 90,
    injuryStatus: "Active",
    byeWeek: 8,
    tier: 3,
    durabilityScore: 95,
    productionFinish: 10,
    nextGen: { separation: 80, croe: 75, ryoe: 27, boxCount: 52 },
    consistency: { floor: 6.2, ceiling: 25.3, boomRate: 22, bustRate: 18 },
    weeklyScores: [10.4, 15.2, 8.1, 17.6, 6.5, 14.9, 12.8, 20.1, 7.3, 16.8, 11.2, 9.7],
  },
];

const players: Player[] = [...TOP_12, ...generatePlayers()];

const teams = [
  { team: "DET", fullName: "Detroit Lions", aly: 5.2, stuffRate: 12.4, passBlockGrade: 91, proe: 5.8, snapContinuity: 94, vacatedOpportunity: 18, trend: "Rising" },
  { team: "SF", fullName: "San Francisco 49ers", aly: 5.0, stuffRate: 13.1, passBlockGrade: 88, proe: 2.6, snapContinuity: 86, vacatedOpportunity: 22, trend: "Stable" },
  { team: "ATL", fullName: "Atlanta Falcons", aly: 4.9, stuffRate: 14.2, passBlockGrade: 86, proe: 4.2, snapContinuity: 90, vacatedOpportunity: 31, trend: "Rising" },
  { team: "PHI", fullName: "Philadelphia Eagles", aly: 4.8, stuffRate: 14.6, passBlockGrade: 87, proe: 3.9, snapContinuity: 82, vacatedOpportunity: 26, trend: "Stable" },
  { team: "MIN", fullName: "Minnesota Vikings", aly: 4.6, stuffRate: 15.8, passBlockGrade: 84, proe: 7.4, snapContinuity: 78, vacatedOpportunity: 36, trend: "Rising" },
  { team: "KC", fullName: "Kansas City Chiefs", aly: 4.4, stuffRate: 16.1, passBlockGrade: 83, proe: 6.1, snapContinuity: 71, vacatedOpportunity: 29, trend: "Watch" },
  { team: "LAR", fullName: "Los Angeles Rams", aly: 4.3, stuffRate: 17.3, passBlockGrade: 80, proe: 4.9, snapContinuity: 76, vacatedOpportunity: 24, trend: "Stable" },
  { team: "NYG", fullName: "New York Giants", aly: 3.7, stuffRate: 20.8, passBlockGrade: 69, proe: 1.8, snapContinuity: 62, vacatedOpportunity: 42, trend: "Risk" },
];

const news = [
  { id: "n1", source: "Injury Radar", author: "@InStreetClothes", headline: "CeeDee Lamb limited again; team calls it maintenance, not a setback.", timestamp: "12 min ago", sentiment: "Caution", status: "Questionable", playerId: "lamb" },
  { id: "n2", source: "Beat Report", author: "@VikingsCentral", headline: "Justin Jefferson has been a full participant through two padded practices.", timestamp: "28 min ago", sentiment: "Positive", status: "Active", playerId: "jefferson" },
  { id: "n3", source: "Medical Desk", author: "@ProFootballDoc", headline: "McCaffrey's lower-leg workload remains the biggest variable in early camp.", timestamp: "43 min ago", sentiment: "Caution", status: "PUP", playerId: "mccaffrey" },
  { id: "n4", source: "Market Pulse", author: "Draft Exchange", headline: "Malik Nabers' ADP moved up 2.1 spots after a strong red-zone week.", timestamp: "1 hr ago", sentiment: "Positive", status: "Active", playerId: "nabers" },
  { id: "n5", source: "Line Watch", author: "OL Context", headline: "Atlanta projects for the biggest positive snap-continuity delta in the NFC South.", timestamp: "2 hrs ago", sentiment: "Positive", status: "Active", playerId: null },
];

const draftPicks: { id: string; playerId: string; pickNumber: number; draftedAt: string }[] = [];
const refreshedAt = "2026-08-17T16:20:00.000Z";

const router: IRouter = Router();

router.get("/players", (req, res) => {
  const parsed = GetPlayersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid player filters" });
    return;
  }
  const { position, search, maxAdp, minShare, excludeUnhealthy } = parsed.data;
  const normalizedSearch = search?.trim().toLowerCase();
  const filtered = players.filter((player) => {
    if (position && position !== "ALL" && player.position !== position) return false;
    if (normalizedSearch && !`${player.name} ${player.team}`.toLowerCase().includes(normalizedSearch)) return false;
    if (typeof maxAdp === "number" && player.adp > maxAdp) return false;
    if (typeof minShare === "number" && player.share < minShare) return false;
    if (excludeUnhealthy && ["PUP", "IR", "Out"].includes(player.injuryStatus)) return false;
    return true;
  });
  res.json(GetPlayersResponse.parse(filtered));
});

router.get("/players/:id", (req, res) => {
  const params = GetPlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid player id" });
    return;
  }
  const player = players.find((item) => item.id === params.data.id);
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(GetPlayerResponse.parse(player));
});

router.get("/teams", (_req, res) => {
  res.json(GetTeamsResponse.parse(teams));
});

router.get("/news", (_req, res) => {
  res.json(GetNewsResponse.parse(news));
});

router.get("/draft/summary", (_req, res) => {
  const draftedPlayers = players.filter((player) => draftPicks.some((pick) => pick.playerId === player.id));
  const needs = { QB: 1, RB: 2, WR: 3, TE: 1 };
  draftedPlayers.forEach((player) => {
    if (player.position in needs && needs[player.position as keyof typeof needs] > 0) {
      needs[player.position as keyof typeof needs] -= 1;
    }
  });
  res.json(
    GetDraftSummaryResponse.parse({
      playersTracked: players.length,
      draftedCount: draftedPlayers.length,
      averageAdp: draftedPlayers.length
        ? Number((draftedPlayers.reduce((total, player) => total + player.adp, 0) / draftedPlayers.length).toFixed(1))
        : 0,
      valueTargets: players.filter((player) => player.valueScore >= 7).length,
      positionalNeeds: needs,
      lastRefresh: refreshedAt,
    }),
  );
});

router.post("/draft/picks", (req, res) => {
  const body = SaveDraftPickBody.safeParse(req.body);
  if (!body.success || !players.some((player) => player.id === body.data.playerId)) {
    res.status(400).json({ error: "Invalid draft pick" });
    return;
  }
  const pick = {
    id: `pick-${draftPicks.length + 1}`,
    playerId: body.data.playerId,
    pickNumber: body.data.pickNumber,
    draftedAt: new Date().toISOString(),
  };
  draftPicks.push(pick);
  res.status(201).json(SaveDraftPickResponse.parse(pick));
});

// ── OL composite scoring ─────────────────────────────────────────────────────
function computeOLComposite(team: typeof teams[number]): number {
  // Normalize each metric to 0-100 scale, then blend
  const alyNorm = Math.min(100, Math.max(0, (team.aly - 3.0) / (5.5 - 3.0) * 100));
  const stuffNorm = Math.min(100, Math.max(0, (25 - team.stuffRate) / (25 - 10) * 100)); // lower is better
  const passBlockNorm = Math.min(100, Math.max(0, team.passBlockGrade));
  const snapNorm = Math.min(100, Math.max(0, team.snapContinuity));

  // Weights: ALY 30%, stuff rate 20%, pass block 30%, snap continuity 20%
  const composite = alyNorm * 0.30 + stuffNorm * 0.20 + passBlockNorm * 0.30 + snapNorm * 0.20;
  return Math.round(composite * 10) / 10;
}

function olTierLabel(score: number): string {
  if (score >= 80) return "Elite";
  if (score >= 68) return "Above Average";
  if (score >= 55) return "Average";
  if (score >= 42) return "Below Average";
  return "Poor";
}

function impactLabel(rbValueScore: number, olScore: number): string {
  const goodRB = rbValueScore >= 7;
  const goodLine = olScore >= 68;
  if (goodRB && goodLine) return "Favorable";
  if (!goodRB && goodLine) return "Buy Low";
  if (goodRB && !goodLine) return "Landmine";
  return "Avoid";
}

function generateBlurb(
  name: string,
  team: typeof teams[number],
  olScore: number,
  olTier: string,
  impact: string,
): string {
  const trendPhrase = team.trend === "Rising"
    ? "an improving line that has been trending upward"
    : team.trend === "Stable"
    ? "a stable offensive front"
    : team.trend === "Watch"
    ? "a line to monitor closely for continuity changes"
    : "an offensive line that carries meaningful risk";

  const alyPhrase = team.aly >= 4.8
    ? `strong adjusted line yards (${team.aly.toFixed(1)}) create elite rushing lanes`
    : team.aly >= 4.0
    ? `solid adjusted line yards (${team.aly.toFixed(1)}) give enough room to operate`
    : `a below-average ALY of ${team.aly.toFixed(1)} limits second-level opportunity`;

  const stuffPhrase = team.stuffRate < 15
    ? `a low stuff rate of ${team.stuffRate.toFixed(1)}% keeps plays alive at the line`
    : team.stuffRate < 20
    ? `a manageable stuff rate (${team.stuffRate.toFixed(1)}%)`
    : `a high stuff rate of ${team.stuffRate.toFixed(1)}% regularly disrupts backfield timing`;

  const snapPhrase = team.snapContinuity >= 85
    ? `exceptional snap continuity (${team.snapContinuity.toFixed(1)}%) means scheme familiarity is high`
    : team.snapContinuity >= 70
    ? `decent snap continuity (${team.snapContinuity.toFixed(1)}%) limits chemistry concerns`
    : `low snap continuity (${team.snapContinuity.toFixed(1)}%) adds uncertainty to execution`;

  const conclusion =
    impact === "Favorable"
      ? `${name} is one of the clearest OL-boosted RB bets on the board.`
      : impact === "Buy Low"
      ? `${name} may be underpriced — the line support could unlock upside the market is missing.`
      : impact === "Landmine"
      ? `${name}'s talent is real but the line suppresses his floor more than his ADP reflects.`
      : `Context and player upside both limit the ceiling here — proceed with caution.`;

  return `${name} operates behind ${trendPhrase} (OL composite: ${olScore.toFixed(0)}/100, ${olTier}). The unit posts ${alyPhrase}, ${stuffPhrase}, and ${snapPhrase}. ${conclusion}`;
}

router.get("/ol-impact", (_req, res) => {
  const teamScoreMap = new Map<string, { score: number; tier: string }>();

  const teamScores = teams.map((team) => {
    const compositeScore = computeOLComposite(team);
    const tier = olTierLabel(compositeScore);
    teamScoreMap.set(team.team, { score: compositeScore, tier });
    return {
      team: team.team,
      fullName: team.fullName,
      compositeScore,
      aly: team.aly,
      stuffRate: team.stuffRate,
      passBlockGrade: team.passBlockGrade,
      snapContinuity: team.snapContinuity,
      trend: team.trend,
      tier,
    };
  });

  const rbImpacts = players
    .filter((player) => player.position === "RB")
    .map((player) => {
      const teamInfo = teamScoreMap.get(player.team);
      // Fallback for RBs whose team is not in the detailed teams list
      const olScore = teamInfo?.score ?? Math.round(player.oLineGrade * 0.9 * 10) / 10;
      const tier = teamInfo?.tier ?? olTierLabel(olScore);
      const teamData = teams.find((t) => t.team === player.team);
      const impact = impactLabel(player.valueScore, olScore);
      const blurb = teamData
        ? generateBlurb(player.name, teamData, olScore, tier, impact)
        : `${player.name} plays for a team with limited line data available. OL composite estimated at ${olScore.toFixed(0)}/100 (${tier}) based on player-level grade signals.`;
      return {
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        rank: player.rank,
        valueScore: player.valueScore,
        ppg: player.ppg,
        olCompositeScore: olScore,
        olTier: tier,
        impactLabel: impact,
        blurb,
      };
    })
    .sort((a, b) => a.rank - b.rank);

  res.json(GetOLImpactResponse.parse({ teamScores, rbImpacts }));
});

router.post("/data/refresh", (_req, res) => {
  res.json(
    RefreshDataResponse.parse({
      status: "refreshed",
      refreshedAt: new Date().toISOString(),
      sources: ["NFLverse", "Market ADP", "Injury Radar", "OL Context"],
    }),
  );
});

export default router;
