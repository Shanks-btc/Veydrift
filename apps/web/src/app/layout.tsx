import type { Metadata } from "next";
import "./globals.css";
import Nav from "../components/Nav";

export const metadata: Metadata = {
  title: "Veydrift — Autonomous Spot Trading Agent",
  description:
    "Deterministic autonomous spot trading agent on Bitget. Risk score computed from live market signals — no LLM in the trading decision.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
