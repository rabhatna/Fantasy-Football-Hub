import { useMemo, useState } from "react";
import { FlaskConical, Search } from "lucide-react";
import { useGetPlayers, useGetTeams } from "@workspace/api-client-react";
import type { Player, Team } from "@workspace/api-client-react";
import { NO_DATA, hasValue, num, pct, valueScore as fmtValueScore } from "@/lib/format";

/**
 * The Stat Lab: every number the platform tracks, laid out as the causal
 * chain that ends in fantasy points — the line blocks, the coach calls the
 * plays, the player earns the touches, converts them with some efficiency,
 * scores (or doesn't), and the market prices all of it. Two lenses: the
 * chain itself as a field guide with live league context, and a per-player
 * breakdown showing where one player sits on every link.
 */

type Verdict = { label: string; tone: "elite" | "good" | "neutral" | "poor" };

interface StatDef {
  key: string;
  label: string;
  /** Which chain stage owns the stat (index into STAGES). */
  scope: "player" | "team";
  /** Positions the stat is meaningful for; percentile pools use this. */
  positions?: string[];
  /** Read the value. Team stats read from the player's team when inspecting. */
  read: (player: Player | null, team: Team | null) => number | null | undefined;
  format: (value: number | null | undefined) => string;
  /** When false, a lower number is the better one (stuff rate, drops). */
  higherIsBetter: boolean;
  /** Optional absolute bands from the research; percentile is the fallback. */
  verdict?: (value: number) => Verdict;
  what: string;
  why: string;
  inApp: string;
}

interface Stage {
  key: string;
  title: string;
  blurb: string;
  stats: StatDef[];
}

const elite = (label = "Elite"): Verdict => ({ label, tone: "elite" });
const good = (label = "Good"): Verdict => ({ label, tone: "good" });
const neutral = (label = "Average"): Verdict => ({ label, tone: "neutral" });
const poor = (label = "Thin"): Verdict => ({ label, tone: "poor" });

const SKILL = ["RB", "WR", "TE"];
const CATCHERS = ["WR", "TE", "RB"];

