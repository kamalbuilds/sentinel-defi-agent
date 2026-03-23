import { LidoMonitor, type AlertEvent } from "../lido/monitor.js";
import { YieldManager } from "../zyfai/yield-manager.js";
import { ERC8004Identity } from "../identity/erc8004.js";
import { SentinelTelegramBot } from "../telegram/bot.js";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

export interface SentinelStatus {
  running: boolean;
  uptime: number;
  startTime: number;
  identity: {
    registered: boolean;
    tokenId: string | null;
    address: string;
  };
  vault: {
    apy: number;
    apy7d: number;
    totalPooledEth: string;
    gasPrice: string;
    snapshotCount: number;
  };
  yield: {
    initialized: boolean;
    earnings: string;
    apy: number;
  };
  alerts: {
    total: number;
    recent: AlertEvent[];
  };
}

export class SentinelAgent {
  private monitor: LidoMonitor;
  private yieldManager: YieldManager;
  private identity: ERC8004Identity | null = null;
  private telegram: SentinelTelegramBot;

  private running = false;
  private startTime = 0;
  private alertHistory: AlertEvent[] = [];
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private statusInterval: ReturnType<typeof setInterval> | null = null;
  private cycleCount = 0;

  constructor() {
    // Initialize Lido monitor with fallback RPCs
    this.monitor = new LidoMonitor(
      config.ethRpcUrls,
      config.stethAddress,
      config.wstethAddress
    );

    // Initialize yield manager (Arbitrum)
    this.yieldManager = new YieldManager(42161);

    // Initialize Telegram bot
    this.telegram = new SentinelTelegramBot();

    // Wire up alert routing
    this.monitor.onAlert((alert) => this.handleAlert(alert));
  }

  async start(): Promise<void> {
    logger.info("========================================");
    logger.info("  SENTINEL DeFi GUARDIAN v0.1.0");
    logger.info("  Verifiable Autonomous Agent");
    logger.info("========================================");
    this.startTime = Date.now();
    this.running = true;

    // Step 1: Wire Telegram status provider before starting
    this.telegram.setStatusProvider(() => this.getStatus());

    // Step 2: Start Telegram bot (non-blocking)
    await this.telegram.start();

    // Step 3: Initialize identity (if private key available)
    if (config.agentPrivateKey) {
      try {
        this.identity = new ERC8004Identity(config.agentPrivateKey);
        const registered = await this.identity.isRegistered();
        if (registered) {
          const tokenId = await this.identity.getTokenId();
          logger.info(`Agent identity: ERC-8004 Token #${tokenId}`);
        } else {
          logger.info(
            "Agent not yet registered with ERC-8004. Run: npm run register"
          );
        }
      } catch (error) {
        logger.warn(
          "Identity check failed (non-fatal):",
          error instanceof Error ? error.message : String(error)
        );
      }
    } else {
      logger.info("No private key. Running in read-only monitoring mode.");
    }

    // Step 4: Initialize yield manager
    if (config.agentPrivateKey) {
      await this.yieldManager.initialize(config.agentPrivateKey);
      const mode = this.yieldManager.isSimulation()
        ? "simulation"
        : "live";
      logger.info(`Yield manager: ${mode} mode`);
    }

    // Step 5: Take initial vault snapshot
    logger.info("Taking initial vault snapshot...");
    try {
      const snapshot = await this.monitor.getVaultSnapshot();
      logger.info(
        `Vault: Share rate=${snapshot.shareRate.toFixed(6)}, ` +
          `Gas=${(Number(snapshot.gasPrice) / 1e9).toFixed(1)} gwei, ` +
          `Block #${snapshot.blockNumber}`
      );
      logger.info(
        `Total pooled: ${(Number(snapshot.totalPooledEther) / 1e18).toFixed(2)} ETH`
      );
    } catch (error) {
      logger.error(
        "Initial snapshot failed (will retry in monitoring loop):",
        error instanceof Error ? error.message : String(error)
      );
    }

    // Step 6: Start monitoring loop
    const intervalSec = config.monitorIntervalMs / 1000;
    logger.info(`Starting monitoring loop (every ${intervalSec}s)`);
    this.monitorInterval = setInterval(
      () => this.monitoringCycle(),
      config.monitorIntervalMs
    );

    // Step 7: Start periodic status reports
    this.statusInterval = setInterval(
      () => this.sendPeriodicStatus(),
      config.statusReportIntervalMs
    );

    // Run first cycle immediately
    await this.monitoringCycle();

    logger.info("========================================");
    logger.info("  Sentinel is OPERATIONAL");
    logger.info("========================================");
  }

