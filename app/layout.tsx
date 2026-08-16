import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { loadConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Align",
  description: "Anakloud strategic alignment questionnaire",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Boot configuration is read server-side on every render (F01-T01).
  loadConfig();
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}