import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GoliteCommunity - Bot Trading PocketOption",
  description:
    "Plateforme SaaS de trading algorithmique pour options binaires. Bot signal et bot automatique pour PocketOption.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className="dark">
      <body className="min-h-screen bg-[#020617] text-white antialiased selection:bg-cyan-500/30">
        <div className="noise-overlay" />
        {children}
      </body>
    </html>
  );
}