  private async monitoringCycle(): Promise<void> {
    this.cycleCount++;

    try {
      const alerts = await this.monitor.analyzeAndAlert(
        config.alertThresholds
      );

      for (const alert of alerts) {
        this.alertHistory.push(alert);
      }

      // Trim alert history
      if (this.alertHistory.length > 1000) {
        this.alertHistory = this.alertHistory.slice(-500);
      }

      // Log cycle summary every 5 cycles
      if (this.cycleCount % 5 === 0) {
        const snapshot = this.monitor.getLatestSnapshot();
        if (snapshot) {
          const gas = (Number(snapshot.gasPrice) / 1e9).toFixed(1);
          const pooled = (
            Number(snapshot.totalPooledEther) / 1e18
          ).toFixed(2);
          logger.info(
            `Cycle #${this.cycleCount}: APY=${snapshot.estimatedApy.toFixed(2)}%, ` +
              `Gas=${gas} gwei, Pooled=${pooled} ETH, ` +
              `Alerts=${this.alertHistory.length}`
          );
        }
      }
    } catch (error) {
      logger.error(
        `Cycle #${this.cycleCount} error:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async handleAlert(alert: AlertEvent): Promise<void> {
    try {
      await this.telegram.sendAlert(alert);
    } catch (e) {
      logger.error("Alert delivery error:", e);
    }

    // On critical alerts, check if yield is available for emergency operations
    if (alert.severity === "critical" && this.yieldManager.isReady()) {
      try {
        const report = await this.yieldManager.getEarningsReport();
        logger.info(
          `Yield available for operations: ${report.availableYield}`
        );
      } catch {
        // non-fatal
      }
    }
  }

  private async sendPeriodicStatus(): Promise<void> {
    try {
      const status = await this.getStatus();
      const uptimeMin = Math.floor(status.uptime / 60_000);
      const uptimeStr =
        uptimeMin >= 60
          ? `${Math.floor(uptimeMin / 60)}h ${uptimeMin % 60}m`
          : `${uptimeMin}m`;

      const report =
        `\u{1F4CB} *SENTINEL PERIODIC REPORT*\n\n` +
        `*Vault:*\n` +
        `  APY: ${status.vault.apy.toFixed(2)}%\n` +
        `  7d Avg: ${status.vault.apy7d.toFixed(2)}%\n` +
        `  Pooled: ${status.vault.totalPooledEth} ETH\n` +
        `  Gas: ${status.vault.gasPrice} gwei\n\n` +
        `*Agent:*\n` +
        `  Uptime: ${uptimeStr}\n` +
        `  Cycles: ${this.cycleCount}\n` +
        `  Alerts: ${status.alerts.total}\n` +
        `  Snapshots: ${status.vault.snapshotCount}`;

      await this.telegram.sendStatusReport(report);
      logger.info("Periodic status report sent");
    } catch (e) {
      logger.error("Failed to send periodic status:", e);
    }
  }

  async getStatus(): Promise<SentinelStatus> {
    const latestSnapshot = this.monitor.getLatestSnapshot();

    let identityStatus = {
      registered: false,
      tokenId: null as string | null,
      address: "",
    };

    if (this.identity) {
      try {
        const registered = await this.identity.isRegistered();
        const tokenId = await this.identity.getTokenId();
        identityStatus = {
          registered,
          tokenId: tokenId?.toString() || null,
          address: this.identity.getAddress(),
        };
      } catch {
        // Use cached/default values on failure
      }
    }

    let yieldInfo = { initialized: false, earnings: "0", apy: 0 };
    try {
      const yieldPosition = await this.yieldManager.getYieldPosition();
      yieldInfo = {
        initialized: this.yieldManager.isReady(),
        earnings: yieldPosition.totalEarnings,
        apy: yieldPosition.apy,
      };
    } catch {
      // non-fatal
    }

    return {
      running: this.running,
      uptime: this.running ? Date.now() - this.startTime : 0,
      startTime: this.startTime,
      identity: identityStatus,
      vault: {
        apy: latestSnapshot?.estimatedApy || 0,
        apy7d: this.monitor.getApy7DayAverage(),
        totalPooledEth: latestSnapshot
          ? (Number(latestSnapshot.totalPooledEther) / 1e18).toFixed(2)
          : "0",
        gasPrice: latestSnapshot
          ? (Number(latestSnapshot.gasPrice) / 1e9).toFixed(1)
          : "0",
        snapshotCount: this.monitor.getSnapshotCount(),
      },
      yield: yieldInfo,
      alerts: {
        total: this.alertHistory.length,
        recent: this.alertHistory.slice(-10),
      },
    };
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    if (this.statusInterval) clearInterval(this.statusInterval);
    this.telegram.stop();
    logger.info("Sentinel agent stopped.");
  }
}
