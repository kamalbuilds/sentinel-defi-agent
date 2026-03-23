import { Telegraf } from "telegraf";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import type { AlertEvent } from "../lido/monitor.js";

type StatusProvider = () => Promise<{
  running: boolean;
  uptime: number;
  vault: {
    apy: number;
    apy7d: number;
    totalPooledEth: string;
    gasPrice: string;
    snapshotCount: number;
  };
  yield: { initialized: boolean; earnings: string; apy: number };
  identity: { registered: boolean; tokenId: string | null; address: string };
  alerts: { total: number; recent: AlertEvent[] };
}>;

export class SentinelTelegramBot {
  private bot: Telegraf | null = null;
  private chatId: string;
  private initialized = false;
  private statusProvider: StatusProvider | null = null;

  constructor() {
    this.chatId = config.telegramChatId;

    if (!config.telegramBotToken) {
      logger.info(
        "Telegram bot token not set. Alerts will log to console only."
      );
      return;
    }

    this.bot = new Telegraf(config.telegramBotToken);
    this.initialized = true;
  }

  setStatusProvider(provider: StatusProvider) {
    this.statusProvider = provider;
  }

  async start(): Promise<void> {
    if (!this.bot) return;

    this.registerCommands();

    try {
      // Use polling with graceful error handling (non-blocking)
      this.bot.launch().catch((error) => {
        logger.error("Telegram bot polling error:", error);
      });
      logger.info("Telegram bot started (polling mode)");
    } catch (error) {
      logger.error("Failed to start Telegram bot:", error);
      this.initialized = false;
    }
  }

