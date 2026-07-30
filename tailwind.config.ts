import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      /**
       * ขยายขนาดตัวอักษรและระยะห่างบรรทัดทั้งระบบ เพื่อภาษาไทยโดยเฉพาะ
       *
       * ค่ามาตรฐานของ Tailwind ออกแบบมาบนภาษาที่ไม่มีวรรณยุกต์ซ้อนชั้น
       * ภาษาไทยมีทั้งสระบน สระล่าง และวรรณยุกต์ที่ลอยเหนือสระอีกที
       * ใช้ line-height 1.33 ของ text-xs แล้ววรรณยุกต์บรรทัดบนเกือบชนสระบรรทัดล่าง
       * อ่านยาวแล้วล้าตามาก ซึ่งเป็นสิ่งที่ผู้ใช้รายงานมาตรง ๆ
       *
       * แก้ที่นี่ที่เดียวแทนการไล่แก้ className ทีละที่ ทุก text-xs/sm/base
       * ในโปรเจกต์จึงใหญ่ขึ้นและหายใจได้ขึ้นพร้อมกันทั้งหมด
       */
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.5rem" }], // 13px / 24px (เดิม 12/16)
        sm: ["0.9375rem", { lineHeight: "1.65rem" }], // 15px / 26px (เดิม 14/20)
        base: ["1.0625rem", { lineHeight: "1.8rem" }], // 17px / 29px (เดิม 16/24)
        lg: ["1.1875rem", { lineHeight: "1.95rem" }], // 19px / 31px (เดิม 18/28)
        xl: ["1.3125rem", { lineHeight: "2.1rem" }], // 21px / 34px (เดิม 20/28)
      },
      fontFamily: {
        thai: [
          "Noto Sans Thai",
          "IBM Plex Sans Thai",
          "Leelawadee UI",
          "Tahoma",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        // โทนเย็น: กรมท่า-น้ำเงิน-ฟ้า
        stage: {
          bg: "#050B18",
          panel: "#0B182E",
          edge: "#1B3155",
        },
      },
      boxShadow: {
        glow: "0 0 24px rgba(56, 189, 248, 0.35)",
        "glow-teal": "0 0 24px rgba(45, 212, 191, 0.32)",
        "glow-indigo": "0 0 24px rgba(99, 102, 241, 0.32)",
      },
      keyframes: {
        popIn: {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        pulseRing: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        popIn: "popIn 220ms ease-out both",
        pulseRing: "pulseRing 900ms ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
