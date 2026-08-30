import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Unbounded, Manrope } from "next/font/google";
import "./globals.css";

const unbounded = Unbounded({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Randep",
  description: "Chat with people and meet someone new, randomly.",
};

export const viewport: Viewport = {
  themeColor: "#060a13",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${unbounded.variable} ${manrope.variable}`}>
      <body
        className="antialiased"
        style={{
          background: "#060a13",
          color: "#eaf1fb",
          fontFamily: "var(--font-body), system-ui, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
