import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

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