const STAGES: Stage[] = [
  {
    key: "trenches",
    title: "The trenches",
    blurb:
      "Everything starts up front. Line quality explains roughly a third of a running back's fantasy variance — and almost none of a receiver's. It touches quarterbacks only through sacks.",
    stats: [
      {
        key: "runBlockGrade",
        label: "Run block grade",
        scope: "team",
        read: (_p, t) => t?.runBlockGrade,
        format: (v) => num(v, 1),
        higherIsBetter: true,
        verdict: (v) => (v >= 78 ? elite() : v >= 70 ? good() : v >= 62 ? neutral() : poor("Weak")),
        what: "A 0-100 charting grade of the unit's run blocking across the season.",
        why: "Alongside adjusted line yards, the strongest line-to-back link there is: O-line quality explains roughly 29-43% of an RB's fantasy variance. Backs behind bottom-five lines almost never smash.",
        inApp: "30% of the O-line composite score; drives the RB impact labels on the O-Line page.",
      },
      {
        key: "aly",
        label: "Adjusted line yards",
        scope: "team",
        read: (_p, t) => t?.aly,
        format: (v) => num(v, 2),
        higherIsBetter: true,
        what: "Rushing yards credited to the line, not the back: losses count extra, the first four yards count fully, yards five to ten count half, and the long breakaway counts to the runner instead.",
        why: "The single best O-line stat for RB fantasy — it correlates with RB rushing production more strongly than any win-rate or grade.",
        inApp: "15% of the O-line composite; shown on every team's line detail.",
      },
      {
        key: "ybcPerAtt",
        label: "Yards before contact / att",
        scope: "team",
        read: (_p, t) => t?.ybcPerAtt,
        format: (v) => num(v, 2),
        higherIsBetter: true,
        what: "How far the team's backs get before a defender touches them — the line and scheme's share of every carry.",
        why: "Splitting yards per carry into before and after contact separates the line's work from the back's. A back with low YPC but strong after-contact numbers behind a bad line is a classic buy.",
        inApp: "New in the Stat Lab: pairs with yards after contact to split credit between line and back.",
      },
      {
        key: "yacPerAtt",
        label: "Yards after contact / att",
        scope: "team",
        read: (_p, t) => t?.yacPerAtt,
        format: (v) => num(v, 2),
        higherIsBetter: true,
        what: "How far the team's backs run after first contact — the runners' share of every carry.",
        why: "After-contact yardage is one of the stabler run-game skill signals year over year (r about 0.44) — much stickier than yards per carry itself.",
        inApp: "Team-level context for reading a back's efficiency stats fairly.",
      },
      {
        key: "stuffRate",
        label: "Stuff rate",
        scope: "team",
        read: (_p, t) => t?.stuffRate,
        format: (v) => pct(v, 1),
        higherIsBetter: false,
        verdict: (v) => (v <= 16 ? elite("Clean") : v <= 20 ? neutral() : poor("Leaky")),
        what: "Share of carries stopped at or behind the line of scrimmage.",
        why: "Dead carries kill drives and fantasy floors alike. Under 16% is a clean front; over 20% is a line that gets backs tackled in the backfield.",
        inApp: "10% of the O-line composite, inverted — lower is better.",
      },
      {
        key: "sackRateAdj",
        label: "Adjusted sack rate",
        scope: "team",
        read: (_p, t) => t?.sackRateAdj,
        format: (v) => pct(v, 1),
        higherIsBetter: false,
        verdict: (v) => (v <= 5.5 ? elite("Clean") : v <= 8 ? neutral() : poor("Leaky")),
        what: "Sacks allowed per dropback, adjusted for opponent and situation.",
        why: "The best pass-protection stat for fantasy: a sack is a dead play, and sack avoidance preserves the pass volume every receiver depends on. It explains more of WR output (R-squared about 0.21) than any blocking grade.",
        inApp: "New in the Stat Lab: the measured half of pass protection, next to the charted grade.",
      },
      {
        key: "pressureRate",
        label: "Pressure rate allowed",
        scope: "team",
        read: (_p, t) => t?.pressureRateAllowed,
        format: (v) => pct(v, 1),
        higherIsBetter: false,
        verdict: (v) => (v <= 22 ? elite("Clean") : v <= 28 ? good() : v <= 33 ? neutral() : poor("Leaky")),
        what: "Share of dropbacks where the quarterback is hurried, hit, or knocked down.",
        why: "Partly a line stat, partly a quarterback stat — QBs who hold the ball invite pressure. Read it with pocket time before blaming the front five.",
        inApp: "New in the Stat Lab, alongside average pocket time.",
      },
      {
        key: "passBlockGrade",
        label: "Pass block grade",
        scope: "team",
        read: (_p, t) => t?.passBlockGrade,
        format: (v) => num(v, 1),
        higherIsBetter: true,
        verdict: (v) => (v >= 78 ? elite() : v >= 70 ? good() : v >= 62 ? neutral() : poor("Weak")),
        what: "A 0-100 charting grade of the unit's pass protection.",
        why: "Matters less for fantasy than it looks: protection affects QB scoring only modestly, and mobile quarterbacks partially protect themselves. Use it as a tiebreaker, not a driver.",
        inApp: "30% of the O-line composite score.",
      },
      {
        key: "snapContinuity",
        label: "Line continuity",
        scope: "team",
        read: (_p, t) => t?.snapContinuity,
        format: (v) => pct(v, 0),
        higherIsBetter: true,
        verdict: (v) => (v >= 85 ? elite("Intact") : v >= 60 ? neutral("Turnover") : poor("Rebuilt")),
        what: "Share of last season's offensive line snaps returning this year.",
        why: "Cohesion beats talent on paper: lines that keep their five together block better than lines assembling new stars. Losing a left tackle or center measurably degrades the whole run game.",
        inApp: "15% of the composite and 60% of the OL health score; sets the team trend flag.",
      },
    ],
  },
  {
    key: "scheme",
    title: "Scheme & environment",
    blurb:
      "The coach decides how big the pie is and how it's sliced. Play-calling identity is one of the stickiest things in football — it transfers with the play-caller, not the roster.",
    stats: [
      {
        key: "proe",
        label: "Pass rate over expected",
        scope: "team",
        read: (_p, t) => t?.proe,
        format: (v) => (hasValue(v) ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : NO_DATA),
        higherIsBetter: true,
        verdict: (v) => (v >= 3 ? elite("Pass-heavy") : v <= -3 ? poor("Run-first") : neutral("Balanced")),
        what: "How much more (or less) the team passes than the game situation predicts, stripping out game script.",
        why: "Far stabler than raw pass rate and it follows the play-caller. Pass-heavy leans lift every receiver's target math; run-first leans concentrate value in the backfield.",
        inApp: "Shown on the O-Line page's team detail; a core input for reading target-share stats fairly.",
      },
      {
        key: "neutralPassRate",
        label: "Neutral pass rate",
        scope: "team",
        read: (_p, t) => t?.neutralPassRate,
        format: (v) => pct(v, 1),
        higherIsBetter: true,
        verdict: (v) => (v >= 60 ? elite("Pass-heavy") : v <= 48 ? poor("Run-first") : neutral("Balanced")),
        what: "Pass rate when the game is within one score — the coach's honest preference before the scoreboard forces anything.",
        why: "The cleanest single read on play-calling identity, and the denominator behind every share stat: a 25% target share means more on a team that throws.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "playsPerGame",
        label: "Plays per game",
        scope: "team",
        read: (_p, t) => t?.playsPerGame,
        format: (v) => num(v, 1),
        higherIsBetter: true,
        what: "Offensive snaps per game — the pace multiplier under everything.",
        why: "Volume is plays times share. A fast offense hands out more of everything; a slow one shrinks every role on the roster.",
        inApp: "Served with every team; the Stat Lab is the first place it renders.",
      },
      {
        key: "pointsPerGame",
        label: "Points per game",
        scope: "team",
        read: (_p, t) => t?.pointsPerGame,
        format: (v) => num(v, 1),
        higherIsBetter: true,
        what: "The offense's 2025 scoring rate.",
        why: "Touchdowns are budgeted at the team level first. Good offenses create scoring chances for everyone; a player on a bad offense needs an outsized share of a small pie.",
        inApp: "Served with every team; the Stat Lab is the first place it renders.",
      },
      {
        key: "rzTrips",
        label: "Red-zone trips / game",
        scope: "team",
        read: (_p, t) => t?.rzTripsPerGame,
        format: (v) => num(v, 2),
        higherIsBetter: true,
        what: "How often the offense reaches the opponent 20 per game.",
        why: "The touchdown budget in its rawest form — a player's red-zone role only cashes if the offense actually gets there.",
        inApp: "New in the Stat Lab; pairs with a player's own red-zone usage below.",
      },
      {
        key: "passEpa",
        label: "Pass EPA / play",
        scope: "team",
        read: (_p, t) => t?.passEpaPerPlay,
        format: (v) => (hasValue(v) ? `${v > 0 ? "+" : ""}${v.toFixed(3)}` : NO_DATA),
        higherIsBetter: true,
        verdict: (v) => (v >= 0.15 ? elite() : v >= 0.05 ? good() : v >= -0.05 ? neutral() : poor("Struggling")),
        what: "Expected points added per pass play — how much each dropback actually moved the scoreboard math.",
        why: "Offense quality correlates strongly with QB fantasy output, mildly with receivers, and barely at all with running backs. Use it to grade environments, not backs.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "rushEpa",
        label: "Rush EPA / play",
        scope: "team",
        read: (_p, t) => t?.rushEpaPerPlay,
        format: (v) => (hasValue(v) ? `${v > 0 ? "+" : ""}${v.toFixed(3)}` : NO_DATA),
        higherIsBetter: true,
        verdict: (v) => (v >= 0.02 ? elite() : v >= -0.05 ? neutral() : poor("Struggling")),
        what: "Expected points added per rush — almost always negative league-wide; near zero is genuinely good.",
        why: "A ground game that keeps the offense on schedule keeps the back on the field. It's a job-security signal more than a projection input.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "vacatedRz",
        label: "Vacated red-zone touches",
        scope: "team",
        read: (_p, t) => t?.vacatedRzPct,
        format: (v) => pct(v, 1),
        higherIsBetter: true,
        what: "Share of last season's red-zone touches that left the roster.",
        why: "Vacated scoring work is the most valuable kind of vacancy — someone inherits those touchdowns, and the market is often slow to price who.",
        inApp: "New in the Stat Lab, next to the overall vacated-opportunity number.",
      },
    ],
  },
  {
    key: "opportunity",
    title: "Opportunity",
    blurb:
      "Volume is king, and usage is the stickiest thing a player owns: target share and weighted usage repeat year over year far more reliably than any efficiency stat. Draft the opportunity; let efficiency regress.",
    stats: [
      {
        key: "share",
        label: "Target / carry share",
        scope: "player",
        positions: SKILL,
        read: (p) => p?.share,
        format: (v) => pct(v, 1),
        higherIsBetter: true,
        verdict: (v) => (v >= 25 ? elite("Alpha") : v >= 18 ? good("Starter") : v >= 12 ? neutral("Role") : poor("Ancillary")),
        what: "His slice of the team's targets (pass catchers) or carries (backs), counted only over weeks he actually played.",
        why: "The foundation of every projection. Target share is among the stickiest stats in football (year-over-year correlation around 0.55-0.70); 20%+ is where WR1 seasons live and 25%+ is alpha territory.",
        inApp: "On the board, the player page, and the committee test inside the sleeper engine.",
      },
      {
        key: "wopr",
        label: "WOPR",
        scope: "player",
        positions: ["WR", "TE"],
        read: (p) => p?.advanced.wopr,
        format: (v) => num(v, 2),
        higherIsBetter: true,
        verdict: (v) => (v >= 0.7 ? elite("Alpha") : v >= 0.6 ? good("WR1") : v >= 0.45 ? neutral("Startable") : poor("Thin")),
        what: "Weighted Opportunity Rating: 1.5 x target share + 0.7 x air-yards share — volume and depth of role in one number.",
        why: "The classic one-number usage screen. It predicts next-year fantasy points with a correlation above 0.70 — better than almost any other single receiving stat.",
        inApp: "New in the Stat Lab — the headline usage number for receivers.",
      },
      {
        key: "airYardsShare",
        label: "Air yards share",
        scope: "player",
        positions: ["WR", "TE"],
        read: (p) => p?.advanced.airYardsShare,
        format: (v) => pct(v, 1),
        higherIsBetter: true,
        verdict: (v) => (v >= 30 ? elite("Dominant") : v >= 20 ? good() : v >= 12 ? neutral() : poor("Shallow")),
        what: "His share of the team's intended downfield yardage — every pass thrown his way counts, caught or not.",
        why: "Air yards are almost pure quarterback-and-coach intent, and the intent is sticky. High air-yard share with modest actual yardage is the classic buy-low profile.",
        inApp: "New in the Stat Lab; feeds WOPR above.",
      },
      {
        key: "adot",
        label: "aDOT",
        scope: "player",
        positions: ["WR", "TE"],
        read: (p) => p?.advanced.adot,
        format: (v) => num(v, 1),
        higherIsBetter: true,
        verdict: (v) => (v >= 13 ? neutral("Vertical") : v >= 8 ? neutral("Intermediate") : neutral("Underneath")),
        what: "Average depth of target, in air yards.",
        why: "Not better or worse — an archetype. Deep aDOT means spike weeks and touchdown dependence; shallow aDOT means catch volume and a PPR floor. Read every efficiency stat against it.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "targetsPerGame",
        label: "Targets / game",
        scope: "player",
        positions: CATCHERS,
        read: (p) => p?.advanced.targetsPerGame,
        format: (v) => num(v, 1),
        higherIsBetter: true,
        verdict: (v) => (v >= 8 ? elite() : v >= 6 ? good() : v >= 4 ? neutral() : poor("Thin")),
        what: "Raw targets per game played.",
        why: "The most predictable counting stat there is, and for backs it's gold: a reception is worth roughly 2.5-2.9 carries in PPR, and 5+ targets a game is an elite RB floor.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "carriesPerGame",
        label: "Carries / game",
        scope: "player",
        positions: ["RB", "QB"],
        read: (p) => p?.advanced.carriesPerGame,
        format: (v) => num(v, 1),
        higherIsBetter: true,
        verdict: (v) => (v >= 15 ? elite("Workhorse") : v >= 10 ? good() : v >= 5 ? neutral() : poor("Light")),
        what: "Raw carries per game played.",
        why: "For backs, the volume backbone. For quarterbacks it's the Konami code: a rushing yard scores 2.5x a passing yard, and rushing volume is the most predictive QB fantasy stat of all.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "snapShare",
        label: "Snap share",
        scope: "player",
        positions: SKILL,
        read: (p) => p?.snapShare,
        format: (v) => pct(v, 0),
        higherIsBetter: true,
        verdict: (v) => (v >= 70 ? elite("Bell-cow") : v >= 55 ? good() : v >= 40 ? neutral("Rotation") : poor("Part-time")),
        what: "Share of offensive snaps played, over games he was active.",
        why: "Only four or five backs a year sustain 70%+ — the bell-cow tier is scarce and that scarcity is the argument for paying up. Below 50% is a committee by definition.",
        inApp: "Half of the durability score; shown on the player page.",
      },
      {
        key: "rzOpps",
        label: "Red-zone opportunities",
        scope: "player",
        positions: SKILL,
        read: (p) => p?.advanced.rzOpportunities,
        format: (v) => (hasValue(v) ? String(Math.round(v)) : NO_DATA),
        higherIsBetter: true,
        verdict: (v) => (v >= 40 ? elite() : v >= 25 ? good() : v >= 12 ? neutral() : poor("Sparse")),
        what: "Touches and targets inside the opponent 20 across the season.",
        why: "Where touchdowns come from. The role is sticky within a season even though the conversion isn't — own the role, not last year's spike.",
        inApp: "New in the Stat Lab; the volume behind expected touchdowns below.",
      },
      {
        key: "inside5",
        label: "Inside-5 touches",
        scope: "player",
        positions: SKILL,
        read: (p) => p?.advanced.inside5Touches,
        format: (v) => (hasValue(v) ? String(Math.round(v)) : NO_DATA),
        higherIsBetter: true,
        verdict: (v) => (v >= 15 ? elite("Goal-line back") : v >= 8 ? good() : v >= 3 ? neutral() : poor("Rare")),
        what: "Touches from the opponent's 5-yard line in.",
        why: "About two-thirds of rushing touchdowns are scored from inside the five, and a carry from the one converts about half the time. Whoever owns this role in a committee owns the touchdowns.",
        inApp: "New in the Stat Lab.",
      },
    ],
  },
  {
    key: "efficiency",
    title: "Efficiency",
    blurb:
      "What he did with the chances. Most efficiency regresses toward the middle — so use these to explain a season and to spot mispriced talent, not to project volume that isn't there.",
    stats: [
      {
        key: "ryoePerAtt",
        label: "RYOE / attempt",
        scope: "player",
        positions: ["RB"],
        read: (p) => p?.advanced.ryoePerAtt,
        format: (v) => (hasValue(v) ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : NO_DATA),
        higherIsBetter: true,
        verdict: (v) => (v >= 0.5 ? elite() : v >= 0 ? good() : v >= -0.5 ? neutral() : poor("Concerning")),
        what: "Rushing yards over what tracking data expected from each carry's blocking, box count, and geometry.",
        why: "The cleanest way to separate a back from his line — it survives a team change. But it barely repeats year to year, so treat it as context: negative RYOE on big volume flags a job at risk, not a projection.",
        inApp: "The total version drives the sleeper engine's efficiency signal and the player radar.",
      },
      {
        key: "yacOverExpected",
        label: "YAC over expected",
        scope: "player",
        positions: CATCHERS,
        read: (p) => p?.advanced.yacOverExpected,
        format: (v) => (hasValue(v) ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : NO_DATA),
        higherIsBetter: true,
        verdict: (v) => (v >= 1 ? elite("Playmaker") : v >= 0.3 ? good() : v >= -0.3 ? neutral() : poor()),
        what: "Yards after the catch beyond what tracking expected from the catch situation — credits the runner, not the scheme.",
        why: "Separates real playmaking from screen-game inflation. Sustained +1.0 per catch is elite; for back receiving work it's among the most predictive receiving skills.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "racr",
        label: "RACR",
        scope: "player",
        positions: ["WR", "TE"],
        read: (p) => {
          const v = p?.advanced.racr;
          // Tiny air-yard denominators produce absurd ratios; hide them.
          return hasValue(v) && Math.abs(v) <= 3 ? v : null;
        },
        format: (v) => num(v, 2),
        higherIsBetter: true,
        verdict: (v) => (v >= 1 ? elite("Converter") : v >= 0.85 ? good() : v >= 0.6 ? neutral() : poor("Leaves yards")),
        what: "Receiving yards per air yard thrown at him — catch rate and yards-after-catch rolled into one conversion number.",
        why: "Read it against aDOT: shallow targets convert easily. High air yards with a low RACR is the buy-low screen; a sky-high RACR on thin volume is regression waiting.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "pointsPerOpp",
        label: "Points / opportunity",
        scope: "player",
        positions: SKILL,
        read: (p) => p?.advanced.pointsPerOpportunity,
        format: (v) => num(v, 2),
        higherIsBetter: true,
        what: "PPR points per carry-or-target.",
        why: "The simplest efficiency lens: a target is worth almost three carries, so this rewards touch quality as much as talent. Big gaps from position peers usually mean role, not skill.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "recEpa",
        label: "EPA / target",
        scope: "player",
        positions: CATCHERS,
        read: (p) => p?.advanced.recEpaPerTarget,
        format: (v) => (hasValue(v) ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : NO_DATA),
        higherIsBetter: true,
        verdict: (v) => (v >= 0.5 ? elite() : v >= 0.2 ? good() : v >= 0 ? neutral() : poor("Drag")),
        what: "Expected points added per target — how much each look actually helped the offense.",
        why: "Coaches feed players who move the chains; efficiency this granular is a job-security signal. It's descriptive, so pair it with the usage stats above before drawing conclusions.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "rushEpaAtt",
        label: "EPA / rush",
        scope: "player",
        positions: ["RB", "QB"],
        read: (p) => p?.advanced.rushEpaPerAtt,
        format: (v) => (hasValue(v) ? `${v > 0 ? "+" : ""}${v.toFixed(3)}` : NO_DATA),
        higherIsBetter: true,
        verdict: (v) => (v >= 0 ? elite() : v >= -0.06 ? neutral() : poor("Drag")),
        what: "Expected points added per carry. League-wide this is negative — running is inefficient — so anything at or above zero is excellent.",
        why: "Barely predicts next season's fantasy points, but it predicts whether the coaching staff has a reason to change the touch distribution.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "brokenTackles",
        label: "Broken tackles",
        scope: "player",
        positions: SKILL,
        read: (p) => p?.advanced.brokenTackles,
        format: (v) => (hasValue(v) ? String(Math.round(v)) : NO_DATA),
        higherIsBetter: true,
        what: "Tackles broken across carries and receptions combined.",
        why: "Tackle-breaking is one of the stickiest pure-skill signals a runner has (year-over-year correlation about 0.43) — the preferred talent screen for young backs stuck in committees.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "dropPct",
        label: "Drop rate",
        scope: "player",
        positions: CATCHERS,
        read: (p) => p?.advanced.dropPct,
        format: (v) => pct(v, 1),
        higherIsBetter: false,
        verdict: (v) => (v <= 3 ? elite("Reliable") : v <= 6 ? neutral() : poor("Droppy")),
        what: "Drops per target.",
        why: "Mostly noise year to year, but a bad drop season suppresses next season's price — which makes it a source of discounts more than a real warning.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "separation",
        label: "Separation",
        scope: "player",
        positions: ["WR", "TE"],
        read: (p) => p?.nextGen.separation,
        format: (v) => num(v, 2),
        higherIsBetter: true,
        what: "Average yards from the nearest defender when the ball arrives.",
        why: "Weaker than it sounds: slot and short routes inflate it, so it correlates poorly with fantasy points on its own. The sleeper engine only trusts it at an extreme.",
        inApp: "Player radar; a 3.2+ reading scores in the sleeper engine.",
      },
      {
        key: "catchPct",
        label: "Catch rate",
        scope: "player",
        positions: CATCHERS,
        read: (p) => p?.nextGen.catchPct,
        format: (v) => pct(v, 1),
        higherIsBetter: true,
        what: "Receptions per target.",
        why: "Almost entirely a function of target depth — read it against aDOT. A deep threat catching 55% can be doing his job perfectly.",
        inApp: "Player radar.",
      },
    ],
  },
  {
    key: "conversion",
    title: "Scoring conversion",
    blurb:
      "Touchdowns are the loudest and least reliable points on the board. Expected touchdowns price the role; the gap between actual and expected is next season's regression, in either direction.",
    stats: [
      {
        key: "expectedTds",
        label: "Expected TDs",
        scope: "player",
        positions: SKILL,
        read: (p) => p?.advanced.expectedTds,
        format: (v) => num(v, 1),
        higherIsBetter: true,
        verdict: (v) => (v >= 10 ? elite("TD engine") : v >= 6 ? good() : v >= 3 ? neutral() : poor("Sparse")),
        what: "Touchdowns a league-average player would have scored from the same touches in the same spots.",
        why: "Expected touchdowns predict next season's touchdowns better than actual touchdowns do — the role is real even when the bounces aren't.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "tdOverExpected",
        label: "TDs over expected",
        scope: "player",
        positions: SKILL,
        read: (p) => p?.advanced.tdOverExpected,
        format: (v) => (hasValue(v) ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : NO_DATA),
        higherIsBetter: false,
        verdict: (v) =>
          v >= 3
            ? poor("Fade risk")
            : v <= -3
              ? elite("Buy signal")
              : v <= -1
                ? good("Underpaid")
                : neutral("Fair"),
        what: "Actual minus expected touchdowns, signed. Here, extreme positive is the warning and extreme negative is the opportunity.",
        why: "Touchdown luck regresses violently: of the biggest overperformers in a decade of seasons, almost none repeated (average decline about half their TDs), while most big underperformers bounced back.",
        inApp: "New in the Stat Lab — the platform's first explicit regression flag.",
      },
    ],
  },
  {
    key: "shape",
    title: "Weekly shape & availability",
    blurb:
      "Season totals hide how the points arrived. Two players with the same average can be a steady floor and a coin-flip — and you feel the difference every week.",
    stats: [
      {
        key: "median",
        label: "Weekly median",
        scope: "player",
        positions: [...SKILL, "QB"],
        read: (p) => p?.consistency.median,
        format: (v) => num(v, 1),
        higherIsBetter: true,
        what: "The middle weekly PPR score — the honest 'typical week'.",
        why: "Averages get dragged around by two big games; the median is what he actually gives you most Sundays.",
        inApp: "Consistency profile on the player page; the boom test in the sleeper engine.",
      },
      {
        key: "ceiling",
        label: "Weekly ceiling",
        scope: "player",
        positions: [...SKILL, "QB"],
        read: (p) => p?.consistency.ceiling,
        format: (v) => num(v, 1),
        higherIsBetter: true,
        what: "His best weekly score.",
        why: "Ceilings win weeks. A ceiling at 2.2x the median on a real median is the boom profile the sleeper engine hunts.",
        inApp: "Consistency profile; the sleeper engine's boom tag.",
      },
      {
        key: "weeklyStdev",
        label: "Weekly volatility",
        scope: "player",
        positions: [...SKILL, "QB"],
        read: (p) => p?.advanced.weeklyStdev,
        format: (v) => num(v, 1),
        higherIsBetter: false,
        what: "Standard deviation of weekly scores — the swing.",
        why: "Volatility is a strategy choice, not a flaw: you want steadiness from early picks and volatility from late ones, because a late pick's steady outcome is just steady mediocrity.",
        inApp: "New in the Stat Lab.",
      },
      {
        key: "boomRate",
        label: "Boom rate",
        scope: "player",
        positions: [...SKILL, "QB"],
        read: (p) => p?.consistency.boomRate,
        format: (v) => pct(v, 0),
        higherIsBetter: true,
        what: "Share of weeks that cleared a boom threshold.",
        why: "How often he wins you the week outright.",
        inApp: "Consistency profile on the player page.",
      },
      {
        key: "bustRate",
        label: "Bust rate",
        scope: "player",
        positions: [...SKILL, "QB"],
        read: (p) => p?.consistency.bustRate,
        format: (v) => pct(v, 0),
        higherIsBetter: false,
        what: "Share of weeks below a bust threshold.",
        why: "How often he loses the week from your lineup — the floor risk you're actually carrying.",
        inApp: "Consistency profile on the player page.",
      },
      {
        key: "durability",
        label: "Durability",
        scope: "player",
        positions: [...SKILL, "QB"],
        read: (p) => p?.durabilityScore,
        format: (v) => (hasValue(v) ? `${Math.round(v)}` : NO_DATA),
        higherIsBetter: true,
        verdict: (v) => (v >= 85 ? elite("Iron") : v >= 65 ? good() : v >= 45 ? neutral() : poor("Fragile")),
        what: "A 0-100 availability read: games played and how heavily he played in them.",
        why: "The best ability is availability — missed weeks are zeros no efficiency can buy back.",
        inApp: "Computed by the platform; shown on the player page header.",
      },
    ],
  },
  {
    key: "market",
    title: "The market",
    blurb:
      "Every stat above only makes you money where the market disagrees. Price is the last link in the chain — the edge is production the room is not paying for.",
    stats: [
      {
        key: "adp",
        label: "Consensus ADP",
        scope: "player",
        positions: [...SKILL, "QB"],
        read: (p) => (p ? (p.adpConsensus ?? p.adp) : null),
        format: (v) => num(v, 1),
        higherIsBetter: false,
        what: "Average draft position across every source the platform tracks — mock drafts, Sleeper, ESPN, and the dataset.",
        why: "The market's bid. Everything on this page is measured against it: a great stat at a fair price is not an edge.",
        inApp: "Everywhere — the board, the sheet, availability math in the pick suggester.",
      },
      {
        key: "valueScore",
        label: "Value score",
        scope: "player",
        positions: [...SKILL, "QB"],
        read: (p) => (p ? (p.valueScoreConsensus ?? p.valueScore) : null),
        format: (v) => fmtValueScore(v),
        higherIsBetter: true,
        verdict: (v) => (v >= 0.5 ? elite("Discount") : v <= -0.5 ? poor("Premium") : neutral("Fair")),
        what: "Last year's positional finish versus this year's price, in standard deviations. Positive means the market is charging less than he produced.",
        why: "The platform's own mispricing signal. Beyond +0.5 SD is a real discount; beyond -0.5 SD you are paying for a story.",
        inApp: "The Value column, draft-sheet targets, the O-line impact quadrants, and the pick suggester.",
      },
      {
        key: "aav",
        label: "Auction value",
        scope: "player",
        positions: [...SKILL, "QB"],
        read: (p) => p?.aav,
        format: (v) => (hasValue(v) ? `$${Math.round(v)}` : NO_DATA),
        higherIsBetter: true,
        what: "Average auction price in live ESPN drafts.",
        why: "The same market bid, in dollars — the reference point for auction leagues.",
        inApp: "Board and draft sheet.",
      },
    ],
  },
];

