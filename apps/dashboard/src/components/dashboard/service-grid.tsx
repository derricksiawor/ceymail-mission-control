"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { ServiceCard, type ServiceInfo } from "./service-card";
import { useServices } from "@/lib/hooks/use-services";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0, 0, 0.2, 1] as const } },
};

export function ServiceGrid() {
  const { data: services, isLoading } = useServices();

  const mappedServices: ServiceInfo[] = useMemo(() =>
    (services ?? []).map((svc) => ({
      name: svc.name,
      displayName: capitalize(svc.name),
      status: svc.status === "failed" ? "error" : svc.status === "unknown" ? "starting" : svc.status === "active" || svc.status === "running" ? "running" : "stopped",
      uptime: svc.uptime_seconds,
      memoryUsage: svc.memory_bytes,
    })),
    [services]
  );

  if (isLoading) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold text-mc-text">
          Service Status
        </h2>
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-mc-accent" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-mc-text">
        Service Status
      </h2>
      <motion.div
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.06 } },
        }}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {mappedServices.map((service) => (
          <motion.div key={service.name} variants={cardVariants}>
            <ServiceCard service={service} />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
