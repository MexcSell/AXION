import { type LucideIcon } from 'lucide-react';

/**
 * Plug-in apps: the bottom section of the rail (owner update 2026-11-20 u1).
 * A plug-in is a self-contained app page. New plug-ins can be created through a mission
 * ("Build a plug-in that …"); when such a mission is verified the plug-in is registered here.
 * Settings › Navigation shows or hides each one in the rail.
 */
export interface PluginDef {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  description: string;
  /** built-in, or created by the named mission */
  origin: { kind: 'built-in' } | { kind: 'mission'; missionId: string };
  version: string;
  /** tab labels, so search can deep-link them (?tab=) */
  tabs: string[];
}

export const PLUGINS: PluginDef[] = [];
