import winston from "winston";
import { mkdirSync } from "fs";

// Ensure logs directory exists
try {
  mkdirSync("logs", { recursive: true });
} catch {
  // ignore
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "sentinel-agent" },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const ts = typeof timestamp === "string" ? timestamp.slice(11, 19) : "";
          const extra = Object.keys(meta).length > 1 ? ` ${JSON.stringify(meta)}` : "";
          return `${ts} ${level}: ${message}${extra}`;
        })
      ),
    }),
    new winston.transports.File({
      filename: "logs/sentinel.log",
      maxsize: 5_000_000,
      maxFiles: 3,
    }),
  ],
});
