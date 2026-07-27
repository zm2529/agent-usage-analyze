import type { SVGProps } from 'react';

export function ProductMark({
  colored = false,
  ...props
}: SVGProps<SVGSVGElement> & { colored?: boolean }) {
  const frame = colored ? '#28666E' : 'currentColor';
  const insight = colored ? '#BF7A45' : 'currentColor';
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path d="M12 4L19 8V16L12 20L5 16V8L12 4Z" stroke={frame} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4 19L12 12" stroke={frame} strokeWidth="1.5" strokeDasharray="2 3" opacity=".5" />
      <path d="M12 12L20 5" stroke={frame} strokeWidth="1.5" />
      <path d="M12 10.5L13.5 12L12 13.5L10.5 12Z" fill={insight} />
    </svg>
  );
}

export function SettingsMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path d="M8 3L13 6V10L8 13L3 10V6L8 3Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="5.5" r=".75" fill="currentColor" />
    </svg>
  );
}