/** Percentile of a value inside a pool, direction-aware. 100 = best. */
function percentile(value: number, pool: number[], higherIsBetter: boolean): number | null {
  if (pool.length < 2) return null;
  const below = pool.filter((entry) => (higherIsBetter ? entry < value : entry > value)).length;
  return Math.round((below / (pool.length - 1)) * 100);
}

const TONE_CLASSES: Record<Verdict["tone"], string> = {
  elite: "bg-primary/12 text-primary",
  good: "bg-accent/15 text-accent",
  neutral: "bg-muted text-muted-foreground",
  poor: "bg-destructive/12 text-destructive",
};

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </span>
  );
}

function VerdictChip({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`mono rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${TONE_CLASSES[verdict.tone]}`}
    >
      {verdict.label}
    </span>
  );
}

/**
 * Whose number this is. Team stats repeat identically for every player on
 * the roster — labelling them keeps two teammates' breakdowns from reading
 * as a data bug when their trench and scheme rows match.
 */
function ScopeChip({ scope, team }: { scope: StatDef["scope"]; team?: string | null }) {
  if (scope === "player") {
    return (
      <span className="mono rounded border border-primary/25 bg-primary/8 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-primary">
        player
      </span>
    );
  }
  return (
    <span className="mono rounded border border-border bg-muted px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-muted-foreground">
      team{team ? ` · ${team}` : ""}
    </span>
  );
}

