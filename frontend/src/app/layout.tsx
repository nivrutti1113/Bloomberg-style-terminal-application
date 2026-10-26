import type { Metadata } from "next";
import React from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "TERMINAL // Real-Time Market Analytics",
  description: "Low-latency Bloomberg-style keyboard-driven market analytics terminal.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark bg-[#000000] text-[#FFB000]">
      <body className="w-screen h-screen overflow-hidden bg-[#000000] text-[#FFB000]">
        {children}
      </body>
    </html>
  );
}
