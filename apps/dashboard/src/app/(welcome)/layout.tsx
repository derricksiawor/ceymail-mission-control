import { redirect } from "next/navigation";
import { getConfig } from "@/lib/config/config";

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  // Server-side guard: if setup is already completed, redirect to dashboard
  const config = getConfig();
  if (config?.setupCompletedAt) {
    redirect("/");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-mc-bg p-4">
      {/* Gradient orbs matching auth layout */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-80 w-80 rounded-full bg-mc-accent/5 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-80 w-80 rounded-full bg-mc-info/5 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mc-accent/3 blur-3xl" />
      </div>
      <div className="relative z-10 w-full">
        {children}
      </div>
    </div>
  );
}
