import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlyStellar - Decentralized Flight Booking",
  description: "Book flights on the Stellar blockchain",
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