import { Bell, Menu, Plus, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type NavbarProps = {
  title: string;
  onOpenMobileNav: () => void;
  className?: string;
};

export function Navbar({ title, onOpenMobileNav, className }: NavbarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6 lg:px-8',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{title}</div>
          <div className="hidden text-[11px] text-muted-foreground sm:block">Workspace</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="hidden h-9 items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 text-xs text-muted-foreground transition-all duration-200 hover:border-primary/40 hover:text-foreground md:inline-flex"
          onClick={() => {
            /* Placeholder for future command palette */
          }}
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search</span>
          <kbd className="ml-2 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </button>

        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(0,194,214,0.5)]" />
        </Button>

        <Button asChild size="sm" className="shadow-[0_0_16px_rgba(0,194,214,0.25)]">
          <Link to="/stories/new">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Create Story</span>
          </Link>
        </Button>
      </div>
    </header>
  );
}
