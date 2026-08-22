interface IdleScreenProps {
  heading: string;
  subtitle: string;
}

/** Visual base do estado ocioso (cursor piscando + título + texto de apoio),
 * reaproveitado tanto pra "nenhuma aba aberta" (EmptyState) quanto pra "aba
 * nova, ainda sem nenhuma mensagem" (ChatIdleState). */
export function IdleScreen({ heading, subtitle }: IdleScreenProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="animate-cursor-blink font-mono text-3xl text-text-faint">▍</span>
      <h2 className="text-lg font-medium text-foreground">{heading}</h2>
      <p className="max-w-xs text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
