interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Agent 使用分析标志"
      className={className}
    >
      {/* Magnifying glass circle */}
      <circle
        cx="11"
        cy="10"
        r="6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Magnifying glass handle */}
      <line
        x1="15.8"
        y1="15"
        x2="20"
        y2="19.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Sparkle — vertical */}
      <line
        x1="11"
        y1="6.5"
        x2="11"
        y2="13.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* Sparkle — horizontal */}
      <line
        x1="7.5"
        y1="10"
        x2="14.5"
        y2="10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* Sparkle — diagonal 1 */}
      <line
        x1="8.5"
        y1="7.5"
        x2="13.5"
        y2="12.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* Sparkle — diagonal 2 */}
      <line
        x1="13.5"
        y1="7.5"
        x2="8.5"
        y2="12.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}
