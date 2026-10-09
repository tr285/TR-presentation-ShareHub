/**
 * ==============================================================================
 * TR Presentation ShareHub - PM2 Ecosystem Configuration
 * Usage:
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save
 *   pm2 startup
 * ==============================================================================
 */

module.exports = {
  apps: [
    // 1. Signaling Server
    {
      name: "sharehub-signaling",
      script: "server/index.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      instances: 1, // WebRTC in-memory room manager runs 1 instance per node (or redis adapter for multi-node)
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "development",
        SIGNALING_PORT: 3001,
        SIGNALING_HOST: "0.0.0.0",
        LOG_FORMAT: "pretty",
      },
      env_production: {
        NODE_ENV: "production",
        SIGNALING_PORT: 3001,
        SIGNALING_HOST: "0.0.0.0",
        LOG_FORMAT: "json",
        LOG_LEVEL: "info",
      },
    },

    // 2. Next.js Frontend Server
    {
      name: "sharehub-frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: "max", // Cluster mode across all available CPU cores
      exec_mode: "cluster",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "development",
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
