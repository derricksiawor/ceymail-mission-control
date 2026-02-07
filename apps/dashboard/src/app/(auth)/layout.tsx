export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-mc-bg p-4">
      {/* Subtle gradient orbs for visual depth */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-80 w-80 rounded-full bg-mc-accent/5 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-80 w-80 rounded-full bg-mc-info/5 blur-3xl" />
      </div>
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}
