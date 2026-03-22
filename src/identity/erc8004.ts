import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

// ERC-8004 Identity Registry ABI (minimal for registration)
const identityRegistryAbi = [
  {
    inputs: [{ name: "uri", type: "string" }],
    name: "register",
    outputs: [{ type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    name: "tokenOfOwnerByIndex",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface AgentCard {
  type: string;
  name: string;
  description: string;
  version: string;
  endpoints: {
    name: string;
    endpoint: string;
  }[];
  capabilities: string[];
  supportedTrust: string[];
  metadata: {
    runtime: string;
    chains: string[];
    protocols: string[];
    created: string;
  };
}

export class ERC8004Identity {
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private registryAddress: `0x${string}`;
  private chain: Chain;

  constructor(privateKey: string, chain: Chain = baseSepolia) {
    this.chain = chain;
    this.registryAddress = config.identityRegistry;

    const account = privateKeyToAccount(privateKey as `0x${string}`);

    this.publicClient = createPublicClient({
      chain,
      transport: http(
        chain.id === baseSepolia.id ? config.baseSepoliaRpc : config.baseMainnetRpc
      ),
    });

    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(
        chain.id === baseSepolia.id ? config.baseSepoliaRpc : config.baseMainnetRpc
      ),
    });
  }

  buildAgentCard(mcpEndpoint?: string): AgentCard {
    return {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Sentinel DeFi Guardian",
      description:
        "Verifiable autonomous agent that monitors DeFi positions, tracks Lido vault health, manages yield through Zyfai, and delivers intelligent alerts. Runs in TEE on EigenCompute for cryptographic proof of honest execution.",
      version: "0.1.0",
      endpoints: [
        ...(mcpEndpoint
          ? [{ name: "MCP", endpoint: mcpEndpoint }]
          : []),
        {
          name: "A2A",
          endpoint: "https://sentinel-agent.vercel.app/.well-known/agent-card.json",
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
      supportedTrust: [
        "tee-attestation",
        "reputation",
        "crypto-economic",
      ],
      metadata: {
        runtime: "eigencompute-tee",
        chains: ["ethereum", "base", "arbitrum"],
        protocols: ["lido", "zyfai", "erc-8004"],
        created: new Date().toISOString(),
      },
    };
  }

  async register(agentCardUri: string): Promise<bigint> {
    logger.info("Registering agent identity with ERC-8004...");
    logger.info(`Registry: ${this.registryAddress}`);
    logger.info(`Agent Card URI: ${agentCardUri}`);

    try {
      const account = this.walletClient.account;
      if (!account) throw new Error("No wallet account configured");

      const hash = await this.walletClient.writeContract({
        account,
        address: this.registryAddress,
        abi: identityRegistryAbi,
        functionName: "register",
        args: [agentCardUri],
        chain: this.chain,
      });

      logger.info(`Registration tx submitted: ${hash}`);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      logger.info(
        `Registration confirmed in block ${receipt.blockNumber}`
      );

      // Get the token ID
      if (!account) throw new Error("No account");

      const balance = await this.publicClient.readContract({
        address: this.registryAddress,
        abi: identityRegistryAbi,
        functionName: "balanceOf",
        args: [account.address],
      });

      const tokenId = await this.publicClient.readContract({
        address: this.registryAddress,
        abi: identityRegistryAbi,
        functionName: "tokenOfOwnerByIndex",
        args: [account.address, balance - 1n],
      });

      logger.info(`Agent registered with token ID: ${tokenId}`);
      return tokenId;
    } catch (error) {
      logger.error("ERC-8004 registration failed:", error);
      throw error;
    }
  }

  async isRegistered(): Promise<boolean> {
    const account = this.walletClient.account;
    if (!account) return false;

    try {
      const balance = await this.publicClient.readContract({
        address: this.registryAddress,
        abi: identityRegistryAbi,
        functionName: "balanceOf",
        args: [account.address],
      });
      return balance > 0n;
    } catch {
      return false;
    }
  }

  async getTokenId(): Promise<bigint | null> {
    const account = this.walletClient.account;
    if (!account) return null;

    try {
      const balance = await this.publicClient.readContract({
        address: this.registryAddress,
        abi: identityRegistryAbi,
        functionName: "balanceOf",
        args: [account.address],
      });

      if (balance === 0n) return null;

      return await this.publicClient.readContract({
        address: this.registryAddress,
        abi: identityRegistryAbi,
        functionName: "tokenOfOwnerByIndex",
        args: [account.address, balance - 1n],
      });
    } catch {
      return null;
    }
  }

  getAddress(): string {
    return this.walletClient.account?.address || "";
  }
}
