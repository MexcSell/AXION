import * as T from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

export function TipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={250} skipDelayDuration={150}>{children}</T.Provider>;
}

/** Tooltip shown on hover AND keyboard focus. Child must forward refs (native elements do). */
export function Tip({ label, children, side = 'top', shortcut }: { label: ReactNode; children: ReactElement; side?: 'top' | 'bottom' | 'left' | 'right'; shortcut?: string }) {
  if (!label) return children;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content className="tooltip" side={side} sideOffset={6} collisionPadding={8}>
          <span className="row" style={{ gap: 8 }}>{label}{shortcut && <span className="kbd">{shortcut}</span>}</span>
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
