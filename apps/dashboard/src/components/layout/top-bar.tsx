"use client";

import { usePathname } from "next/navigation";
import { ChevronRight, LogOut, Sun, Moon, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { useAppStore } from "@/lib/stores/app-store";
import { useServices } from "@/lib/hooks/use-services";

const routeLabels: Record<string, string> = {
  "/": "Dashboard",
  "/install": "Install Wizard",
  "/services": "Services",
  "/domains": "Domains",
  "/users": "Users",
  "/aliases": "Aliases",
  "/dkim": "DKIM Keys",
  "/queue": "Queue",
  "/logs": "Logs",
  "/backup": "Backups",
  "/webmail": "Webmail",
  "/settings": "Settings",
};

function useSystemHealth() {
  const { data: services } = useServices();
  if (!services || services.length === 0) return { label: "Loading", color: "text-mc-text-muted", dot: "bg-mc-text-muted" };
  const running = services.filter((s) => s.status === "running" || s.status === "active").length;
  if (running === services.length) return { label: "Healthy", color: "text-mc-success", dot: "bg-mc-success" };
  if (running > 0) return { label: "Degraded", color: "text-mc-warning", dot: "bg-mc-warning" };
  return { label: "Down", color: "text-mc-danger", dot: "bg-mc-danger" };
}

export function TopBar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { theme, toggleTheme, setMobileSidebarOpen } = useAppStore();
  const currentRoute = routeLabels[pathname] || "Dashboard";
  const health = useSystemHealth();
  return (
    <header className="glass-subtle flex h-14 shrink-0 items-center justify-between px-4 md:px-6">
      {/* Left: Hamburger + Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="rounded-lg p-2 text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="hidden text-mc-text-muted sm:inline">CeyMail</span>
        <ChevronRight className="hidden h-4 w-4 text-mc-text-muted sm:block" />
        <span className="font-medium text-mc-text">{currentRoute}</span>
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* System Health */}
        <div className={cn("hidden items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium sm:flex", health.color)} title={`System: ${health.label}`}>
          <span className={cn("h-1.5 w-1.5 rounded-full", health.dot, health.label !== "Loading" && "animate-pulse")} />
          <span>{health.label}</span>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="rounded-lg p-2 text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        {/* User / Logout */}
        {user && (
          <div className="flex items-center gap-2 border-l border-mc-border pl-3 sm:gap-3 sm:pl-4">
            <div className="hidden items-center gap-2 sm:flex">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-mc-accent/20 text-xs font-semibold text-mc-accent">
                {user.username[0].toUpperCase()}
              </div>
              <span className="text-xs font-medium text-mc-text">{user.username}</span>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="rounded-lg p-2 text-mc-text-muted transition-colors hover:bg-mc-danger/10 hover:text-mc-danger"
            >
              <LogOut className="h-5 w-5 sm:h-4 sm:w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
