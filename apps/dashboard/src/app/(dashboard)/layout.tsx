"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth/auth-context";
import { useInstallStatus } from "@/lib/hooks/use-install-status";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { ToastContainer } from "@/components/ui/toast-container";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { data: installStatus, isLoading: installLoading } = useInstallStatus();
  const pathname = usePathname();
  const router = useRouter();

  // Redirect to /install if not yet installed; redirect away from /install if already installed
  useEffect(() => {
    if (loading || installLoading || !installStatus) return;
    if (!installStatus.installed && pathname !== "/install") {
      router.replace("/install");
    } else if (installStatus.installed && pathname === "/install") {
      router.replace("/");
    }
  }, [loading, installLoading, installStatus, pathname, router]);

  if (loading || installLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-mc-bg">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center gap-3"
        >
          <Image src="/icon.png" alt="CeyMail" width={48} height={48} className="h-12 w-12" />
          <div className="flex items-center gap-2 text-mc-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading Mission Control...</span>
          </div>
        </motion.div>
      </div>
    );
  }

  // Auth check completed but no user — server error or network issue
  // (401 redirects to /login in auth-context; this handles other failures)
  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-mc-bg">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center gap-3 text-center"
        >
          <Image src="/icon.png" alt="CeyMail" width={48} height={48} className="h-12 w-12 opacity-50" />
          <p className="text-sm font-medium text-mc-text">Unable to verify session</p>
          <p className="text-xs text-mc-text-muted">The server may be temporarily unavailable.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-mc-accent px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-mc-accent/90"
          >
            Retry
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-mc-bg">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <ErrorBoundary>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              {children}
            </motion.div>
          </ErrorBoundary>
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShell>{children}</DashboardShell>
    </AuthProvider>
  );
}
