import { SentinelAgent } from "./agent/sentinel.js";
import { logger } from "./utils/logger.js";
import express from "express";

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
    res.json({ status: "ok", service: "sentinel-defi-guardian" });
  });

  // Agent status
  app.get("/status", async (_req, res) => {
    const status = await agent.getStatus();
    res.json(status);
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
        {
          name: "MCP",
          endpoint: `http://localhost:${PORT}/mcp`,
        },
        {
          name: "Health",
          endpoint: `http://localhost:${PORT}/health`,
        },
        {
          name: "Status",
          endpoint: `http://localhost:${PORT}/status`,
        },
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
      },
    });
  });

  app.listen(PORT, () => {
    logger.info(`Sentinel API listening on port ${PORT}`);
    logger.info(`Health: http://localhost:${PORT}/health`);
    logger.info(`Status: http://localhost:${PORT}/status`);
    logger.info(
      `Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`
    );
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
