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
    <html lang="fr">
      <body className="min-h-screen bg-gray-950 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
