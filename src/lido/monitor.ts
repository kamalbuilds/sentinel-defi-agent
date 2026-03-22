import {
  createPublicClient,
  http,
  formatEther,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";
import { logger } from "../utils/logger.js";

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
  shareRate: number; // stETH per share
  estimatedApy: number;
  gasPrice: bigint;
}

export interface PositionSnapshot {
  address: string;
  stethBalance: string;
  wstethBalance: string;
  totalValueEth: string;
  timestamp: number;
}

export interface AlertEvent {
  type: "apy_drop" | "balance_change" | "gas_spike" | "share_rate_shift" | "protocol_anomaly";
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

  constructor(
    rpcUrl: string,
    stethAddress: `0x${string}`,
    wstethAddress: `0x${string}`
  ) {
    this.client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    });
    this.stethAddress = stethAddress;
    this.wstethAddress = wstethAddress;
  }

  onAlert(callback: (alert: AlertEvent) => void) {
    this.alertCallbacks.push(callback);
  }

  private emit(alert: AlertEvent) {
    logger.info(`Alert: ${alert.type} - ${alert.message}`);
    for (const cb of this.alertCallbacks) {
      cb(alert);
    }
  }

  async getVaultSnapshot(): Promise<VaultSnapshot> {
    const [totalPooledEther, totalShares, gasPrice] = await Promise.all([
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
    ]);

    const shareRate =
      Number(totalPooledEther) / Number(totalShares);

    // Calculate APY from recent snapshots
    let estimatedApy = 0;
    if (this.snapshots.length > 0) {
      const prevSnapshot = this.snapshots[this.snapshots.length - 1];
      const timeDiffSeconds =
        (Date.now() - prevSnapshot.timestamp) / 1000;
      if (timeDiffSeconds > 0) {
        const rateChange =
          (shareRate - prevSnapshot.shareRate) / prevSnapshot.shareRate;
        const annualizedRate =
          rateChange * ((365 * 24 * 3600) / timeDiffSeconds);
        estimatedApy = annualizedRate * 100;
      }
    }

    const snapshot: VaultSnapshot = {
      timestamp: Date.now(),
      totalPooledEther,
      totalShares,
      shareRate,
      estimatedApy,
      gasPrice,
    };

    this.snapshots.push(snapshot);
    // Keep last 1440 snapshots (24 hours at 1/min)
    if (this.snapshots.length > 1440) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  async getPositionSnapshot(
    walletAddress: `0x${string}`
  ): Promise<PositionSnapshot> {
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

    // Get stETH equivalent of wstETH holdings
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
  }

  async analyzeAndAlert(thresholds: {
    apyDropPercent: number;
    balanceChangePercent: number;
    gasSpike: number;
  }): Promise<AlertEvent[]> {
    const alerts: AlertEvent[] = [];
    const snapshot = await this.getVaultSnapshot();

    if (this.snapshots.length < 2) return alerts;

    const prev = this.snapshots[this.snapshots.length - 2];

    // Check APY drop
    if (prev.estimatedApy > 0 && snapshot.estimatedApy > 0) {
      const apyChange =
        ((snapshot.estimatedApy - prev.estimatedApy) /
          prev.estimatedApy) *
        100;
      if (Math.abs(apyChange) > thresholds.apyDropPercent) {
        const alert: AlertEvent = {
          type: "apy_drop",
          severity: Math.abs(apyChange) > 25 ? "critical" : "warning",
          message: `Lido APY ${apyChange > 0 ? "increased" : "dropped"} by ${Math.abs(apyChange).toFixed(1)}% (${prev.estimatedApy.toFixed(2)}% -> ${snapshot.estimatedApy.toFixed(2)}%)`,
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
      // >0.1% change is unusual
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
        data: {
          gasPriceGwei,
          threshold: thresholds.gasSpike,
        },
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
      // >1% change
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

    return alerts;
  }

  getRecentSnapshots(count = 60): VaultSnapshot[] {
    return this.snapshots.slice(-count);
  }

  getApy7DayAverage(): number {
    const weekSnapshots = this.snapshots.slice(-10080); // 7 days at 1/min
    if (weekSnapshots.length < 2) return 0;
    const apys = weekSnapshots
      .filter((s) => s.estimatedApy > 0)
      .map((s) => s.estimatedApy);
    return apys.reduce((a, b) => a + b, 0) / apys.length;
  }
}
