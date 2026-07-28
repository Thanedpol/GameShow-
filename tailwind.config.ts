import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
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
