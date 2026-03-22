import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LidoMonitor } from "../lido/monitor.js";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

/**
 * Sentinel MCP Server
 *
 * Exposes Lido vault monitoring and DeFi analysis tools
 * to other AI agents via the Model Context Protocol.
 *
 * Tools:
 * - get_vault_status: Current Lido vault health metrics
 * - get_position: Check a wallet's stETH/wstETH position
 * - get_apy: Current and historical APY data
 * - get_alerts: Recent alert history
 * - analyze_risk: Risk assessment for a given position
 * - dry_run_stake: Simulate a staking operation
 */

async function main() {
  const monitor = new LidoMonitor(
    config.baseMainnetRpc || "https://eth.llamarpc.com",
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
                  totalPooledEther: snapshot.totalPooledEther.toString(),
                  totalShares: snapshot.totalShares.toString(),
                  shareRate: snapshot.shareRate,
                  estimatedApy: snapshot.estimatedApy,
                  gasPriceGwei: Number(snapshot.gasPrice) / 1e9,
                  timestamp: new Date(snapshot.timestamp).toISOString(),
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
              text: `Error fetching vault status: ${error}`,
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
              text: `Error fetching position: ${error}`,
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
      const snapshot = await monitor.getVaultSnapshot();
      const avg7d = monitor.getApy7DayAverage();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                currentApy: snapshot.estimatedApy,
                sevenDayAverage: avg7d,
                dataPoints: monitor.getRecentSnapshots().length,
              },
              null,
              2
            ),
          },
        ],
      };
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
      const alerts = await monitor.analyzeAndAlert(config.alertThresholds);
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
        .describe("Optional wallet address to include position-specific risk"),
    },
    async ({ wallet_address }) => {
      const snapshot = await monitor.getVaultSnapshot();
      const gasPriceGwei = Number(snapshot.gasPrice) / 1e9;

      const risks: string[] = [];
      let riskScore = 0; // 0-100, higher = more risk

      // Gas risk
      if (gasPriceGwei > 100) {
        risks.push("HIGH GAS: Transactions will be expensive");
        riskScore += 20;
      } else if (gasPriceGwei > 50) {
        risks.push("MODERATE GAS: Consider waiting for lower gas");
        riskScore += 10;
      }

      // Share rate stability
      const snapshots = monitor.getRecentSnapshots(10);
      if (snapshots.length > 1) {
        const rates = snapshots.map((s) => s.shareRate);
        const maxRate = Math.max(...rates);
        const minRate = Math.min(...rates);
        const volatility = ((maxRate - minRate) / minRate) * 100;
        if (volatility > 0.5) {
          risks.push(
            `SHARE RATE VOLATILITY: ${volatility.toFixed(3)}% variation detected`
          );
          riskScore += 25;
        }
      }

      // APY sustainability
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
        riskScore > 50 ? "HIGH" : riskScore > 25 ? "MODERATE" : "LOW";

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
    }
  );

  // Tool: Dry run stake
  server.tool(
    "dry_run_stake",
    "Simulate a staking operation to preview expected outcomes without executing",
    {
      amount_eth: z.string().describe("Amount of ETH to simulate staking"),
    },
    async ({ amount_eth }) => {
      const snapshot = await monitor.getVaultSnapshot();
      const amountWei = BigInt(
        Math.floor(parseFloat(amount_eth) * 1e18)
      );

      const expectedSteth = amountWei; // 1:1 on deposit
      const expectedShares =
        (amountWei * snapshot.totalShares) / snapshot.totalPooledEther;
      const dailyYield =
        (parseFloat(amount_eth) * snapshot.estimatedApy) / 100 / 365;
      const gasCost =
        Number(snapshot.gasPrice) * 150000; // ~150k gas for stake

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
    }
  );

  // Resources
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
                "Verifiable autonomous agent monitoring Lido vaults with TEE attestation",
              capabilities: [
                "vault-monitoring",
                "risk-assessment",
                "yield-tracking",
                "alert-delivery",
              ],
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
