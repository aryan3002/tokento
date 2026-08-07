import type { Metadata } from "next";
import { Newsreader, Public_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Type system per the brand brief: an editorial serif for display, a humanist
 * sans for body, a characterful mono for figures and technical readouts.
 * Inter is deliberately absent — the brief names it as a thing to avoid.
 */
const display = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const body = Public_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-ui",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tokento — Merchant Ledger",
  description:
    "The loyalty layer for AI shopping agents. Issue tokens, watch agents redeem them, and keep your rewards visible at agent checkout.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-surface-0 text-text-primary">
        {children}
      </body>
    </html>
  );
}
