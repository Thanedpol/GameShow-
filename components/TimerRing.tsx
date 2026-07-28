"use client";

interface TimerRingProps {
  /** เวลาที่เหลือ (ms) */
  remaining: number;
  /** เวลาเต็ม (ms) */
  total: number;
  label?: string;
  paused?: boolean;
  size?: number;
}

export default function TimerRing({
  remaining,
  total,
  label,
  paused = false,
  size = 92,
}: TimerRingProps) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const seconds = Math.ceil(remaining / 1000);
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * ratio;

  const tone =
    ratio > 0.5
      ? "#22d3ee"
      : ratio > 0.25
        ? "#facc15"
        : "#fb7185";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.09)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            style={{ transition: "stroke-dasharray 80ms linear, stroke 300ms linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={`tabular text-2xl font-extrabold ${
              paused ? "text-slate-400" : "text-white"
            } ${!paused && ratio <= 0.25 ? "animate-pulseRing" : ""}`}
          >
            {paused ? "⏸" : seconds}
          </span>
        </div>
      </div>
      {label ? (
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {label}
        </span>
      ) : null}
    </div>
  );
}
