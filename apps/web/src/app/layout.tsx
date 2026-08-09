import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import "./ui.css";
import "./data.css";

/**
 * Two faces, one job each. Archivo (a grotesque cut for signage) carries
 * headings and controls; Plex Mono carries every number, label and readout.
 * The mono face is the identity: instrument panels set data in fixed-width
 * type because columns of readings must align, and so do ours.
 */
const display = Archivo({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: { default: "Uptick", template: "%s · Uptick" },
  description: "Distributed uptime monitoring, incident tracking, and status pages",
};

export const viewport: Viewport = {
  themeColor: "#0b0c0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
