import * as D from '@radix-ui/react-dropdown-menu';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

export interface MenuItemDef { label: string; icon?: LucideIcon; onSelect: () => void; danger?: boolean; disabled?: boolean; sep?: boolean; }

export function Menu({ trigger, items, align = 'end' }: { trigger: ReactElement; items: MenuItemDef[]; align?: 'start' | 'end' | 'center' }) {
  return (
    <D.Root>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Content className="menu" align={align} sideOffset={6} collisionPadding={8}>
          {items.map((it, i) => (
            <div key={i}>
              {it.sep && <D.Separator className="menu-sep" />}
              <D.Item className={'menu-item' + (it.danger ? ' danger' : '')} disabled={it.disabled} onSelect={it.onSelect}>
                {it.icon && <it.icon size={15} aria-hidden />}
                {it.label}
              </D.Item>
            </div>
          ))}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
