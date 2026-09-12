/**
 * The mark: a filled accent square with a chevron and a bar cut out of it.
 *
 * `currentColor` is deliberately not used — the square is always the brand
 * accent and the glyph inside it always the ink that reads on it. A mark
 * that recolored with its surroundings would stop being the mark.
 */
export function AnywhLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" className="fill-primary" />
      <path
        d="M10.6 8.7L18.2 16l-7.6 7.3"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="22.5" y="11.3" width="4.4" height="9.4" rx="2.2" className="fill-primary-foreground" />
    </svg>
  );
}

/**
 * The lockup — mark plus wordmark. `anywh.sh` (with the dot) is the wordmark
 * form, which is what belongs beside the mark; the bare `anywh` noun is for
 * prose and identifiers, and the two are not interchangeable.
 */
export function AnywhLockup({ className }: { className?: string }) {
  return (
    <span className={className}>
      <AnywhLogo className="size-[18px] shrink-0" />
      <span className="truncate font-mono text-[13px] font-semibold tracking-[-0.02em] text-foreground">anywh.sh</span>
    </span>
  );
}
