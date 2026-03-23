import {
  createPublicClient,
  http,
  formatEther,
  type PublicClient,
  fallback,
} from "viem";
import { mainnet } from "viem/chains";
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";

// Lido stETH ABI (minimal for monitoring)
const stethAbi = [
  {
    inputs: [],
    name: "getTotalPooledEther",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getTotalShares",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "sharesOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// wstETH ABI
const wstethAbi = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "wstETHAmount", type: "uint256" }],
    name: "getStETHByWstETH",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "stEthPerToken",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface VaultSnapshot {
  timestamp: number;
  totalPooledEther: bigint;
  totalShares: bigint;
  shareRate: number;
  estimatedApy: number;
  gasPrice: bigint;
  blockNumber: bigint;
}

export interface PositionSnapshot {
  address: string;
  stethBalance: string;
  wstethBalance: string;
  totalValueEth: string;
  timestamp: number;
}

export interface AlertEvent {
  type:
    | "apy_drop"
    | "balance_change"
    | "gas_spike"
    | "share_rate_shift"
    | "protocol_anomaly";
  severity: "info" | "warning" | "critical";
  message: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export class LidoMonitor {
  private client: PublicClient;
  private stethAddress: `0x${string}`;
  private wstethAddress: `0x${string}`;
  private snapshots: VaultSnapshot[] = [];
  private alertCallbacks: ((alert: AlertEvent) => void)[] = [];
  private consecutiveErrors = 0;

  constructor(
    rpcUrls: string[],
    stethAddress: `0x${string}`,
    wstethAddress: `0x${string}`
  ) {
    // Use viem's fallback transport for automatic RPC failover
    const transports = rpcUrls.map((url) =>
      http(url, { timeout: 10_000, retryCount: 1 })
    );

    this.client = createPublicClient({
      chain: mainnet,
      transport: fallback(transports, { rank: true }),
    });
    this.stethAddress = stethAddress;
    this.wstethAddress = wstethAddress;
  }

  onAlert(callback: (alert: AlertEvent) => void) {
    this.alertCallbacks.push(callback);
  }

  private emit(alert: AlertEvent) {
    logger.info(`Alert [${alert.severity}]: ${alert.type} - ${alert.message}`);
    for (const cb of this.alertCallbacks) {
      try {
        cb(alert);
      } catch (e) {
        logger.error("Alert callback error:", e);
      }
    }
  }

  async getVaultSnapshot(): Promise<VaultSnapshot> {
    return withRetry(
      async () => {
        const [totalPooledEther, totalShares, gasPrice, blockNumber] =
          await Promise.all([
            this.client.readContract({
              address: this.stethAddress,
              abi: stethAbi,
              functionName: "getTotalPooledEther",
            }),
            this.client.readContract({
              address: this.stethAddress,
              abi: stethAbi,
              functionName: "getTotalShares",
            }),
            this.client.getGasPrice(),
            this.client.getBlockNumber(),
          ]);

        const shareRate = Number(totalPooledEther) / Number(totalShares);

        // Calculate APY using smoothed rolling window (last 5 snapshots minimum)
        let estimatedApy = 0;
        if (this.snapshots.length >= 2) {
          // Use the oldest available snapshot for more stable APY
          const windowSize = Math.min(this.snapshots.length, 10);
          const oldSnapshot = this.snapshots[this.snapshots.length - windowSize];
          const timeDiffSeconds =
            (Date.now() - oldSnapshot.timestamp) / 1000;

          if (timeDiffSeconds > 30) {
            const rateChange =
              (shareRate - oldSnapshot.shareRate) / oldSnapshot.shareRate;
            const annualizedRate =
              rateChange * ((365 * 24 * 3600) / timeDiffSeconds);
            estimatedApy = annualizedRate * 100;
          }
        }

        // Clamp unreasonable APY values (< -50% or > 50%)
        estimatedApy = Math.max(-50, Math.min(50, estimatedApy));

        const snapshot: VaultSnapshot = {
          timestamp: Date.now(),
          totalPooledEther,
          totalShares,
          shareRate,
          estimatedApy,
          gasPrice,
          blockNumber,
        };

        this.snapshots.push(snapshot);
        if (this.snapshots.length > 1440) {
          this.snapshots.shift();
        }

        this.consecutiveErrors = 0;
        return snapshot;
      },
      { label: "Vault snapshot", maxRetries: 3 }
    );
  }

  async getPositionSnapshot(
    walletAddress: `0x${string}`
  ): Promise<PositionSnapshot> {
    return withRetry(
      async () => {
        const [stethBalance, wstethBalance] = await Promise.all([
          this.client.readContract({
            address: this.stethAddress,
            abi: stethAbi,
            functionName: "balanceOf",
            args: [walletAddress],
          }),
          this.client.readContract({
            address: this.wstethAddress,
            abi: wstethAbi,
            functionName: "balanceOf",
            args: [walletAddress],
          }),
        ]);

        let wstethInSteth = 0n;
        if (wstethBalance > 0n) {
          wstethInSteth = await this.client.readContract({
            address: this.wstethAddress,
            abi: wstethAbi,
            functionName: "getStETHByWstETH",
            args: [wstethBalance],
          });
        }

        const totalValue = stethBalance + wstethInSteth;

        return {
          address: walletAddress,
          stethBalance: formatEther(stethBalance),
          wstethBalance: formatEther(wstethBalance),
          totalValueEth: formatEther(totalValue),
          timestamp: Date.now(),
        };
      },
      { label: "Position snapshot" }
    );
  }

  async analyzeAndAlert(thresholds: {
    apyDropPercent: number;
    balanceChangePercent: number;
    gasSpike: number;
  }): Promise<AlertEvent[]> {
    const alerts: AlertEvent[] = [];

    try {
      const snapshot = await this.getVaultSnapshot();

      if (this.snapshots.length < 2) return alerts;

      const prev = this.snapshots[this.snapshots.length - 2];

      // Check APY drop (only if we have enough data for meaningful comparison)
      if (
        this.snapshots.length >= 5 &&
        prev.estimatedApy !== 0 &&
        snapshot.estimatedApy !== 0
      ) {
        const apyChange =
          ((snapshot.estimatedApy - prev.estimatedApy) /
            Math.abs(prev.estimatedApy)) *
          100;
        if (Math.abs(apyChange) > thresholds.apyDropPercent) {
          const alert: AlertEvent = {
            type: "apy_drop",
            severity: Math.abs(apyChange) > 25 ? "critical" : "warning",
            message: `Lido APY ${apyChange > 0 ? "surged" : "dropped"} by ${Math.abs(apyChange).toFixed(1)}% (${prev.estimatedApy.toFixed(2)}% -> ${snapshot.estimatedApy.toFixed(2)}%)`,
            data: {
              previousApy: prev.estimatedApy,
              currentApy: snapshot.estimatedApy,
              changePercent: apyChange,
            },
            timestamp: Date.now(),
          };
          alerts.push(alert);
          this.emit(alert);
        }
      }

      // Check share rate anomaly
      const shareRateChange =
        ((snapshot.shareRate - prev.shareRate) / prev.shareRate) * 100;
      if (Math.abs(shareRateChange) > 0.1) {
        const alert: AlertEvent = {
          type: "share_rate_shift",
          severity: Math.abs(shareRateChange) > 1 ? "critical" : "warning",
          message: `stETH share rate shifted by ${shareRateChange.toFixed(4)}% in one interval`,
          data: {
            previousRate: prev.shareRate,
            currentRate: snapshot.shareRate,
            changePercent: shareRateChange,
          },
          timestamp: Date.now(),
        };
        alerts.push(alert);
        this.emit(alert);
      }

      // Check gas spike
      const gasPriceGwei = Number(snapshot.gasPrice) / 1e9;
      if (gasPriceGwei > thresholds.gasSpike) {
        const alert: AlertEvent = {
          type: "gas_spike",
          severity: gasPriceGwei > 200 ? "critical" : "warning",
          message: `Gas price spike: ${gasPriceGwei.toFixed(1)} gwei (threshold: ${thresholds.gasSpike})`,
          data: { gasPriceGwei, threshold: thresholds.gasSpike },
          timestamp: Date.now(),
        };
        alerts.push(alert);
        this.emit(alert);
      }

      // Check total pooled ether changes (protocol-level)
      const pooledChange =
        Number(snapshot.totalPooledEther - prev.totalPooledEther) /
        Number(prev.totalPooledEther);
      if (Math.abs(pooledChange) > 0.01) {
        const alert: AlertEvent = {
          type: "protocol_anomaly",
          severity: "critical",
          message: `Total pooled ETH changed by ${(pooledChange * 100).toFixed(2)}% (${formatEther(prev.totalPooledEther)} -> ${formatEther(snapshot.totalPooledEther)})`,
          data: {
            previousTotal: formatEther(prev.totalPooledEther),
            currentTotal: formatEther(snapshot.totalPooledEther),
            changePercent: pooledChange * 100,
          },
          timestamp: Date.now(),
        };
        alerts.push(alert);
        this.emit(alert);
      }
    } catch (error) {
      this.consecutiveErrors++;
      logger.error(
        `Monitoring cycle error (consecutive: ${this.consecutiveErrors}):`,
        error
      );

      // Emit an alert if we've failed multiple times in a row
      if (this.consecutiveErrors >= 3) {
        const alert: AlertEvent = {
          type: "protocol_anomaly",
          severity: "critical",
          message: `Monitor has failed ${this.consecutiveErrors} consecutive cycles. RPC issues likely.`,
          data: {
            consecutiveErrors: this.consecutiveErrors,
            error: String(error),
          },
          timestamp: Date.now(),
        };
        alerts.push(alert);
        this.emit(alert);
      }
    }

    return alerts;
  }

  getRecentSnapshots(count = 60): VaultSnapshot[] {
    return this.snapshots.slice(-count);
  }

  getApy7DayAverage(): number {
    const weekSnapshots = this.snapshots.slice(-10080);
    if (weekSnapshots.length < 2) return 0;
    const apys = weekSnapshots
      .filter((s) => s.estimatedApy > 0 && s.estimatedApy < 50)
      .map((s) => s.estimatedApy);
    if (apys.length === 0) return 0;
    return apys.reduce((a, b) => a + b, 0) / apys.length;
  }

  getLatestSnapshot(): VaultSnapshot | null {
    return this.snapshots.length > 0
      ? this.snapshots[this.snapshots.length - 1]
      : null;
  }

  getSnapshotCount(): number {
    return this.snapshots.length;
  }
}
