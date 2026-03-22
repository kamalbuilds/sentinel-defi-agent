import { ERC8004Identity } from "../src/identity/erc8004.js";
import { config } from "../src/utils/config.js";
import { logger } from "../src/utils/logger.js";

/**
 * Register Sentinel agent with ERC-8004 Identity Registry on Base Sepolia.
 *
 * Prerequisites:
 * 1. Set AGENT_PRIVATE_KEY in .env
 * 2. Fund the wallet with Base Sepolia ETH (faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet)
 * 3. Host agent card JSON at a public URL (or use IPFS)
 *
 * Usage:
 *   npx tsx scripts/register-identity.ts [agent-card-uri]
 */

async function main() {
  if (!config.agentPrivateKey) {
    console.error("Error: AGENT_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const identity = new ERC8004Identity(config.agentPrivateKey);

  // Check if already registered
  const alreadyRegistered = await identity.isRegistered();
  if (alreadyRegistered) {
    const tokenId = await identity.getTokenId();
    console.log(`Agent already registered with ERC-8004 token ID: ${tokenId}`);
    console.log(`Address: ${identity.getAddress()}`);
    return;
  }

  // Get agent card URI from args or use default
  const agentCardUri =
    process.argv[2] ||
    "https://sentinel-agent.vercel.app/.well-known/agent-card.json";

  console.log("Registering Sentinel agent with ERC-8004...");
  console.log(`Registry: ${config.identityRegistry}`);
  console.log(`Agent Card URI: ${agentCardUri}`);
  console.log(`Wallet: ${identity.getAddress()}`);

  // Build and display the agent card
  const card = identity.buildAgentCard();
  console.log("\nAgent Card:");
  console.log(JSON.stringify(card, null, 2));

  // Register
  try {
    const tokenId = await identity.register(agentCardUri);
    console.log(`\nRegistration successful!`);
    console.log(`Token ID: ${tokenId}`);
    console.log(
      `View on BaseScan: https://sepolia.basescan.org/token/${config.identityRegistry}?a=${tokenId}`
    );
  } catch (error) {
    console.error("Registration failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
