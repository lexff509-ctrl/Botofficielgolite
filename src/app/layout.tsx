import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Botofficielgolite",
  description: "Bot automation and trading signal platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
