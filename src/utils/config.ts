import dotenv from "dotenv";
dotenv.config();

export const config = {
  // Agent wallet
  agentPrivateKey: process.env.AGENT_PRIVATE_KEY || "",

  // Ethereum Mainnet RPCs (fallback chain for Lido monitoring)
  ethRpcUrls: [
    process.env.ETH_RPC_URL,
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://ethereum-rpc.publicnode.com",
    "https://1rpc.io/eth",
  ].filter(Boolean) as string[],

  // Base Sepolia (identity registration)
  baseSepoliaRpc: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
  baseMainnetRpc: process.env.BASE_MAINNET_RPC || "https://mainnet.base.org",

  // Arbitrum (Zyfai yield)
  arbitrumRpc:
    process.env.ARBITRUM_RPC || "https://arb-mainnet.g.alchemy.com/v2/demo",

  // Zyfai
  zyfaiApiKey: process.env.ZYFAI_API_KEY || "",

  // Telegram
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",

  // EigenCompute
  eigencomputeAppId: process.env.EIGENCOMPUTE_APP_ID || "0x521474FDdD883aF3c65486405106FA63BF8B9C69",

  // Contracts (Base Sepolia)
  identityRegistry:
    "0x8004A818BFB912233c491871b3d84c89A494BD9e" as `0x${string}`,
  reputationRegistry:
    "0x8004B663056A597Dffe9eCcC1965A193B7388713" as `0x${string}`,

  // Lido addresses (Ethereum Mainnet)
  stethAddress:
    "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84" as `0x${string}`,
  wstethAddress:
    "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as `0x${string}`,

  // Agent config
  monitorIntervalMs: Number(process.env.MONITOR_INTERVAL_MS) || 60_000,
  statusReportIntervalMs:
    Number(process.env.STATUS_REPORT_INTERVAL_MS) || 3_600_000, // hourly
  alertThresholds: {
    apyDropPercent: 10,
    balanceChangePercent: 5,
    gasSpike: 100,
  },
} as const;
