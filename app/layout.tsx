import type { Metadata, Viewport } from "next";
import "./globals.css";
import SafetyBanner from "@/components/SafetyBanner";
import { GameProvider } from "@/lib/gameStore";
import { RoomProvider } from "@/lib/roomClient";

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
        <RoomProvider>
          <GameProvider>
            {/*
              max-w-3xl (768px) เป็นความกว้างที่อ่านข้อความยาวได้สบาย จึงยังเป็นฐาน
              แต่บนจอ 1440px มันเหลือที่ว่างสองข้างรวม 47% ของจอ ซึ่งเปล่าประโยชน์
              สำหรับเกมที่มักฉายขึ้นจอใหญ่ให้คนดูหลายคน จึงขยายเป็น 896px บนจอ xl
              ไม่ขยายไปมากกว่านี้เพราะบรรทัดข้อความจะยาวจนสายตาไล่ไม่ทัน
            */}
            <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-5 sm:px-6 xl:max-w-4xl">
              {children}
            </main>
          </GameProvider>
        </RoomProvider>
      </body>
    </html>
  );
}
