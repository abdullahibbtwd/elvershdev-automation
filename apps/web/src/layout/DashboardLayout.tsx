import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';
import { Navbar } from './Navbar';
import { resolvePageTitle } from './nav-config';
import { Sidebar } from './Sidebar';

export function DashboardLayout() {
  const { logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const title = resolvePageTitle(location.pathname);

  const handleSignOut = () => {
    void logout().then(() => navigate('/login'));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          onCloseMobile={() => setMobileOpen(false)}
          onSignOut={handleSignOut}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Navbar title={title} onOpenMobileNav={() => setMobileOpen(true)} />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
