"use client";

import { motion } from "framer-motion";
import { ServiceGrid } from "@/components/dashboard/service-grid";
import { SystemCharts } from "@/components/dashboard/system-charts";
import { QueueVisualizer } from "@/components/dashboard/queue-visualizer";
import { LogTape } from "@/components/dashboard/log-tape";

const stagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0, 0, 0.2, 1] as const } },
};

export default function DashboardPage() {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-mc-text">Mission Control</h1>
          <p className="text-sm text-mc-text-muted">
            CeyMail Server Overview
          </p>
        </div>
      </motion.div>

      {/* Service Status Grid */}
      <motion.div variants={fadeUp}>
        <ServiceGrid />
      </motion.div>

      {/* System Metrics + Queue */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SystemCharts />
        </div>
        <div>
          <QueueVisualizer />
        </div>
      </motion.div>

      {/* Live Log Stream */}
      <motion.div variants={fadeUp}>
        <LogTape />
      </motion.div>
    </motion.div>
  );
}
