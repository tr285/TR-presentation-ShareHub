import { createSignalingServer } from "./signaling-server";

const PORT = parseInt(process.env.SIGNALING_PORT || process.env.PORT || "3001", 10);

const server = createSignalingServer({
  port: PORT,
});

server
  .start(PORT)
  .then((actualPort) => {
    console.log(`[TR ShareHub Signaling] Server listening on port ${actualPort}`);
    console.log(`[TR ShareHub Signaling] Health check at http://localhost:${actualPort}/health`);
  })
  .catch((err) => {
    console.error("[TR ShareHub Signaling] Failed to start server:", err);
    process.exit(1);
  });

const shutdown = async () => {
  console.log("\n[TR ShareHub Signaling] Shutting down gracefully...");
  await server.stop();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
