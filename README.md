# Sentinel - Verifiable Autonomous DeFi Guardian

An autonomous AI agent that monitors Lido vault positions, self-funds from DeFi yield via Zyfai, and operates with cryptographic proof of honest execution on EigenCompute TEE.

## The Problem

When AI agents manage DeFi positions, you can't verify their honesty. Are they giving biased recommendations? Are they front-running transactions? Are they operating the code they claim to run?

## The Solution

Sentinel runs inside a Trusted Execution Environment (TEE) on EigenCompute, providing cryptographic attestation that the agent code is unmodified and executing honestly. The agent:

1. **Monitors** Lido vault health (APY, share rates, total pooled ETH, gas prices)
2. **Self-funds** operations from DeFi yield via Zyfai (never touches principal)
3. **Alerts** on anomalies via Telegram (APY drops, share rate shifts, gas spikes, protocol changes)
4. **Registers** its identity onchain via ERC-8004 for discoverability and reputation
5. **Exposes** 6 MCP tools for other agents to consume vault data and risk assessments

## Architecture

```
  EigenCompute TEE Container
  +-----------------------------------------------+
  |  Sentinel Core Agent                          |
  |  +------------------+  +-------------------+ |
  |  | Lido Monitor     |  | Zyfai Yield Mgr   | |
  |  | - Vault health   |  | - Self-funding    | |
  |  | - APY tracking   |  | - Principal safe  | |
  |  | - Share rates    |  | - Yield withdraw  | |
  |  +--------+---------+  +---------+---------+ |
  |           |                       |           |
  |  +--------v---------+  +---------v---------+ |
  |  | Alert Engine     |  | ERC-8004 Identity | |
  |  | - Telegram       |  | - Onchain NFT     | |
  |  | - Risk scoring   |  | - Agent card      | |
  |  | - Anomaly detect |  | - Reputation      | |
  |  +------------------+  +-------------------+ |
  |                                               |
  |  +------------------------------------------+ |
  |  | MCP Server (6 tools)                     | |
  |  | vault_status | position | apy            | |
  |  | alerts | risk_analysis | dry_run_stake   | |
  |  +------------------------------------------+ |
  +-----------------------------------------------+
          |                     |
   Ethereum Mainnet      Base Sepolia
   (Lido contracts)     (ERC-8004 registry)
```

## Hackathon Tracks

| Track | Sponsor | Prize |
|-------|---------|-------|
| Best Use of EigenCompute | EigenCloud | $5,000 |
| Agents With Receipts (ERC-8004) | Protocol Labs | $4,000 |
| Let the Agent Cook | Protocol Labs | $4,000 |
| Vault Position Monitor + Alert Agent | Lido Labs | $1,500 |
| Zyfai Native Wallet & Subaccount | Zyfai | $500 |
| Yield-Powered AI Agents | Zyfai | $600 |

## Quick Start

```bash
# Install dependencies
npm install

# Copy env and configure
cp .env.example .env

# Run the agent (read-only monitoring, no keys needed)
npm run agent

# Run MCP server (for other agents)
npm run mcp

# Run dashboard
cd frontend && npm install && npm run dev
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_vault_status` | Current Lido vault health metrics |
| `get_position` | Check wallet's stETH/wstETH position |
| `get_apy` | Current and 7-day average APY |
| `get_alerts` | Recent alert history |
| `analyze_risk` | Risk assessment for a position |
| `dry_run_stake` | Simulate staking without executing |

## Self-Funding Economy

Sentinel uses Zyfai's programmable yield infrastructure to fund its own operations:

1. Deposited funds go into a Zyfai Safe (ERC-4337 wallet)
2. Zyfai optimizes yield across DeFi protocols
3. Agent withdraws only earned yield, never principal
4. Yield covers gas costs, compute, and alert delivery

## ERC-8004 Identity

The agent registers with the ERC-8004 Identity Registry on Base Sepolia:
- Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- Agent Card: Discoverable via `.well-known/agent-card.json`
- Reputation: Tracked via Reputation Registry

## Docker / EigenCompute Deployment

```bash
# Build Docker image
docker build -t sentinel-agent .

# Run locally
docker-compose up

# Deploy to EigenCompute
ecloud compute app deploy --image-ref sentinel-agent:latest
```

## Tech Stack

- **TypeScript** with strict mode
- **viem** for Ethereum interactions
- **@zyfai/sdk** for yield management
- **@modelcontextprotocol/sdk** for MCP server
- **Telegraf** for Telegram bot
- **Next.js 15** for dashboard
- **Docker** for EigenCompute deployment

## Project Structure

```
sentinel/
  src/
    agent/sentinel.ts    # Core agent orchestrator
    lido/monitor.ts      # Lido vault monitoring
    zyfai/yield-manager.ts # Self-funding yield management
    identity/erc8004.ts  # ERC-8004 identity registration
    telegram/bot.ts      # Telegram alert delivery
    mcp/server.ts        # MCP tool server (6 tools)
    utils/               # Config, logging
  frontend/              # Next.js dashboard
  scripts/               # Registration scripts
  docker-compose.yml     # Local deployment
  Dockerfile             # EigenCompute TEE container
  agent.json             # Agent manifest
```

## License

MIT
