import app from "./app";
import { logger } from "./lib/logger";

// Defaults to 8080 so the server runs locally with no environment configured.
const port = Number(process.env["PORT"] ?? 8080);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

// Bind to loopback by default; the container sets HOST=0.0.0.0 so the port
// can be published to the desktop.
const host = process.env["HOST"] ?? "127.0.0.1";

app.listen(port, host, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, host }, "Server listening");
});
