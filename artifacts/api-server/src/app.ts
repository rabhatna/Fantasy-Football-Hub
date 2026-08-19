import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { serveWebApp } from "./lib/static-site";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Only the Vite dev server talks to this from another origin; the packaged
// app is same-origin, so this is a development affordance rather than policy.
app.use(cors({ origin: process.env["CORS_ORIGIN"] ?? true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Any /api route that fell through is a missing endpoint, not a page. This
// must sit before the SPA fallback or a typo'd API call would be answered
// with index.html and surface as a JSON parse error in the client.
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Mounted last: the SPA answers everything the API did not.
serveWebApp(app);

// A write to the draft board failing is the one error the user must not miss:
// the UI decides whether to warn based on this response, so it has to be a
// clean JSON 500 rather than Express's default HTML stack trace.
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  req.log?.error({ err }, "Unhandled error");

  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(500).json({ error: "Internal server error" });
});

export default app;
