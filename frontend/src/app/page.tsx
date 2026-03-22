"use client";

import { useEffect, useState } from "react";

interface AgentStatus {
  running: boolean;
  uptime: number;
  identity: {
    registered: boolean;
    tokenId: string | null;
    address: string;
  };
  vault: {
    apy: number;
    apy7d: number;
    totalPooledEth: string;
    gasPrice: string;
    snapshotCount: number;
  };
  yield: {
    initialized: boolean;
    earnings: string;
    apy: number;
  };
  alerts: {
    total: number;
    recent: {
      type: string;
      severity: string;
      message: string;
      timestamp: number;
    }[];
  };
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function StatusDot({ status }: { status: "ok" | "warning" | "critical" }) {
  return <span className={`status-dot ${status}`} />;
}

function MetricCard({
  label,
  value,
  suffix,
  status,
}: {
  label: string;
  value: string;
  suffix?: string;
  status?: "ok" | "warning" | "critical";
}) {
  return (
    <div className="card">
      <div className="label">
        {status && <StatusDot status={status} />}
        {label}
      </div>
      <div className="metric" style={{ color: status === "critical" ? "var(--critical)" : status === "warning" ? "var(--warning)" : "var(--accent)" }}>
        {value}
        {suffix && (
          <span style={{ fontSize: "0.875rem", color: "var(--text-dim)", marginLeft: 4 }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function AlertRow({ alert }: { alert: AgentStatus["alerts"]["recent"][0] }) {
  const severityColor = {
    info: "var(--info)",
    warning: "var(--warning)",
    critical: "var(--critical)",
  }[alert.severity] || "var(--text-dim)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span
        style={{
          fontSize: "0.7rem",
          fontWeight: 600,
          textTransform: "uppercase",
          color: severityColor,
          minWidth: 60,
          fontFamily: "Geist Mono, monospace",
        }}
      >
        {alert.severity}
      </span>
      <span style={{ flex: 1, fontSize: "0.875rem" }}>{alert.message}</span>
      <span
        style={{
          fontSize: "0.75rem",
          color: "var(--text-dim)",
          fontFamily: "Geist Mono, monospace",
        }}
      >
        {new Date(alert.timestamp).toLocaleTimeString()}
      </span>
    </div>
  );
}

export default function Dashboard() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
      setError(null);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <header style={{ marginBottom: 48 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "linear-gradient(135deg, #00d4aa, #0088ff)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              fontWeight: 800,
            }}
          >
            S
          </div>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
              Sentinel
            </h1>
            <p style={{ color: "var(--text-dim)", margin: 0, fontSize: "0.875rem" }}>
              Verifiable Autonomous DeFi Guardian
            </p>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            {status?.running ? (
              <span style={{ color: "var(--accent)", fontSize: "0.875rem" }}>
                <StatusDot status="ok" />
                Operational
              </span>
            ) : (
              <span style={{ color: "var(--critical)", fontSize: "0.875rem" }}>
                <StatusDot status="critical" />
                Offline
              </span>
            )}
            {lastUpdate && (
              <p style={{ color: "var(--text-dim)", margin: 0, fontSize: "0.75rem" }}>
                Updated {lastUpdate.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>

        {/* Trust badges */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {["TEE Attested", "ERC-8004 Identity", "Self-Funding", "Lido Monitor", "Zyfai Yield"].map(
            (badge) => (
              <span
                key={badge}
                style={{
                  fontSize: "0.7rem",
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  color: "var(--text-dim)",
                  fontFamily: "Geist Mono, monospace",
                }}
              >
                {badge}
              </span>
            )
          )}
        </div>
      </header>

      {error && (
        <div
          className="card"
          style={{
            borderColor: "var(--warning)",
            marginBottom: 24,
            color: "var(--warning)",
          }}
        >
          Agent not reachable: {error}. Start the agent with{" "}
          <code style={{ fontFamily: "Geist Mono, monospace" }}>npm run agent</code>
        </div>
      )}

      {/* Metrics Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <MetricCard
          label="stETH APY"
          value={status?.vault.apy.toFixed(2) || "---"}
          suffix="%"
          status="ok"
        />
        <MetricCard
          label="7d Average APY"
          value={status?.vault.apy7d.toFixed(2) || "---"}
          suffix="%"
          status="ok"
        />
        <MetricCard
          label="Total Pooled ETH"
          value={
            status?.vault.totalPooledEth
              ? Number(status.vault.totalPooledEth).toLocaleString()
              : "---"
          }
          suffix="ETH"
          status="ok"
        />
        <MetricCard
          label="Gas Price"
          value={status?.vault.gasPrice || "---"}
          suffix="gwei"
          status={
            Number(status?.vault.gasPrice || 0) > 100
              ? "critical"
              : Number(status?.vault.gasPrice || 0) > 50
                ? "warning"
                : "ok"
          }
        />
        <MetricCard
          label="Uptime"
          value={status ? formatUptime(status.uptime) : "---"}
          status="ok"
        />
        <MetricCard
          label="Snapshots"
          value={status?.vault.snapshotCount.toString() || "0"}
          status="ok"
        />
      </div>

      {/* Two Column Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Identity Card */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 16, marginTop: 0 }}>
            Agent Identity (ERC-8004)
          </h2>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div className="label">Status</div>
              <div style={{ fontFamily: "Geist Mono, monospace", fontSize: "0.875rem" }}>
                {status?.identity.registered ? (
                  <span style={{ color: "var(--accent)" }}>Registered</span>
                ) : (
                  <span style={{ color: "var(--text-dim)" }}>Not Registered</span>
                )}
              </div>
            </div>
            {status?.identity.tokenId && (
              <div>
                <div className="label">Token ID</div>
                <div style={{ fontFamily: "Geist Mono, monospace", fontSize: "0.875rem" }}>
                  #{status.identity.tokenId}
                </div>
              </div>
            )}
            <div>
              <div className="label">Wallet</div>
              <div
                style={{
                  fontFamily: "Geist Mono, monospace",
                  fontSize: "0.75rem",
                  wordBreak: "break-all",
                }}
              >
                {status?.identity.address || "Not configured"}
              </div>
            </div>
            <div>
              <div className="label">Runtime</div>
              <div style={{ fontFamily: "Geist Mono, monospace", fontSize: "0.875rem" }}>
                EigenCompute TEE
              </div>
            </div>
            <div>
              <div className="label">Trust Model</div>
              <div style={{ fontFamily: "Geist Mono, monospace", fontSize: "0.875rem" }}>
                TEE Attestation + Reputation
              </div>
            </div>
          </div>
        </div>

        {/* Yield Economy Card */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 16, marginTop: 0 }}>
            Agent Economy (Zyfai)
          </h2>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div className="label">Yield Engine</div>
              <div style={{ fontFamily: "Geist Mono, monospace", fontSize: "0.875rem" }}>
                {status?.yield.initialized ? (
                  <span style={{ color: "var(--accent)" }}>Active</span>
                ) : (
                  <span style={{ color: "var(--text-dim)" }}>Simulation Mode</span>
                )}
              </div>
            </div>
            <div>
              <div className="label">Total Earnings</div>
              <div style={{ fontFamily: "Geist Mono, monospace", fontSize: "1.25rem" }}>
                {status?.yield.earnings || "0"}
              </div>
            </div>
            <div>
              <div className="label">Yield APY</div>
              <div style={{ fontFamily: "Geist Mono, monospace", fontSize: "1.25rem" }}>
                {status?.yield.apy.toFixed(2) || "0.00"}%
              </div>
            </div>
            <div>
              <div className="label">Principal Protected</div>
              <div style={{ fontFamily: "Geist Mono, monospace", fontSize: "0.875rem", color: "var(--accent)" }}>
                Yes (never withdraws principal)
              </div>
            </div>
            <div>
              <div className="label">Strategy</div>
              <div style={{ fontFamily: "Geist Mono, monospace", fontSize: "0.875rem" }}>
                Conservative (multi-protocol DeFi)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts Section */}
      <div className="card" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 16, marginTop: 0 }}>
          Recent Alerts ({status?.alerts.total || 0} total)
        </h2>
        {status?.alerts.recent && status.alerts.recent.length > 0 ? (
          status.alerts.recent.map((alert, i) => (
            <AlertRow key={i} alert={alert} />
          ))
        ) : (
          <p style={{ color: "var(--text-dim)", margin: 0, fontSize: "0.875rem" }}>
            No alerts yet. Agent is monitoring Lido vault positions.
          </p>
        )}
      </div>

      {/* Architecture Section */}
      <div className="card" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 16, marginTop: 0 }}>
          Architecture
        </h2>
        <pre
          style={{
            fontFamily: "Geist Mono, monospace",
            fontSize: "0.75rem",
            color: "var(--text-dim)",
            lineHeight: 1.6,
            overflow: "auto",
            margin: 0,
          }}
        >
{`  EigenCompute TEE Container
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
   (Lido contracts)     (ERC-8004 registry)`}
        </pre>
      </div>

      {/* Footer */}
      <footer
        style={{
          marginTop: 48,
          paddingTop: 24,
          borderTop: "1px solid var(--border)",
          color: "var(--text-dim)",
          fontSize: "0.75rem",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>Sentinel v0.1.0 | Synthesis Hackathon 2026</span>
        <span>
          Tracks: EigenCompute | ERC-8004 | Vault Monitor | Zyfai | Let the Agent Cook
        </span>
      </footer>
    </div>
  );
}
