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
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Initialize Lido monitor (works with public RPC, no keys needed)
    this.monitor = new LidoMonitor(
      "https://eth.llamarpc.com",
      config.stethAddress,
      config.wstethAddress
    );

    // Initialize yield manager (needs Zyfai API key)
    this.yieldManager = new YieldManager(42161); // Arbitrum

    // Initialize Telegram bot (needs bot token)
    this.telegram = new SentinelTelegramBot();

    // Wire up alert routing
    this.monitor.onAlert((alert) => this.handleAlert(alert));
  }

  async start(): Promise<void> {
    logger.info("=== SENTINEL DeFi GUARDIAN ===");
    logger.info("Starting autonomous monitoring agent...");
    this.startTime = Date.now();
    this.running = true;

    // Step 1: Initialize identity (if private key available)
    if (config.agentPrivateKey) {
      try {
        this.identity = new ERC8004Identity(config.agentPrivateKey);
        const registered = await this.identity.isRegistered();
        if (registered) {
          const tokenId = await this.identity.getTokenId();
          logger.info(`Agent identity: ERC-8004 #${tokenId}`);
        } else {
          logger.info("Agent not yet registered with ERC-8004");
        }
      } catch (error) {
        logger.warn("Identity initialization failed:", error);
      }
    } else {
      logger.info("No private key set. Running in read-only monitoring mode.");
    }

    // Step 2: Initialize yield manager
    if (config.agentPrivateKey && config.zyfaiApiKey) {
      await this.yieldManager.initialize(config.agentPrivateKey);
    }

    // Step 3: Start Telegram bot
    await this.telegram.start();

    // Step 4: Take initial snapshot
    logger.info("Taking initial vault snapshot...");
    try {
      const snapshot = await this.monitor.getVaultSnapshot();
      logger.info(
        `Initial snapshot: Share rate=${snapshot.shareRate.toFixed(6)}, Gas=${(Number(snapshot.gasPrice) / 1e9).toFixed(1)} gwei`
      );
    } catch (error) {
      logger.error("Failed to take initial snapshot:", error);
    }

    // Step 5: Start monitoring loop
    logger.info(
      `Starting monitoring loop (interval: ${config.monitorIntervalMs / 1000}s)`
    );
    this.intervalId = setInterval(
      () => this.monitoringCycle(),
      config.monitorIntervalMs
    );

    // Run first cycle immediately
    await this.monitoringCycle();

    logger.info("Sentinel is operational and monitoring.");
  }

  private async monitoringCycle(): Promise<void> {
    try {
      // Analyze vault and generate alerts
      const alerts = await this.monitor.analyzeAndAlert(
        config.alertThresholds
      );

      for (const alert of alerts) {
        this.alertHistory.push(alert);
      }

      // Keep alert history manageable
      if (this.alertHistory.length > 1000) {
        this.alertHistory = this.alertHistory.slice(-500);
      }

      // Log cycle completion
      const snapshot = this.monitor.getRecentSnapshots(1)[0];
      if (snapshot) {
        logger.debug(
          `Cycle complete: APY=${snapshot.estimatedApy.toFixed(2)}%, Gas=${(Number(snapshot.gasPrice) / 1e9).toFixed(1)} gwei, Alerts=${alerts.length}`
        );
      }
    } catch (error) {
      logger.error("Monitoring cycle error:", error);
    }
  }

  private async handleAlert(alert: AlertEvent): Promise<void> {
    // Send to Telegram
    await this.telegram.sendAlert(alert);

    // Log structured alert
    logger.warn({
      message: "Alert triggered",
      alert,
    });

    // If critical, consider self-funding check
    if (alert.severity === "critical" && this.yieldManager.isReady()) {
      const report = await this.yieldManager.getEarningsReport();
      logger.info(`Yield available for operations: ${report.availableYield}`);
    }
  }

  async getStatus(): Promise<SentinelStatus> {
    const snapshots = this.monitor.getRecentSnapshots(1);
    const latestSnapshot = snapshots[0];

    let identityStatus = {
      registered: false,
      tokenId: null as string | null,
      address: "",
    };

    if (this.identity) {
      const registered = await this.identity.isRegistered();
      const tokenId = await this.identity.getTokenId();
      identityStatus = {
        registered,
        tokenId: tokenId?.toString() || null,
        address: this.identity.getAddress(),
      };
    }

    const yieldPosition = await this.yieldManager.getYieldPosition();

    return {
      running: this.running,
      uptime: this.running ? Date.now() - this.startTime : 0,
      startTime: this.startTime,
      identity: identityStatus,
      vault: {
        apy: latestSnapshot?.estimatedApy || 0,
        apy7d: this.monitor.getApy7DayAverage(),
        totalPooledEth: latestSnapshot
          ? (
              Number(latestSnapshot.totalPooledEther) / 1e18
            ).toFixed(2)
          : "0",
        gasPrice: latestSnapshot
          ? (Number(latestSnapshot.gasPrice) / 1e9).toFixed(1)
          : "0",
        snapshotCount: this.monitor.getRecentSnapshots().length,
      },
      yield: {
        initialized: this.yieldManager.isReady(),
        earnings: yieldPosition.totalEarnings,
        apy: yieldPosition.apy,
      },
      alerts: {
        total: this.alertHistory.length,
        recent: this.alertHistory.slice(-10),
      },
    };
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    this.telegram.stop();
    logger.info("Sentinel agent stopped.");
  }
}
