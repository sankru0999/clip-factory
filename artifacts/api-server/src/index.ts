import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

logger.info({ rawPort, env: process.env.NODE_ENV }, "Starting server...");

if (!rawPort) {
  logger.error("PORT environment variable is required but was not provided");
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  logger.error({ rawPort }, `Invalid PORT value`);
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

logger.info({ port }, "Attempting to listen on port");

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening successfully");
});
