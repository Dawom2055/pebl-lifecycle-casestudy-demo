import type { Metadata } from "next";
import { JetBrains_Mono, Public_Sans, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const display = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"], weight: ["600", "700", "800"] });
const body = Public_Sans({ variable: "--font-public", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["500"] });

export const metadata: Metadata = {
  title: "Lifecycle Automation Demo",
  description:
    "Interactive concept demo of an AI-assisted compliance layer for EOR expenses, leave and time. Case study by Muhammad Dawood; not affiliated with Pebl.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
