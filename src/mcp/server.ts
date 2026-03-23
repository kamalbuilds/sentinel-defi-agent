import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LidoMonitor } from "../lido/monitor.js";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

async function main() {
  // Use Ethereum mainnet RPCs for Lido monitoring (not Base)
  const monitor = new LidoMonitor(
    config.ethRpcUrls,
    config.stethAddress,
    config.wstethAddress
  );

  const server = new McpServer({
    name: "sentinel-defi-guardian",
    version: "0.1.0",
  });

  // Tool: Get vault status
  server.tool(
    "get_vault_status",
    "Get current Lido vault health metrics including total pooled ETH, share rate, APY, and gas price",
    {},
    async () => {
      try {
        const snapshot = await monitor.getVaultSnapshot();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  totalPooledEther: (
                    Number(snapshot.totalPooledEther) / 1e18
                  ).toFixed(2),
                  totalShares: (
                    Number(snapshot.totalShares) / 1e18
                  ).toFixed(2),
                  shareRate: snapshot.shareRate.toFixed(6),
                  estimatedApy: snapshot.estimatedApy.toFixed(2) + "%",
                  gasPriceGwei:
                    (Number(snapshot.gasPrice) / 1e9).toFixed(1) +
                    " gwei",
                  blockNumber: snapshot.blockNumber.toString(),
                  timestamp: new Date(snapshot.timestamp).toISOString(),
                  snapshotCount: monitor.getSnapshotCount(),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching vault status: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Get position
  server.tool(
    "get_position",
    "Check a wallet's stETH and wstETH position with total value in ETH",
    {
      wallet_address: z
        .string()
        .describe("Ethereum wallet address (0x...)"),
    },
    async ({ wallet_address }) => {
      try {
        const position = await monitor.getPositionSnapshot(
          wallet_address as `0x${string}`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(position, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching position: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Get APY
  server.tool(
    "get_apy",
    "Get current stETH APY and 7-day moving average",
    {},
    async () => {
      try {
        const snapshot = await monitor.getVaultSnapshot();
        const avg7d = monitor.getApy7DayAverage();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  currentApy: snapshot.estimatedApy.toFixed(2) + "%",
                  sevenDayAverage: avg7d.toFixed(2) + "%",
                  dataPoints: monitor.getSnapshotCount(),
                  trend:
                    snapshot.estimatedApy > avg7d
                      ? "rising"
                      : snapshot.estimatedApy < avg7d
                        ? "falling"
                        : "stable",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Get recent alerts
  server.tool(
    "get_alerts",
    "Get recent alert history from the monitoring agent",
    {
      count: z
        .number()
        .optional()
        .describe("Number of recent alerts to return (default: 10)"),
    },
    async ({ count }) => {
      try {
        const alerts = await monitor.analyzeAndAlert(
          config.alertThresholds
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  recentAlerts: alerts.slice(-(count || 10)),
                  totalAlerts: alerts.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Risk assessment
  server.tool(
    "analyze_risk",
    "Analyze risk level for a Lido position based on current vault metrics and market conditions",
    {
      wallet_address: z
        .string()
        .optional()
        .describe(
          "Optional wallet address to include position-specific risk"
        ),
    },
    async ({ wallet_address }) => {
      try {
        const snapshot = await monitor.getVaultSnapshot();
        const gasPriceGwei = Number(snapshot.gasPrice) / 1e9;

        const risks: string[] = [];
        let riskScore = 0;

        if (gasPriceGwei > 100) {
          risks.push("HIGH GAS: Transactions will be expensive");
          riskScore += 20;
        } else if (gasPriceGwei > 50) {
          risks.push("MODERATE GAS: Consider waiting for lower gas");
          riskScore += 10;
        }

        const snapshots = monitor.getRecentSnapshots(10);
        if (snapshots.length > 1) {
          const rates = snapshots.map((s) => s.shareRate);
          const maxRate = Math.max(...rates);
          const minRate = Math.min(...rates);
          const volatility = ((maxRate - minRate) / minRate) * 100;
          if (volatility > 0.5) {
            risks.push(
              `SHARE RATE VOLATILITY: ${volatility.toFixed(3)}% variation`
            );
            riskScore += 25;
          }
        }

        if (snapshot.estimatedApy > 10) {
          risks.push("UNUSUALLY HIGH APY: May be unsustainable");
          riskScore += 15;
        }

        let positionRisk = null;
        if (wallet_address) {
          try {
            const position = await monitor.getPositionSnapshot(
              wallet_address as `0x${string}`
            );
            const totalValue = parseFloat(position.totalValueEth);
            if (totalValue > 100) {
              risks.push("LARGE POSITION: High absolute risk exposure");
              riskScore += 10;
            }
            positionRisk = {
              totalValueEth: position.totalValueEth,
              stethExposure: position.stethBalance,
              wstethExposure: position.wstethBalance,
            };
          } catch {
            risks.push("Could not fetch position data");
          }
        }

        const riskLevel =
          riskScore > 50
            ? "HIGH"
            : riskScore > 25
              ? "MODERATE"
              : "LOW";

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  riskLevel,
                  riskScore,
                  risks,
                  position: positionRisk,
                  recommendation:
                    riskScore > 50
                      ? "Consider reducing exposure or waiting for conditions to stabilize"
                      : riskScore > 25
                        ? "Monitor closely, conditions are changing"
                        : "Conditions appear stable for operations",
                  timestamp: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Dry run stake
  server.tool(
    "dry_run_stake",
    "Simulate a staking operation to preview expected outcomes without executing",
    {
      amount_eth: z
        .string()
        .describe("Amount of ETH to simulate staking"),
    },
    async ({ amount_eth }) => {
      try {
        const snapshot = await monitor.getVaultSnapshot();
        const amountWei = BigInt(
          Math.floor(parseFloat(amount_eth) * 1e18)
        );

        const expectedShares =
          (amountWei * snapshot.totalShares) /
          snapshot.totalPooledEther;
        const dailyYield =
          (parseFloat(amount_eth) * snapshot.estimatedApy) / 100 / 365;
        const gasCost = Number(snapshot.gasPrice) * 150000;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  simulation: true,
                  input: { amountEth: amount_eth },
                  expected: {
                    stethReceived: amount_eth,
                    sharesReceived: expectedShares.toString(),
                    estimatedDailyYield: `${dailyYield.toFixed(6)} ETH`,
                    estimatedAnnualYield: `${(dailyYield * 365).toFixed(4)} ETH`,
                    currentApy: `${snapshot.estimatedApy.toFixed(2)}%`,
                  },
                  costs: {
                    estimatedGasCostWei: gasCost.toString(),
                    estimatedGasCostGwei: (gasCost / 1e9).toFixed(4),
                    currentGasPrice: `${(Number(snapshot.gasPrice) / 1e9).toFixed(1)} gwei`,
                  },
                  warning:
                    "This is a dry run simulation. Actual results may vary.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Resource: Agent card
  server.resource(
    "agent-card",
    "agent://sentinel/card",
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              name: "Sentinel DeFi Guardian",
              version: "0.1.0",
              description:
                "Verifiable autonomous agent monitoring Lido vaults with TEE attestation on EigenCompute",
              capabilities: [
                "vault-monitoring",
                "risk-assessment",
                "yield-tracking",
                "alert-delivery",
                "position-analysis",
                "staking-simulation",
              ],
              eigencomputeAppId: config.eigencomputeAppId,
              verifiabilityDashboard: `https://verify-sepolia.eigencloud.xyz/app/${config.eigencomputeAppId}`,
            },
            null,
            2
          ),
        },
      ],
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Sentinel MCP Server started on stdio");
}

main().catch(console.error);
