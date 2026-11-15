import { NavLink } from 'react-router-dom';
import { Clapperboard, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { APP_NAME } from '@ai-video/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { navGroups } from './nav-config';

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
  onSignOut: () => void;
};

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onCloseMobile,
  onSignOut,
}: SidebarProps) {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  const content = (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          'flex items-center gap-3 border-b border-border px-4 py-5',
          collapsed && 'justify-center px-2',
        )}
      >
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <Clapperboard className="h-4 w-4 text-primary" />
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_rgba(0,194,214,0.4)]" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-foreground">
              {APP_NAME}
            </div>
            <div className="text-[11px] text-muted-foreground">Production studio</div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {navGroups.map((group) => {
          const items = group.items.filter((item) => !item.adminOnly || isAdmin);
          if (items.length === 0) return null;
          return (
            <div key={group.id} className="space-y-1">
              {!collapsed && (
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {group.label}
                </div>
              )}
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={collapsed ? item.label : undefined}
                  onClick={onCloseMobile}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-3 rounded-md border-l-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
                      collapsed && 'justify-center px-2',
                      isActive &&
                        'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary',
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className={cn('border-t border-border p-3', collapsed && 'px-2')}>
        <div
          className={cn(
            'mb-3 rounded-lg border border-border bg-secondary/40 p-3',
            collapsed && 'flex justify-center p-2',
          )}
        >
          {collapsed ? (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
              title={user?.name}
            >
              {(user?.name ?? 'U').slice(0, 1).toUpperCase()}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{user?.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
                </div>
                <Badge tone="success">S2S Live</Badge>
              </div>
            </div>
          )}
        </div>

        <div className={cn('flex gap-2', collapsed ? 'flex-col' : 'items-center')}>
          <Button
            variant="ghost"
            size={collapsed ? 'icon' : 'sm'}
            className={cn(!collapsed && 'flex-1 justify-start')}
            onClick={onSignOut}
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && 'Sign out'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={cn(
          'sticky top-0 z-20 hidden h-screen shrink-0 border-r border-border bg-card/90 backdrop-blur-md transition-all duration-200 md:block',
          collapsed ? 'w-[72px]' : 'w-64',
        )}
      >
        {content}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={onCloseMobile}
          />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-border bg-card shadow-xl">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
