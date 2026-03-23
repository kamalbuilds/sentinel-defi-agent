import { SentinelAgent } from "./agent/sentinel.js";
import { logger } from "./utils/logger.js";
import express from "express";
import { config } from "./utils/config.js";

const PORT = process.env.PORT || 3001;

async function main() {
  logger.info("Initializing Sentinel DeFi Guardian...");

  const agent = new SentinelAgent();

  // Start the agent
  await agent.start();

  // Start HTTP API for status and health checks
  const app = express();
  app.use(express.json());

  // Health check (for EigenCompute / Docker)
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "sentinel-defi-guardian",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Agent status (full)
  app.get("/status", async (_req, res) => {
    try {
      const status = await agent.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({
        error: "Failed to get status",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Agent card (ERC-8004 discovery)
  app.get("/.well-known/agent-card.json", (_req, res) => {
    res.json({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Sentinel DeFi Guardian",
      description:
        "Verifiable autonomous agent that monitors Lido vault positions, self-funds from DeFi yield, and delivers intelligent alerts. TEE-attested on EigenCompute.",
      version: "0.1.0",
      endpoints: [
        { name: "Health", endpoint: `/health` },
        { name: "Status", endpoint: `/status` },
      ],
      capabilities: [
        "defi-monitoring",
        "vault-health-tracking",
        "yield-management",
        "autonomous-alerts",
        "lido-steth-analysis",
        "gas-optimization",
        "risk-assessment",
      ],
      supportedTrust: ["tee-attestation", "reputation", "crypto-economic"],
      metadata: {
        runtime: "eigencompute-tee",
        chains: ["ethereum", "base", "arbitrum"],
        protocols: ["lido", "zyfai", "erc-8004"],
        eigencomputeAppId: config.eigencomputeAppId,
        verifiabilityDashboard: `https://verify-sepolia.eigencloud.xyz/app/${config.eigencomputeAppId}`,
      },
    });
  });

  // Metrics endpoint (lightweight)
  app.get("/metrics", async (_req, res) => {
    try {
      const status = await agent.getStatus();
      const lines = [
        `# HELP sentinel_uptime_seconds Agent uptime in seconds`,
        `sentinel_uptime_seconds ${(status.uptime / 1000).toFixed(0)}`,
        `# HELP sentinel_vault_apy Current Lido vault APY`,
        `sentinel_vault_apy ${status.vault.apy.toFixed(4)}`,
        `# HELP sentinel_gas_gwei Current gas price in gwei`,
        `sentinel_gas_gwei ${status.vault.gasPrice}`,
        `# HELP sentinel_alert_total Total alerts fired`,
        `sentinel_alert_total ${status.alerts.total}`,
        `# HELP sentinel_snapshot_count Total vault snapshots taken`,
        `sentinel_snapshot_count ${status.vault.snapshotCount}`,
      ];
      res.type("text/plain").send(lines.join("\n"));
    } catch {
      res.status(500).send("# error fetching metrics");
    }
  });

  app.listen(PORT, () => {
    logger.info(`Sentinel API listening on port ${PORT}`);
    logger.info(`  Health:     http://localhost:${PORT}/health`);
    logger.info(`  Status:     http://localhost:${PORT}/status`);
    logger.info(`  Metrics:    http://localhost:${PORT}/metrics`);
    logger.info(`  Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down Sentinel...");
    await agent.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error("Fatal error:", error);
  process.exit(1);
});
