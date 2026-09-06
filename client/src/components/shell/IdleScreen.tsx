interface IdleScreenProps {
  heading: string;
  subtitle: string;
}

/** Base visual for the idle state (blinking cursor + heading + supporting
 * text), reused both for "no tab open" (EmptyState) and "new tab, no
 * messages yet" (ChatIdleState). */
export function IdleScreen({ heading, subtitle }: IdleScreenProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="animate-cursor-blink font-mono text-3xl text-text-faint">▍</span>
      <h2 className="text-lg font-medium text-foreground">{heading}</h2>
      <p className="max-w-xs text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
