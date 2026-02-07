"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  LayoutDashboard,
  Server,
  Globe,
  Users,
  Mail,
  Key,
  ScrollText,
  Archive,
  Settings,
  Rocket,
  ChevronLeft,
  ChevronRight,
  ListOrdered,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/stores/app-store";
import { useServices } from "@/lib/hooks/use-services";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Install", href: "/install", icon: Rocket },
  { label: "Services", href: "/services", icon: Server },
  { label: "Domains", href: "/domains", icon: Globe },
  { label: "Users", href: "/users", icon: Users },
  { label: "Aliases", href: "/aliases", icon: Mail },
  { label: "DKIM", href: "/dkim", icon: Key },
  { label: "Queue", href: "/queue", icon: ListOrdered },
  { label: "Logs", href: "/logs", icon: ScrollText },
  { label: "Backups", href: "/backup", icon: Archive },
  { label: "Settings", href: "/settings", icon: Settings },
];

const statusDotColors: Record<string, string> = {
  green: "bg-mc-success",
  yellow: "bg-mc-warning",
  red: "bg-mc-danger",
};

function useServiceHealth(): "green" | "yellow" | "red" | null {
  const { data: services } = useServices();
  if (!services || services.length === 0) return null;
  const running = services.filter(
    (s) => s.status === "running" || s.status === "active"
  ).length;
  if (running === services.length) return "green";
  if (running > 0) return "yellow";
  return "red";
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useAppStore();
  const isMobile = !!onNavigate;
  const serviceHealth = useServiceHealth();

  return (
    <>
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-mc-border px-4">
        <div className="flex flex-1 items-center gap-2 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mc-accent font-bold text-white">
            C
          </div>
          {(isMobile || !sidebarCollapsed) && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-mc-text">
                CeyMail
              </span>
              <span className="text-[10px] uppercase tracking-wider text-mc-text-muted">
                Mission Control
              </span>
            </div>
          )}
        </div>
        {isMobile && (
          <button
            onClick={onNavigate}
            className="rounded-lg p-1.5 text-mc-text-muted hover:bg-mc-surface-hover hover:text-mc-text"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-mc-accent/10 text-mc-accent"
                      : "text-mc-text-muted hover:bg-mc-surface-hover hover:text-mc-text"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {(isMobile || !sidebarCollapsed) && (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {item.href === "/services" && serviceHealth && (
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full",
                            statusDotColors[serviceHealth]
                          )}
                        />
                      )}
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Collapse Button - desktop only */}
      {!isMobile && (
        <div className="border-t border-mc-border p-2">
          <button
            onClick={toggleSidebar}
            className="flex w-full items-center justify-center rounded-lg px-3 py-2 text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <>
                <ChevronLeft className="h-5 w-5" />
                <span className="ml-2 text-sm">Collapse</span>
              </>
            )}
          </button>
        </div>
      )}
    </>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useAppStore();
  const pathname = usePathname();

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname, setMobileSidebarOpen]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "glass-subtle hidden flex-col transition-all duration-300 md:flex",
          sidebarCollapsed ? "w-16" : "w-60"
        )}
      >
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col glass-subtle shadow-2xl transition-transform duration-300 md:hidden",
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent onNavigate={() => setMobileSidebarOpen(false)} />
      </aside>
    </>
  );
}