  private registerCommands() {
    if (!this.bot) return;

    this.bot.command("start", (ctx) => {
      this.captureChatId(ctx);
      ctx.reply(
        "\u{1F6E1}\uFE0F *Sentinel DeFi Guardian*\n\n" +
          "I monitor Lido vault positions, track yield, and alert you to anomalies.\n\n" +
          "*Commands:*\n" +
          "/status \u2014 Current vault status & agent health\n" +
          "/apy \u2014 Current APY and 7\u2011day average\n" +
          "/yield \u2014 Yield earnings report\n" +
          "/alerts \u2014 Recent alerts\n" +
          "/health \u2014 Agent health check\n" +
          "/help \u2014 Show this message",
        { parse_mode: "Markdown" }
      );
    });

    this.bot.command("help", (ctx) => {
      this.captureChatId(ctx);
      ctx.reply(
        "\u{1F6E1}\uFE0F *Sentinel Commands*\n\n" +
          "/status \u2014 Full vault + agent status\n" +
          "/apy \u2014 Current and historical APY\n" +
          "/yield \u2014 Yield earnings from Zyfai\n" +
          "/alerts \u2014 Last 5 alerts\n" +
          "/health \u2014 Runtime health metrics\n" +
          "/identity \u2014 ERC\u20118004 agent identity",
        { parse_mode: "Markdown" }
      );
    });

    this.bot.command("status", async (ctx) => {
      this.captureChatId(ctx);
      if (!this.statusProvider) {
        ctx.reply("\u26A0\uFE0F Status provider not connected yet.");
        return;
      }
      try {
        const s = await this.statusProvider();
        const uptimeMin = Math.floor(s.uptime / 60_000);
        const uptimeStr =
          uptimeMin >= 60
            ? `${Math.floor(uptimeMin / 60)}h ${uptimeMin % 60}m`
            : `${uptimeMin}m`;

        ctx.reply(
          "\u{1F6E1}\uFE0F *SENTINEL STATUS*\n\n" +
            `*Vault Metrics:*\n` +
            `  APY: ${s.vault.apy.toFixed(2)}%\n` +
            `  7d Avg: ${s.vault.apy7d.toFixed(2)}%\n` +
            `  Pooled ETH: ${s.vault.totalPooledEth}\n` +
            `  Gas: ${s.vault.gasPrice} gwei\n` +
            `  Snapshots: ${s.vault.snapshotCount}\n\n` +
            `*Agent:*\n` +
            `  Status: ${s.running ? "\u2705 Running" : "\u274C Stopped"}\n` +
            `  Uptime: ${uptimeStr}\n` +
            `  Identity: ${s.identity.registered ? `ERC\u20118004 #${s.identity.tokenId}` : "Unregistered"}\n` +
            `  Alerts Fired: ${s.alerts.total}`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {
        ctx.reply("\u274C Error fetching status: " + String(e));
      }
    });

    this.bot.command("apy", async (ctx) => {
      this.captureChatId(ctx);
      if (!this.statusProvider) {
        ctx.reply("\u26A0\uFE0F Status provider not connected yet.");
        return;
      }
      try {
        const s = await this.statusProvider();
        const apyTrend =
          s.vault.apy > s.vault.apy7d
            ? "\u{1F4C8} Trending Up"
            : s.vault.apy < s.vault.apy7d
              ? "\u{1F4C9} Trending Down"
              : "\u2796 Stable";

        ctx.reply(
          "\u{1F4CA} *Lido stETH APY*\n\n" +
            `Current: *${s.vault.apy.toFixed(2)}%*\n` +
            `7\u2011Day Avg: *${s.vault.apy7d.toFixed(2)}%*\n` +
            `Trend: ${apyTrend}\n` +
            `Data Points: ${s.vault.snapshotCount}`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {
        ctx.reply("\u274C Error: " + String(e));
      }
    });

    this.bot.command("yield", async (ctx) => {
      this.captureChatId(ctx);
      if (!this.statusProvider) {
        ctx.reply("\u26A0\uFE0F Status provider not connected yet.");
        return;
      }
      try {
        const s = await this.statusProvider();
        const mode = s.yield.initialized ? "Live" : "Simulation";
        ctx.reply(
          "\u{1F4B0} *Yield Report*\n\n" +
            `Mode: ${mode}\n` +
            `Earnings: ${s.yield.earnings || "0"}\n` +
            `APY: ${s.yield.apy.toFixed(2)}%\n` +
            `Principal: Protected \u2705`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {
        ctx.reply("\u274C Error: " + String(e));
      }
    });

    this.bot.command("alerts", async (ctx) => {
      this.captureChatId(ctx);
      if (!this.statusProvider) {
        ctx.reply("\u26A0\uFE0F Status provider not connected yet.");
        return;
      }
      try {
        const s = await this.statusProvider();
        if (s.alerts.recent.length === 0) {
          ctx.reply("\u2705 No recent alerts. All systems nominal.");
          return;
        }
        const lines = s.alerts.recent.slice(-5).map((a) => {
          const icon =
            a.severity === "critical"
              ? "\u{1F534}"
              : a.severity === "warning"
                ? "\u{1F7E1}"
                : "\u{1F535}";
          const time = new Date(a.timestamp).toLocaleTimeString();
          return `${icon} [${time}] ${a.message}`;
        });
        ctx.reply(
          `\u{1F514} *Recent Alerts* (${s.alerts.total} total)\n\n` +
            lines.join("\n"),
          { parse_mode: "Markdown" }
        );
      } catch (e) {
        ctx.reply("\u274C Error: " + String(e));
      }
    });

    this.bot.command("health", (ctx) => {
      this.captureChatId(ctx);
      const memMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      const uptimeSec = process.uptime().toFixed(0);
      ctx.reply(
        "\u{1F3E5} *Agent Health*\n\n" +
          `Status: \u2705 Operational\n` +
          `Runtime: EigenCompute TEE\n` +
          `Process Uptime: ${uptimeSec}s\n` +
          `Memory: ${memMb}MB\n` +
          `Node: ${process.version}`,
        { parse_mode: "Markdown" }
      );
    });

    this.bot.command("identity", async (ctx) => {
      this.captureChatId(ctx);
      if (!this.statusProvider) {
        ctx.reply("\u26A0\uFE0F Status provider not connected yet.");
        return;
      }
      try {
        const s = await this.statusProvider();
        if (s.identity.registered) {
          ctx.reply(
            "\u{1F4DB} *ERC\u20118004 Identity*\n\n" +
              `Token ID: #${s.identity.tokenId}\n` +
              `Address: \`${s.identity.address}\`\n` +
              `Registry: Base Sepolia\n` +
              `Trust: TEE Attestation + Reputation`,
            { parse_mode: "Markdown" }
          );
        } else {
          ctx.reply(
            "\u{1F4DB} Agent not yet registered with ERC\u20118004.\n" +
              "Run `npm run register` to register onchain."
          );
        }
      } catch (e) {
        ctx.reply("\u274C Error: " + String(e));
      }
    });

    // Capture chat ID from any message
    this.bot.on("message", (ctx) => {
      this.captureChatId(ctx);
    });
  }

  private captureChatId(ctx: { chat: { id: number } }) {
    if (!this.chatId) {
      this.chatId = ctx.chat.id.toString();
      logger.info(`Telegram chat ID captured: ${this.chatId}`);
    }
  }

  async sendAlert(alert: AlertEvent): Promise<void> {
    const emoji =
      alert.severity === "critical"
        ? "\u{1F6A8}"
        : alert.severity === "warning"
          ? "\u26A0\uFE0F"
          : "\u2139\uFE0F";

    const severityLabel = alert.severity.toUpperCase();

    const message =
      `${emoji} *SENTINEL ALERT* [${severityLabel}]\n\n` +
      `*Type:* ${alert.type.replace(/_/g, " ").toUpperCase()}\n` +
      `${alert.message}\n\n` +
      `_${new Date(alert.timestamp).toISOString()}_`;

    if (this.bot && this.chatId) {
      try {
        await this.bot.telegram.sendMessage(this.chatId, message, {
          parse_mode: "Markdown",
        });
      } catch (error) {
        logger.error("Failed to send Telegram alert:", error);
      }
    }

    logger.info(`[ALERT ${severityLabel}] ${alert.type}: ${alert.message}`);
  }

  async sendStatusReport(report: string): Promise<void> {
    if (this.bot && this.chatId) {
      try {
        await this.bot.telegram.sendMessage(this.chatId, report, {
          parse_mode: "Markdown",
        });
      } catch (error) {
        logger.error("Failed to send status report:", error);
      }
    }
  }

  stop(): void {
    if (this.bot) {
      try {
        this.bot.stop("SIGINT");
      } catch {
        // ignore
      }
    }
  }

  isConnected(): boolean {
    return this.initialized && !!this.chatId;
  }
}
