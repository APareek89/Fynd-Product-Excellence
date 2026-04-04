import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fynd - Growth",
  description: "AI-powered PostHog growth dashboard builder. Configure your keys, select insights, and let AI build your dashboard.",
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
