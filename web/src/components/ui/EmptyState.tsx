import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { motion } from 'motion/react';

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div className="empty" initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}>
      <div className="empty-icon"><Icon size={28} /></div>
      <h4>{title}</h4>
      {body && <p style={{ maxWidth: 360 }}>{body}</p>}
      {action}
    </motion.div>
  );
}
