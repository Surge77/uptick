/**
 * Brand mark: a rising step, echoing the uptime strip the product is built on.
 * Drawn rather than imported so it inherits colour and needs no asset request.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id="uptick-mark" x1="0" y1="24" x2="24" y2="0">
          <stop offset="0%" stopColor="var(--brand-2)" />
          <stop offset="100%" stopColor="var(--brand)" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="23" height="23" rx="6.5" fill="var(--surface-2)" />
      <rect x="0.5" y="0.5" width="23" height="23" rx="6.5" stroke="var(--border-strong)" />
      <path
        d="M6 15.5l3.6-4.2 3 2.6L18 8"
        stroke="url(#uptick-mark)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="8" r="2" fill="var(--brand)" />
    </svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="wordmark">
      <LogoMark size={size} />
      <span>Uptick</span>
    </span>
  );
}
