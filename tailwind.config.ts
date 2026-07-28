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
        stage: {
          bg: "#080B1A",
          panel: "#111634",
          edge: "#242C5C",
        },
      },
      boxShadow: {
        glow: "0 0 24px rgba(168, 85, 247, 0.35)",
        "glow-cyan": "0 0 24px rgba(34, 211, 238, 0.35)",
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
