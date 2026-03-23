import { logger } from "../utils/logger.js";
import { config } from "../utils/config.js";

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
  private sdk: any;
  private chainId: number;
  private userAddress: string | null = null;
  private principalAmount: bigint = 0n;
  private initialized = false;
  private simulationMode = true;

  // Simulation state for demo
  private simDeposited = 0;
  private simStartTime = Date.now();

  constructor(chainId: number = 42161) {
    this.chainId = chainId;
  }

  async initialize(privateKey: string): Promise<void> {
    if (!config.zyfaiApiKey) {
      logger.info(
        "Zyfai API key not set. Running yield management in simulation mode."
      );
      this.simulationMode = true;
      this.initialized = true;
      return;
    }

    try {
      const { ZyfaiSDK } = await import("@zyfai/sdk");
      this.sdk = new ZyfaiSDK({
        apiKey: config.zyfaiApiKey,
        rpcUrls: {
          42161: config.arbitrumRpc,
          8453: config.baseMainnetRpc,
        },
      });
      await this.sdk.connectAccount(privateKey, this.chainId);
      this.simulationMode = false;
      this.initialized = true;
      logger.info("Zyfai YieldManager initialized (live mode)");
    } catch (error) {
      logger.info(
        "Zyfai SDK unavailable, running in simulation mode:",
        error instanceof Error ? error.message : String(error)
      );
      this.simulationMode = true;
      this.initialized = true;
    }
  }

  async getOrDeployWallet(
    userAddress: string
  ): Promise<{ address: string; isDeployed: boolean }> {
    this.userAddress = userAddress;

    if (this.simulationMode) {
      return {
        address: `0x${userAddress.slice(2, 42)}`,
        isDeployed: true,
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
    if (this.simulationMode) {
      this.simDeposited += parseFloat(amount) || 0;
      logger.info(`[Sim] Deposited ${amount} to Zyfai (total: ${this.simDeposited})`);
      return "0xsim_deposit_" + Date.now().toString(16);
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
    if (this.simulationMode) {
      // Simulate realistic yield accumulation
      const elapsedHours =
        (Date.now() - this.simStartTime) / (1000 * 60 * 60);
      const simApy = 4.2; // Realistic conservative DeFi yield
      const simEarnings = (
        this.simDeposited *
        (simApy / 100) *
        (elapsedHours / 8760)
      ).toFixed(8);
      const simValue = (this.simDeposited + parseFloat(simEarnings)).toFixed(8);

      return {
        walletAddress: this.userAddress || "simulation",
        chainId: this.chainId,
        isDeployed: true,
        totalDeposited: this.simDeposited.toString(),
        currentValue: simValue,
        totalEarnings: simEarnings,
        apy: simApy,
        strategy: "conservative-simulation",
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
    if (this.simulationMode) {
      logger.info("[Sim] Would withdraw yield only (principal protected)");
      return "0xsim_withdraw_" + Date.now().toString(16);
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

  isSimulation(): boolean {
    return this.simulationMode;
  }
}
