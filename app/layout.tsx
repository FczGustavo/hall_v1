import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HAL Voice Interface",
  description: "Minimal retro-futuristic voice AI interface",
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
