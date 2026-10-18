import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Floating blueprint panel: navy surface, thin cyan rule, mono heading. */
export function Panel({
  title,
  children,
  className = '',
  bodyClassName = 'p-3',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`rounded-md border border-line bg-navy-900/85 shadow-lg shadow-black/40 backdrop-blur ${className}`}
    >
      {title && (
        <h2 className="border-b border-line px-3 py-2 font-mono text-[11px] tracking-[0.2em] text-cyan-grid uppercase">
          {title}
        </h2>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Small toolbar or segmented button. `active` shows the selected state. */
export function Chip({
  active = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`cursor-pointer rounded-sm border px-2.5 py-1 font-mono text-[11px] tracking-wider uppercase transition-colors focus-visible:outline-2 focus-visible:outline-cyan-grid ${
        active
          ? 'border-cyan-grid bg-cyan-grid/15 text-cyan-grid'
          : 'border-line bg-navy-800/80 text-ink-muted hover:border-cyan-grid/60 hover:text-ink'
      } ${className}`}
      {...rest}
    />
  );
}
