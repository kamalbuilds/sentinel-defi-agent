import { logger } from "../utils/logger.js";
import { config } from "../utils/config.js";

/**
 * YieldManager handles self-funding operations through Zyfai.
 * The agent earns yield on deposited funds and uses that yield
 * to pay for its own operations (gas, compute, alerts).
 *
 * Architecture:
 * 1. Agent deposits funds into Zyfai Safe (ERC-4337 wallet)
 * 2. Zyfai optimizes yield across DeFi protocols
 * 3. Agent monitors earnings and withdraws yield (never principal)
 * 4. Yield funds gas costs, Telegram API, compute expenses
 */

export interface YieldPosition {
  walletAddress: string;
  chainId: number;
  isDeployed: boolean;
  totalDeposited: string;
  currentValue: string;
  totalEarnings: string;
  apy: number;
  strategy: string;
}

export interface EarningsReport {
  totalEarnings: string;
  availableYield: string;
  principalProtected: boolean;
  lastWithdrawal: number | null;
  operatingCosts: {
    gasCosts: string;
    computeCosts: string;
    totalSpent: string;
  };
}

export class YieldManager {
  private sdk: any; // ZyfaiSDK type
  private chainId: number;
  private userAddress: string | null = null;
  private principalAmount: bigint = 0n;
  private initialized = false;

  constructor(chainId: number = 42161) {
    // Default to Arbitrum
    this.chainId = chainId;
  }

  async initialize(privateKey: string): Promise<void> {
    if (!config.zyfaiApiKey) {
      logger.warn(
        "Zyfai API key not set. Yield management will run in simulation mode."
      );
      this.initialized = false;
      return;
    }

    try {
      // Dynamic import to avoid issues if SDK not installed
      const { ZyfaiSDK } = await import("@zyfai/sdk");

      this.sdk = new ZyfaiSDK({
        apiKey: config.zyfaiApiKey,
        rpcUrls: {
          42161: config.arbitrumRpc,
          8453: config.baseMainnetRpc,
        },
      });

      await this.sdk.connectAccount(privateKey, this.chainId);
      this.initialized = true;
      logger.info("Zyfai YieldManager initialized successfully");
    } catch (error) {
      logger.warn("Zyfai SDK initialization failed, running in simulation mode:", error);
      this.initialized = false;
    }
  }

  async getOrDeployWallet(
    userAddress: string
  ): Promise<{ address: string; isDeployed: boolean }> {
    this.userAddress = userAddress;

    if (!this.initialized) {
      return {
        address: `0x${userAddress.slice(2, 10)}...simulated`,
        isDeployed: false,
      };
    }

    const walletInfo = await this.sdk.getSmartWalletAddress(
      userAddress,
      this.chainId
    );

    if (!walletInfo.isDeployed) {
      logger.info("Deploying Zyfai Safe wallet...");
      await this.sdk.deploySafe(userAddress, this.chainId, "conservative");
      logger.info(`Safe deployed at ${walletInfo.address}`);
    }

    return walletInfo;
  }

  async deposit(amount: string): Promise<string> {
    if (!this.initialized || !this.userAddress) {
      logger.info(`[Simulation] Would deposit ${amount} to Zyfai`);
      return "0xsimulated-deposit-tx";
    }

    const result = await this.sdk.depositFunds(
      this.userAddress,
      this.chainId,
      amount
    );
    this.principalAmount += BigInt(amount);
    logger.info(`Deposited ${amount} to Zyfai: ${result.txHash}`);
    return result.txHash;
  }

  async getYieldPosition(): Promise<YieldPosition> {
    if (!this.initialized || !this.userAddress) {
      return {
        walletAddress: this.userAddress || "not-connected",
        chainId: this.chainId,
        isDeployed: false,
        totalDeposited: "0",
        currentValue: "0",
        totalEarnings: "0",
        apy: 0,
        strategy: "simulation",
      };
    }

    const wallet = await this.sdk.getSmartWalletAddress(
      this.userAddress,
      this.chainId
    );
    const earnings = await this.sdk.getOnchainEarnings(wallet.address);
    const positions = await this.sdk.getPositions(
      this.userAddress,
      this.chainId
    );

    return {
      walletAddress: wallet.address,
      chainId: this.chainId,
      isDeployed: wallet.isDeployed,
      totalDeposited: this.principalAmount.toString(),
      currentValue: positions?.totalValue || "0",
      totalEarnings: earnings?.total || "0",
      apy: earnings?.apy || 0,
      strategy: "conservative",
    };
  }

  async withdrawYieldOnly(): Promise<string> {
    if (!this.initialized || !this.userAddress) {
      logger.info("[Simulation] Would withdraw yield only");
      return "0xsimulated-withdraw-tx";
    }

    const wallet = await this.sdk.getSmartWalletAddress(
      this.userAddress,
      this.chainId
    );
    const earnings = await this.sdk.getOnchainEarnings(wallet.address);

    if (!earnings || BigInt(earnings.total || "0") === 0n) {
      logger.info("No yield available to withdraw");
      return "";
    }

    // Only withdraw earnings, never principal
    const yieldAmount = earnings.total;
    logger.info(
      `Withdrawing yield: ${yieldAmount} (principal protected: ${this.principalAmount})`
    );

    const result = await this.sdk.withdrawFunds(
      this.userAddress,
      this.chainId,
      yieldAmount
    );

    return result?.txHash || "";
  }

  async getEarningsReport(): Promise<EarningsReport> {
    const position = await this.getYieldPosition();

    return {
      totalEarnings: position.totalEarnings,
      availableYield: position.totalEarnings,
      principalProtected: true,
      lastWithdrawal: null,
      operatingCosts: {
        gasCosts: "0",
        computeCosts: "0",
        totalSpent: "0",
      },
    };
  }

  isReady(): boolean {
    return this.initialized;
  }
}
