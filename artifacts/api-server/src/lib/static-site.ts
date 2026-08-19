import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express, type Request, type Response } from "express";
import { logger } from "./logger";

/**
 * Where the built dashboard lands.
 *
 * The server is bundled to artifacts/api-server/dist/index.mjs, so the built
 * SPA sits two directories up. WEB_DIST overrides it for anyone laying the
 * build out differently.
 */
export function resolveWebDist(): string {
  const configured = process.env["WEB_DIST"];
  if (configured) return path.resolve(configured);

  return path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "fantasy-draft-dashboard",
    "dist",
    "public",
  );
}

/**
 * Serve the built dashboard from the same origin and port as the API.
 *
 * Running one process removes the split-origin setup the app inherited: no
 * CORS, no proxy, no second port to remember — just http://localhost:8080.
 * In development the dashboard still runs under Vite for hot reload and
 * proxies /api here, so this path is only used by the packaged app.
 *
 * Must be mounted *after* the /api router, so an unknown API route still
 * returns a JSON 404 instead of being answered with the SPA's index.html.
 */
export function serveWebApp(app: Express): void {
  const webDist = resolveWebDist();
  const indexHtml = path.join(webDist, "index.html");

  if (!existsSync(indexHtml)) {
    // Not fatal: the API is still fully usable, and this is the normal state
    // in development. Say so clearly rather than 404ing mysteriously later.
    logger.warn(
      { webDist },
      "No built dashboard found; serving the API only. Run `pnpm run build` to bundle the web app.",
    );
    return;
  }

  app.use(
    express.static(webDist, {
      // Asset filenames carry a content hash, so they can be cached hard.
      // index.html must not be, or a rebuild keeps serving the old asset refs.
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  // History fallback for client-side routes (/teams, /players/:id): the SPA
  // owns routing, so any non-API GET that did not match a real file gets
  // index.html and lets the router take over.
  //
  // Written as middleware rather than app.get("*"): Express 5 upgraded
  // path-to-regexp, and a bare "*" is no longer a valid path pattern.
  app.use((req: Request, res: Response, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();

    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml, (err) => {
      if (err) next(err);
    });
  });

  logger.info({ webDist }, "Serving the dashboard from the API process");
}
