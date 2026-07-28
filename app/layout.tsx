import type { Metadata, Viewport } from "next";
import "./globals.css";
import SafetyBanner from "@/components/SafetyBanner";
import { GameProvider } from "@/lib/gameStore";

export const metadata: Metadata = {
  title: "ใบ้จริง...ใบ้หลอก — Playable Demo",
  description:
    "Prototype ทดสอบกลไกเกมโชว์ 'ใบ้จริง...ใบ้หลอก' ขับเคลื่อนคำใบ้ด้วย Claude API",
};

export const viewport: Viewport = {
  themeColor: "#080B1A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* โหลดฟอนต์ไทยแบบไม่บล็อก — ถ้าออฟไลน์จะ fallback ไปฟอนต์ระบบเอง */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>
        <SafetyBanner />
        <GameProvider>
          <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-5 sm:px-6">
            {children}
          </main>
        </GameProvider>
      </body>
    </html>
  );
}
