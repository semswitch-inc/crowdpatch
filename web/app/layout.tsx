import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Archivo (sans). Note: ships as 300/500/600/700 — no 400.
// We expose it as --font-sans so Tailwind v4's @theme picks it up.
const archivo = localFont({
  variable: "--font-sans",
  display: "swap",
  src: [
    {
      path: "../public/fonts/archivo-v25-latin-300.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "../public/fonts/archivo-v25-latin-500.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/archivo-v25-latin-600.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/fonts/archivo-v25-latin-700.woff2",
      weight: "700",
      style: "normal",
    },
  ],
});

// SUSE Mono. 500 is the de-facto regular; 600 for emphasis.
const suseMono = localFont({
  variable: "--font-mono",
  display: "swap",
  src: [
    {
      path: "../public/fonts/suse-mono-v1-latin-500.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/suse-mono-v1-latin-600.woff2",
      weight: "600",
      style: "normal",
    },
  ],
});

export const metadata: Metadata = {
  title: "CrowdPatch",
  description:
    "Closed-loop bug-fix economy — file a bug, an Anthropic Managed Agent on Opus 4.6 ships the PR.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${suseMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
