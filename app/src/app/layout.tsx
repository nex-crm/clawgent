import type { Metadata } from "next";
import { Press_Start_2P, Inter } from "next/font/google";
import "./globals.css";

const arcadeFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-arcade",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "CLAWGENT — Deploy AI Agents",
  description:
    "Deploy AI agents in seconds. Pick your persona, enter your API key, and launch.",
  keywords: "Clawgent,OpenClaw,deploy,AI,agent,persona",
};

const workosConfigured =
  !!process.env.WORKOS_CLIENT_ID &&
  !!process.env.WORKOS_API_KEY &&
  !!process.env.WORKOS_COOKIE_PASSWORD;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let content = children;

  if (workosConfigured) {
    const { AuthKitProvider } = await import(
      "@workos-inc/authkit-nextjs/components"
    );
    content = <AuthKitProvider>{children}</AuthKitProvider>;
  }

  return (
    <html lang="en">
      <body className={`${arcadeFont.variable} ${inter.variable} antialiased`}>
        {content}
      </body>
    </html>
  );
}
