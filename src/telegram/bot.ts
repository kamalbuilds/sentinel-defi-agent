import { Telegraf } from "telegraf";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import type { AlertEvent } from "../lido/monitor.js";

export class SentinelTelegramBot {
  private bot: Telegraf | null = null;
  private chatId: string;
  private initialized = false;

  constructor() {
    this.chatId = config.telegramChatId;

    if (!config.telegramBotToken) {
      logger.warn("Telegram bot token not set. Alerts will only log to console.");
      return;
    }

    this.bot = new Telegraf(config.telegramBotToken);
    this.initialized = true;
  }

  async start(): Promise<void> {
    if (!this.bot) return;

    this.bot.command("start", (ctx) => {
      ctx.reply(
        "Welcome to Sentinel DeFi Guardian!\n\n" +
          "I monitor Lido vault positions, track yield, and alert you to anomalies.\n\n" +
          "Commands:\n" +
          "/status - Current vault status\n" +
          "/apy - Current APY and 7-day average\n" +
          "/position - Your position details\n" +
          "/yield - Yield earnings report\n" +
          "/alerts - Recent alerts\n" +
          "/health - Agent health check"
      );
    });

    this.bot.command("health", (ctx) => {
      ctx.reply(
        "Agent Health: OPERATIONAL\n" +
          `Runtime: EigenCompute TEE\n` +
          `Identity: ERC-8004 Registered\n` +
          `Uptime: ${process.uptime().toFixed(0)}s\n` +
          `Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MB`
      );
    });

    // Store chat IDs from incoming messages
    this.bot.on("message", (ctx) => {
      if (!this.chatId) {
        this.chatId = ctx.chat.id.toString();
        logger.info(`Chat ID captured: ${this.chatId}`);
      }
    });

    try {
      await this.bot.launch();
      logger.info("Telegram bot started");
    } catch (error) {
      logger.error("Failed to start Telegram bot:", error);
    }
  }

  async sendAlert(alert: AlertEvent): Promise<void> {
    const emoji = {
      info: "i",
      warning: "!",
      critical: "!!",
    }[alert.severity];

    const severityLabel = alert.severity.toUpperCase();

    const message =
      `[${emoji}] SENTINEL ALERT - ${severityLabel}\n\n` +
      `Type: ${alert.type.replace(/_/g, " ").toUpperCase()}\n` +
      `${alert.message}\n\n` +
      `Time: ${new Date(alert.timestamp).toISOString()}\n` +
      `Data: ${JSON.stringify(alert.data, null, 2)}`;

    if (this.bot && this.chatId) {
      try {
        await this.bot.telegram.sendMessage(this.chatId, message);
      } catch (error) {
        logger.error("Failed to send Telegram alert:", error);
      }
    }

    // Always log
    logger.info(`[ALERT] ${message}`);
  }

  async sendStatusUpdate(status: {
    apy: number;
    apy7d: number;
    totalPooledEth: string;
    gasPrice: string;
    yieldEarnings: string;
    agentIdentity: string;
  }): Promise<void> {
    const message =
      `SENTINEL STATUS REPORT\n\n` +
      `Lido Vault:\n` +
      `  APY: ${status.apy.toFixed(2)}%\n` +
      `  7d Avg APY: ${status.apy7d.toFixed(2)}%\n` +
      `  Total Pooled: ${status.totalPooledEth} ETH\n` +
      `  Gas: ${status.gasPrice} gwei\n\n` +
      `Agent Economy:\n` +
      `  Yield Earned: ${status.yieldEarnings}\n` +
      `  Identity: ${status.agentIdentity}\n` +
      `  Runtime: EigenCompute TEE`;

    if (this.bot && this.chatId) {
      try {
        await this.bot.telegram.sendMessage(this.chatId, message);
      } catch (error) {
        logger.error("Failed to send status update:", error);
      }
    }

    logger.info(message);
  }

  stop(): void {
    if (this.bot) {
      this.bot.stop("SIGINT");
    }
  }
}
