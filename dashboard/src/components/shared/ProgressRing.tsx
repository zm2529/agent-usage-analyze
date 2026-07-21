import { cn } from '@/lib/utils';
import { getScoreTier } from '@/lib/score-utils';

interface ProgressRingProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

const STROKE_COLORS: Record<string, string> = {
  excellent: 'stroke-green-500',
  good: 'stroke-yellow-500',
  fair: 'stroke-orange-500',
  poor: 'stroke-red-500',
};

const FILL_COLORS: Record<string, string> = {
  excellent: 'fill-green-500',
  good: 'fill-yellow-500',
  fair: 'fill-orange-500',
  poor: 'fill-red-500',
};

export function ProgressRing({
  value,
  max = 100,
  size = 64,
  strokeWidth = 5,
  className,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(value / max, 0), 1);
  const offset = circumference * (1 - progress);
  const center = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Score: ${value} out of ${max}`}
      className={cn('shrink-0', className)}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        className="stroke-muted"
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`}
        className={cn('transition-all duration-500', STROKE_COLORS[getScoreTier(value)])}
      />
      <text
        x={center}
        y={center}
        textAnchor="middle"
        dominantBaseline="central"
        className={cn('text-lg font-bold', FILL_COLORS[getScoreTier(value)])}
        style={{ fontSize: size * 0.3 }}
      >
        {value}
      </text>
    </svg>
  );
}
