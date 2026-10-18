import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Floating plate: the one panel surface. The title is a serif caption with a rule under it. */
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
    <section className={`plate ${className}`}>
      {title && (
        <h2 className="border-b border-rule px-3 py-2 font-serif text-[13px] tracking-[0.2em] text-accent uppercase">
          {title}
        </h2>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * Toolbar or segmented button. `mono` is for controls; `serif` is for place names.
 * `active` shows the selected state.
 */
export function Chip({
  active = false,
  variant = 'mono',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; variant?: 'mono' | 'serif' }) {
  const face =
    variant === 'serif'
      ? 'font-serif text-[14px] tracking-wide'
      : 'font-mono text-[11px] tracking-wider uppercase';
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`cursor-pointer rounded-[2px] border px-2.5 py-1 transition-colors ${face} ${
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-rule bg-transparent text-ink-2 hover:border-accent hover:text-ink'
      } ${className}`}
      {...rest}
    />
  );
}
