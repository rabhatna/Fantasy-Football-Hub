// Regenerate the README screenshots (docs/screenshots/) with headless Chrome.
//
// Serve a clean build first so the shots show a fresh first-boot state, then
// run a refresh so the live badges and news have data:
//
//   DATA_DIR=$(mktemp -d) pnpm run serve &
//   curl -X POST http://localhost:8080/api/data/refresh
//   node docs/capture-screenshots.mjs docs/screenshots
//
// Env: BASE (app origin, default http://localhost:8080),
//      CHROME (browser binary, defaults to macOS Google Chrome).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

const CHROME =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE ?? "http://localhost:8080";
const DEBUG_PORT = 9333;
const OUT = process.argv[2] ?? "docs/screenshots";
const SHOTS = [
  ["/", "draft-room.png"],
  ["/players/00-0036900", "player-deep-dive.png"],
  ["/plan", "draft-hq.png"],
  ["/stats", "stat-lab.png"],
  ["/sleepers", "sleepers.png"],
  ["/ol-center", "o-line.png"],
  ["/news", "signal.png"],
];

mkdirSync(OUT, { recursive: true });

const profile = path.join(OUT, ".chrome-profile");
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browserWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      return (await res.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome debug port never came up");
}

const ws = new WebSocket(await browserWs());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    data.error ? reject(new Error(data.error.message)) : resolve(data.result);
  } else if (data.method) {
    events.push(data);
  }
};

function send(method, params = {}, sessionId) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function waitEvent(method, sessionId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const i = events.findIndex(
      (e) => e.method === method && e.sessionId === sessionId,
    );
    if (i >= 0) return events.splice(i, 1)[0];
    await sleep(100);
  }
  return null; // fall through — the settle sleep still runs
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", {
  targetId,
  flatten: true,
});

await send("Page.enable", {}, sessionId);
await send(
  "Emulation.setDeviceMetricsOverride",
  { width: 1560, height: 960, deviceScaleFactor: 2, mobile: false },
  sessionId,
);
// The theme toggle persists to localStorage; seed it so shots come out dark.
await send(
  "Page.addScriptToEvaluateOnNewDocument",
  { source: `localStorage.setItem("draft-command-center:theme", "dark");` },
  sessionId,
);

for (const [route, file] of SHOTS) {
  events.length = 0;
  await send("Page.navigate", { url: BASE + route }, sessionId);
  await waitEvent("Page.loadEventFired", sessionId);
  await sleep(4000); // let queries resolve and charts paint
  const { data } = await send(
    "Page.captureScreenshot",
    { format: "png" },
    sessionId,
  );
  writeFileSync(path.join(OUT, file), Buffer.from(data, "base64"));
  console.log(`captured ${route} -> ${file}`);
}

ws.close();
chrome.kill();
rmSync(profile, { recursive: true, force: true });
