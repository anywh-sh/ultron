import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The heading that opens a group of settings: an eyebrow with a rule under
 * it, not a title. The page already has one title (the profile's name, or
 * "Appearance") — these only say which part of it you are in.
 */
export function SettingsSectionHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3
      className={cn(
        "border-b border-border pt-6 pb-1 font-mono text-[9.5px] tracking-[0.13em] text-text-faint uppercase",
        className,
      )}
    >
      {children}
    </h3>
  );
}

/**
 * One setting: what it is on the left, the control that changes it on the
 * right, a rule between it and the next one. The description carries its
 * own weight — a setting nobody can explain in a sentence is a setting
 * nobody understands — so the left column is prose and the control column
 * only ever holds controls.
 */
export function SettingsRow({
  title,
  description,
  detail,
  children,
  className,
}: {
  title: string;
  description?: string;
  /** Rendered under the description, in the explaining column rather than
   * the control one — for a setting that has to show something to be
   * understood (the text-size sample). */
  detail?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-6 border-b border-border py-5", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13.5px] font-semibold text-foreground">{title}</span>
        {description && (
          <span className="text-xs leading-relaxed text-pretty text-muted-foreground">{description}</span>
        )}
        {detail && <div className="pt-1.5">{detail}</div>}
      </div>
      {children && <div className="flex shrink-0 flex-col items-end gap-2">{children}</div>}
    </div>
  );
}
