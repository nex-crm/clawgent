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
  title: "Clawgent — Deploy AI Agents in 60 Seconds",
  description:
    "One-click OpenClaw instances pre-loaded with agent templates. Real skills. Retro vibes.",
  keywords: "Clawgent,OpenClaw,deploy,AI,agent,persona",
  openGraph: {
    title: "Clawgent — Deploy AI Agents in 60 Seconds",
    description:
      "One-click OpenClaw instances pre-loaded with agent templates. Real skills. Retro vibes.",
    url: "https://clawgent.ai",
    siteName: "Clawgent",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Clawgent — Deploy AI Agents in 60 Seconds",
    description:
      "Pre-loaded AI agents. One click. Retro arcade vibes.",
  },
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
      <head>
        {/* Preload sprite images so they appear instantly on the character grid */}
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <link key={n} rel="preload" as="image" href={`/sprites/character-${n}.png`} />
        ))}
      </head>
      <body className={`${arcadeFont.variable} ${inter.variable} antialiased`}>
        {content}
      </body>
    </html>
  );
}
