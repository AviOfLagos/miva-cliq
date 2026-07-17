import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Miva Cliq",
  description: "Auto-complete your Miva coursework in minutes, not hours.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
