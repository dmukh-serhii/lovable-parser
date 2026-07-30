/**
 * lovable-parser logo — minimal mark (heart inside terminal brackets,
 * i.e. "loved by the parser") + wordmark. Pure SVG, no assets.
 */

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      {/* left angle bracket */}
      <path
        d="M9.5 11 L5.5 16 L9.5 21"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      {/* right angle bracket */}
      <path
        d="M22.5 11 L26.5 16 L22.5 21"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      {/* heart */}
      <path
        d="M16 21.6 C13 19.4 11.4 17.6 11.4 15.6 C11.4 14 12.6 12.8 14.1 12.8 C15 12.8 15.7 13.3 16 13.9 C16.3 13.3 17 12.8 17.9 12.8 C19.4 12.8 20.6 14 20.6 15.6 C20.6 17.6 19 19.4 16 21.6 Z"
        fill="#fff"
      />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <LogoMark />
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight text-ink">
          lovable<span className="text-accent-text">-</span>parser
        </span>
      )}
    </span>
  );
}
