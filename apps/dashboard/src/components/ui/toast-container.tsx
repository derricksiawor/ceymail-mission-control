"use client";

import { useNotificationStore, type NotificationType } from "@/lib/stores/notification-store";
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

const icons: Record<NotificationType, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

const styles: Record<NotificationType, string> = {
  info: "border-mc-info/30 bg-mc-info/10 text-mc-info",
  success: "border-mc-success/30 bg-mc-success/10 text-mc-success",
  warning: "border-mc-warning/30 bg-mc-warning/10 text-mc-warning",
  error: "border-mc-danger/30 bg-mc-danger/10 text-mc-danger",
};

export function ToastContainer() {
  const { notifications, remove } = useNotificationStore();

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      <AnimatePresence>
        {notifications.map((n) => {
          const Icon = icons[n.type];
          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "pointer-events-auto flex w-80 items-start gap-3 rounded-lg border p-3 shadow-lg backdrop-blur-sm",
                styles[n.type]
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{n.title}</p>
                {n.message && (
                  <p className="mt-0.5 text-xs opacity-80">{n.message}</p>
                )}
              </div>
              <button
                onClick={() => remove(n.id)}
                className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
