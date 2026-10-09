import { createSignalingServer } from "./signaling-server";
import { logger } from "./logger";

const PORT = parseInt(process.env.SIGNALING_PORT || process.env.PORT || "3001", 10);
const HOST = process.env.SIGNALING_HOST || process.env.HOST || "0.0.0.0";

const server = createSignalingServer({
  port: PORT,
  host: HOST,
});

server
  .start(PORT, HOST)
  .then((actualPort) => {
    logger.info("TR Presentation ShareHub Signaling Server started", {
      port: actualPort,
      host: HOST,
      nodeEnv: process.env.NODE_ENV || "development",
      healthUrl: `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${actualPort}/health`,
      corsOrigins: process.env.CORS_ORIGIN || "default",
    });
  })
  .catch((err) => {
    logger.error("Failed to start signaling server", err);
    process.exit(1);
  });

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down signaling server gracefully...`);
  try {
    await server.stop();
    logger.info("Signaling server terminated cleanly.");
    process.exit(0);
  } catch (err) {
    logger.error("Error during server shutdown", err);
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
