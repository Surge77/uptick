import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uptick",
  description: "Distributed uptime monitoring, incident tracking, and status pages",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