/** min-median-max strip with the league's spread for one stat. */
function RangeStrip({ values, format }: { values: number[]; format: StatDef["format"] }) {
  if (values.length === 0) {
    return <span className="mono text-[10px] text-muted-foreground">{NO_DATA}</span>;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return (
    <span className="mono flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span>{format(sorted[0])}</span>
      <span className="h-px w-4 bg-border" />
      <span className="font-bold text-foreground">{format(median)}</span>
      <span className="h-px w-4 bg-border" />
      <span>{format(sorted[sorted.length - 1])}</span>
    </span>
  );
}

function PercentileBar({ value }: { value: number | null }) {
  if (value === null) return <div className="h-1.5 rounded-full bg-muted" />;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full ${value >= 80 ? "bg-primary" : value >= 40 ? "bg-accent" : "bg-destructive/60"}`}
        style={{ width: `${Math.max(4, value)}%` }}
      />
    </div>
  );
}

/** One stat inside the field-guide view: league range, leaders, and the read. */
function GuideStat({
  stat,
  players,
  teams,
}: {
  stat: StatDef;
  players: Player[];
  teams: Team[];
}) {
  const [open, setOpen] = useState(false);

  const { values, leaders } = useMemo(() => {
    if (stat.scope === "team") {
      const entries = teams
        .map((team) => ({ name: team.team, value: stat.read(null, team) }))
        .filter((entry): entry is { name: string; value: number } => hasValue(entry.value));
      entries.sort((a, b) => (stat.higherIsBetter ? b.value - a.value : a.value - b.value));
      return { values: entries.map((entry) => entry.value), leaders: entries.slice(0, 3) };
    }
    const pool = stat.positions
      ? players.filter((player) => stat.positions?.includes(player.position))
      : players;
    const entries = pool
      .map((player) => ({ name: player.name, value: stat.read(player, null) }))
      .filter((entry): entry is { name: string; value: number } => hasValue(entry.value));
    entries.sort((a, b) => (stat.higherIsBetter ? b.value - a.value : a.value - b.value));
    return { values: entries.map((entry) => entry.value), leaders: entries.slice(0, 3) };
  }, [stat, players, teams]);

  return (
    <div className="rounded-xl border border-border bg-card p-3.5" data-testid={`guide-stat-${stat.key}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
        data-testid={`button-guide-${stat.key}`}
      >
        <span className="min-w-[150px] text-[12px] font-bold">{stat.label}</span>
        <ScopeChip scope={stat.scope} />
        {stat.positions && (
          <span className="mono text-[9px] uppercase text-muted-foreground">
            {stat.positions.join("/")}
          </span>
        )}
        {!stat.higherIsBetter && stat.key !== "adp" && (
          <span className="mono text-[9px] uppercase text-muted-foreground">lower is better</span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <RangeStrip values={values} format={stat.format} />
        </span>
      </button>
      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{stat.what}</p>
      {open && (
        <div className="mt-2 space-y-2 border-t border-border/60 pt-2 text-[11px] leading-4">
          <p>
            <span className="font-bold text-primary">Why it matters · </span>
            <span className="text-muted-foreground">{stat.why}</span>
          </p>
          <p>
            <span className="font-bold text-accent">In the Draft Room · </span>
            <span className="text-muted-foreground">{stat.inApp}</span>
          </p>
          {leaders.length > 0 && (
            <p className="mono text-[10px] text-muted-foreground">
              {stat.higherIsBetter ? "Leaders" : "Best"}:{" "}
              {leaders.map((entry, index) => (
                <span key={entry.name}>
                  {index > 0 && " · "}
                  <span className="font-semibold text-foreground">{entry.name}</span>{" "}
                  {stat.format(entry.value)}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** One stat row inside the player-breakdown view. */
function BreakdownRow({
  stat,
  player,
  team,
  players,
  teams,
}: {
  stat: StatDef;
  player: Player;
  team: Team | null;
  players: Player[];
  teams: Team[];
}) {
  const [open, setOpen] = useState(false);
  const value = stat.read(player, team);

  const pctile = useMemo(() => {
    if (!hasValue(value)) return null;
    if (stat.scope === "team") {
      const pool = teams
        .map((entry) => stat.read(null, entry))
        .filter((entry): entry is number => hasValue(entry));
      return percentile(value, pool, stat.higherIsBetter);
    }
    const pool = players
      .filter((entry) => entry.position === player.position)
      .map((entry) => stat.read(entry, null))
      .filter((entry): entry is number => hasValue(entry));
    return percentile(value, pool, stat.higherIsBetter);
  }, [stat, value, player, players, teams]);

  const verdict = hasValue(value) && stat.verdict ? stat.verdict(value) : null;

  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2" data-testid={`breakdown-${stat.key}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="grid w-full grid-cols-[minmax(120px,1.4fr)_minmax(52px,auto)_minmax(0,2fr)_minmax(60px,auto)] items-center gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold">
          <span className="truncate">{stat.label}</span>
          <ScopeChip scope={stat.scope} team={team?.team} />
        </span>
        <span className="mono text-right text-[11px] font-bold">{stat.format(value)}</span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <PercentileBar value={pctile} />
          </span>
          <span className="mono w-9 shrink-0 text-right text-[9px] text-muted-foreground">
            {pctile === null ? NO_DATA : `p${pctile}`}
          </span>
        </span>
        <span className="text-right">
          {verdict ? <VerdictChip verdict={verdict} /> : <span className="mono text-[9px] text-muted-foreground" />}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2 text-[11px] leading-4 text-muted-foreground">
          <p>{stat.what}</p>
          <p>
            <span className="font-bold text-primary">Why it matters · </span>
            {stat.why}
          </p>
        </div>
      )}
    </div>
  );
}

function PlayerBreakdown({
  player,
  players,
  teams,
}: {
  player: Player;
  players: Player[];
  teams: Team[];
}) {
  const team = teams.find((entry) => entry.team === player.team) ?? null;

  const stages = STAGES.map((stage) => ({
    ...stage,
    stats: stage.stats.filter(
      (stat) =>
        stat.scope === "team" || !stat.positions || stat.positions.includes(player.position),
    ),
  })).filter((stage) => stage.stats.length > 0);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm" data-testid="panel-breakdown-header">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Kicker>
              {player.position} · {player.team} · rank #{player.rank}
            </Kicker>
            <h2 className="display mt-1 text-xl font-bold tracking-[-0.02em]">{player.name}</h2>
          </div>
          <div className="mono flex gap-4 text-[11px] text-muted-foreground">
            <span>
              ADP <span className="font-bold text-foreground">{num(player.adpConsensus ?? player.adp, 1)}</span>
            </span>
            <span>
              PPG <span className="font-bold text-foreground">{num(player.ppg, 1)}</span>
            </span>
            <span>
              Value{" "}
              <span className="font-bold text-foreground">
                {fmtValueScore(player.valueScoreConsensus ?? player.valueScore)}
              </span>
            </span>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          Every link in his chain, from the line that blocks for him to the price the room is
          paying. Rows tagged <span className="mono text-[10px] uppercase">player</span> are his
          own numbers; rows tagged <span className="mono text-[10px] uppercase">team</span> are
          {" "}{player.team} context every teammate inherits. Bars are percentiles against other{" "}
          {player.position}s on the board (team stats rank against the other 31 lines); click any
          row for the reading.
        </p>
      </div>

      {stages.map((stage) => {
        const allTeamScope = stage.stats.every((stat) => stat.scope === "team");
        return (
          <section
            key={stage.key}
            className="rounded-2xl border border-border bg-card p-5 shadow-sm"
            data-testid={`breakdown-stage-${stage.key}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Kicker>{stage.title}</Kicker>
              {allTeamScope && (
                <span className="mono rounded bg-muted px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  inherited — every {player.team} player shares these
                </span>
              )}
            </div>
            <div className="mt-3 space-y-2">
              {stage.stats.map((stat) => (
                <BreakdownRow
                  key={stat.key}
                  stat={stat}
                  player={player}
                  team={team}
                  players={players}
                  teams={teams}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function StatLabPage() {
  const { data: players } = useGetPlayers();
  const { data: teams } = useGetTeams();
  const [view, setView] = useState<"chain" | "player">("chain");
  const [search, setSearch] = useState("");
  // Only the id is held; the player object is re-derived from the live query
  // every render, so a refresh mid-session updates the open breakdown too.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allPlayers = useMemo(() => players ?? [], [players]);
  const allTeams = useMemo(() => teams ?? [], [teams]);
  const selected = useMemo(
    () => allPlayers.find((player) => player.id === selectedId) ?? null,
    [allPlayers, selectedId],
  );

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length < 2) return [];
    return allPlayers.filter((player) => player.name.toLowerCase().includes(query)).slice(0, 7);
  }, [allPlayers, search]);

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <Kicker>How the numbers become points</Kicker>
          <h1 className="display mt-1.5 text-[27px] font-bold tracking-[-0.04em] sm:text-[32px]">
            Stat Lab
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            The causal chain from the offensive line to target share to fantasy points — what each
            stat means, how much to trust it, and where one player sits on every link.
          </p>
        </div>
        <FlaskConical size={20} className="shrink-0 text-accent" />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(
          [
            { value: "chain", label: "The chain" },
            { value: "player", label: "Player breakdown" },
          ] as const
        ).map((entry) => (
          <button
            type="button"
            key={entry.value}
            onClick={() => setView(entry.value)}
            data-testid={`button-lab-view-${entry.value}`}
            className={`shrink-0 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
              view === entry.value
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {entry.label}
          </button>
        ))}
        {view === "player" && (
          <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={selected ? selected.name : search}
              onChange={(event) => {
                setSelectedId(null);
                setSearch(event.target.value);
              }}
              placeholder="Search the 250-player board"
              data-testid="input-lab-player-search"
              className="mono w-full rounded-xl border border-border bg-card py-2 pl-8 pr-3 text-[12px] font-medium focus:border-primary/50 focus:outline-none"
            />
            {matches.length > 0 && !selected && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-lg">
                {matches.map((player) => (
                  <button
                    type="button"
                    key={player.id}
                    onClick={() => {
                      setSelectedId(player.id);
                      setSearch("");
                    }}
                    data-testid={`button-lab-candidate-${player.id}`}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-muted"
                  >
                    <span className="mono w-8 text-[10px] text-muted-foreground">{player.position}</span>
                    <span className="font-semibold">{player.name}</span>
                    <span className="mono ml-auto text-[10px] text-muted-foreground">{player.team}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {view === "chain" ? (
        <div className="space-y-5">
          {STAGES.map((stage, index) => (
            <section
              key={stage.key}
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
              data-testid={`stage-${stage.key}`}
            >
              <div className="flex items-baseline gap-3">
                <span className="mono text-[18px] font-bold text-primary/40">{index + 1}</span>
                <div>
                  <h2 className="text-sm font-bold">{stage.title}</h2>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{stage.blurb}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-2.5 lg:grid-cols-2">
                {stage.stats.map((stat) => (
                  <GuideStat key={stat.key} stat={stat} players={allPlayers} teams={allTeams} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : selected ? (
        <PlayerBreakdown player={selected} players={allPlayers} teams={allTeams} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center" data-testid="empty-lab-player">
          <p className="text-sm font-semibold">Pick a player to break down</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Search the board above — you'll get his full chain, percentile by percentile, from his
            line's blocking to the price the market wants.
          </p>
        </div>
      )}
    </div>
  );
}
