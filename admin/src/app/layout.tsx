import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "lovable-parser",
  description:
    "Design-quality crawler for lovable.app — screenshots, Gemini Vision scoring, and a filterable results explorer.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="shrink-0">
              <Logo />
            </Link>
            <NavLinks />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
          {children}
        </main>
        <footer className="border-t border-line py-5">
          <p className="mx-auto max-w-7xl px-4 text-xs text-ink-3 sm:px-6">
            lovable-parser — CommonCrawl + Wayback discovery · Playwright
            screenshots · Gemini Vision scoring
          </p>
        </footer>
      </body>
    </html>
  );
}
