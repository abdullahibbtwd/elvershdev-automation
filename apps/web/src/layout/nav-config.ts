import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bot,
  CalendarDays,
  Clapperboard,
  Film,
  FolderKanban,
  History,
  LayoutDashboard,
  Library,
  Server,
  Settings,
  Share2,
  Workflow,
} from 'lucide-react';

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    id: 'core',
    label: 'Core',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/projects', label: 'Video Projects', icon: FolderKanban },
      { to: '/stories', label: 'Stories', icon: Film },
      { to: '/media', label: 'Media Library', icon: Library },
      { to: '/jobs', label: 'Generation Jobs', icon: Workflow },
    ],
  },
  {
    id: 'distribution',
    label: 'Distribution',
    items: [
      { to: '/channels', label: 'Social Channels', icon: Share2 },
      { to: '/publishing', label: 'Publishing History', icon: History },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    items: [
      { to: '/automation', label: 'Dashboard', icon: Bot, end: true },
      { to: '/automation/calendar', label: 'Calendar', icon: CalendarDays },
      { to: '/automation/settings', label: 'Rules & Budgets', icon: Settings },
      { to: '/automation/executions', label: 'Executions', icon: History },
    ],
  },
  {
    id: 'series',
    label: 'Series Studio',
    items: [
      { to: '/series', label: 'Overview', icon: Clapperboard, end: true },
      { to: '/series/library', label: 'Library', icon: Library },
      { to: '/series/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/system', label: 'System Ops', icon: Server, adminOnly: true },
    ],
  },
];

export const routeTitles: Record<string, string> = {
  '/': 'Overview',
  '/projects': 'Video Projects',
  '/stories': 'Stories',
  '/stories/new': 'Create Story',
  '/media': 'Media Library',
  '/jobs': 'Generation Jobs',
  '/channels': 'Social Channels',
  '/publishing': 'Publishing History',
  '/automation': 'Automation',
  '/automation/calendar': 'Automation Calendar',
  '/automation/settings': 'Automation Settings',
  '/automation/executions': 'Automation Executions',
  '/series': 'Series Studio',
  '/series/library': 'Series Library',
  '/series/settings': 'Series Settings',
  '/analytics': 'Analytics',
  '/analytics/costs': 'Cost Analytics',
  '/analytics/insights': 'Insights',
  '/settings': 'Settings',
  '/system': 'System Ops',
};

export function resolvePageTitle(pathname: string): string {
  if (routeTitles[pathname]) return routeTitles[pathname];
  if (pathname.startsWith('/projects/')) return 'Project Detail';
  if (pathname.startsWith('/stories/')) return 'Story Detail';
  if (/^\/series\/[^/]+\/episodes\//.test(pathname)) return 'Series Episode';
  if (/^\/series\/[^/]+\/characters/.test(pathname)) return 'Character Studio';
  if (/^\/series\/[^/]+$/.test(pathname) && pathname !== '/series/library' && pathname !== '/series/settings') {
    return 'Series Detail';
  }
  if (pathname.startsWith('/analytics/videos/')) return 'Video Analytics';
  const match = Object.keys(routeTitles)
    .filter((key) => key !== '/' && pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return match ? routeTitles[match] : 'Dashboard';
}
