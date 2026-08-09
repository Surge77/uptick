/**
 * Brand mark: a phosphor trace on a square bezel — the oscilloscope face the
 * whole interface is styled after. Drawn rather than imported so it inherits
 * the token palette and costs no asset request.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="23" rx="2" fill="var(--bg, #0b0c0a)" />
      <rect x="0.5" y="0.5" width="23" height="23" rx="2" stroke="var(--border-strong, #333a32)" />
      {/* Bezel tick marks */}
      <path
        d="M4 20.5v-1.6M8 20.5v-1.6M12 20.5v-1.6M16 20.5v-1.6M20 20.5v-1.6"
        stroke="var(--border, #242923)"
        strokeWidth="1"
      />
      {/* The trace */}
      <path
        d="M3.5 13.5h3l2-6 3 9 2-5h7"
        stroke="var(--phosphor, #57e389)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
