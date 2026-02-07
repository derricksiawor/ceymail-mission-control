"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, ArrowRight, Loader2 } from "lucide-react";

interface Props {
  sessionToken: string;
}

export function SetupComplete({ sessionToken }: Props) {
  const attemptedRef = useRef(false);

  const activateUrl = sessionToken
    ? `/api/welcome/activate?token=${encodeURIComponent(sessionToken)}`
    : "/";

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    // Navigate to the activate endpoint after a brief delay so the
    // success animation is visible. The activate endpoint sets the
    // session cookie via Set-Cookie and redirects to the dashboard.
    //
    // We use window.location.href (full navigation) rather than fetch()
    // so the browser reliably stores the cookie from the 307 response.
    // The delay is kept short to fire before any HMR env reload
    // (triggered by .env.local creation) can destroy React state.
    // Navigate immediately. The success animation renders for the brief
    // moment it takes the browser to start the navigation.
    window.location.href = activateUrl;

    return () => {};
  }, [activateUrl]);

  return (
    <div className="glass rounded-2xl p-6 shadow-xl shadow-black/10 text-center sm:p-8">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
        className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-mc-success/10"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.3 }}
        >
          <CheckCircle2 className="h-10 w-10 text-mc-success" />
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-mc-text">
          CeyMail Mission Control is Ready!
        </h1>
        <p className="mt-2 text-sm text-mc-text-muted">
          Your dashboard has been configured. You&apos;re now logged in as
          administrator.
        </p>

        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-mc-text-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          Redirecting to dashboard...
        </p>

        <a
          href={activateUrl}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-mc-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover shadow-lg shadow-mc-accent/20"
        >
          Go to Dashboard
          <ArrowRight className="h-4 w-4" />
        </a>
      </motion.div>
    </div>
  );
}
