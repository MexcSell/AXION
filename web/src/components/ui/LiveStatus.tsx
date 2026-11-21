import type { CSSProperties, ReactNode } from 'react';

/**
 * Cycle 23: one place for api-mode loading, busy and failed-load text, so a screen reader hears it.
 * loading = role="status" (polite); error = role="alert" (assertive). Markup and classes are the caller's, nothing visual is added.
 */
export function LiveStatus({ kind = 'loading', className, style, children, ...rest }: {
  kind?: 'loading' | 'error'; className?: string; style?: CSSProperties; children: ReactNode; [data: `data-${string}`]: string | undefined;
}) {
  return <div className={className} style={style} role={kind === 'error' ? 'alert' : 'status'} {...rest}>{children}</div>;
}
