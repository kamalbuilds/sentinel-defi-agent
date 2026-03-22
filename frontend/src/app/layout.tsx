import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sentinel | Verifiable DeFi Guardian",
  description:
    "Autonomous agent monitoring Lido vaults, self-funding from yield, with TEE-attested execution on EigenCompute",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
