"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Database, Shield, CheckCircle2, Rocket } from "lucide-react";
import { WelcomeIntro } from "./steps/welcome-intro";
import { DatabaseSetup } from "./steps/database-setup";
import { AdminAccount } from "./steps/admin-account";
import { SetupComplete } from "./steps/setup-complete";

const STEPS = [
  { label: "Welcome", icon: Rocket },
  { label: "Database", icon: Database },
  { label: "Admin Account", icon: Shield },
  { label: "Complete", icon: CheckCircle2 },
] as const;

export function WelcomeWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const [sessionToken, setSessionToken] = useState("");

  const next = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 lg:flex-row lg:gap-8">
      {/* Step Tracker – vertical on desktop, horizontal on mobile */}
      <nav className="shrink-0 lg:w-56">
        {/* Desktop: vertical */}
        <div className="hidden lg:block">
          <div className="mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mc-accent font-bold text-white text-lg shadow-lg shadow-mc-accent/20">
                C
              </div>
              <div>
                <h2 className="text-sm font-semibold text-mc-text">CeyMail</h2>
                <p className="text-xs text-mc-text-muted">Setup Wizard</p>
              </div>
            </div>
          </div>
          <ol className="space-y-1">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              const isActive = i === currentStep;
              const isDone = i < currentStep;

              return (
                <li key={step.label}>
                  <div
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? "bg-mc-accent/10 text-mc-accent font-medium"
                        : isDone
                        ? "text-mc-success"
                        : "text-mc-text-muted"
                    }`}
                  >
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        isActive
                          ? "bg-mc-accent text-white"
                          : isDone
                          ? "bg-mc-success/10 text-mc-success"
                          : "bg-mc-surface text-mc-text-muted"
                      }`}
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </div>
                    {step.label}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Mobile: horizontal progress bar */}
        <div className="lg:hidden">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-mc-accent font-bold text-white text-sm shadow-lg shadow-mc-accent/20">
              C
            </div>
            <div>
              <h2 className="text-sm font-semibold text-mc-text">CeyMail Setup</h2>
              <p className="text-xs text-mc-text-muted">
                Step {currentStep + 1} of {STEPS.length}: {STEPS[currentStep].label}
              </p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {STEPS.map((step, i) => (
              <div
                key={step.label}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= currentStep ? "bg-mc-accent" : "bg-mc-border"
                }`}
              />
            ))}
          </div>
        </div>
      </nav>

      {/* Step Content */}
      <div className="flex-1 min-w-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {currentStep === 0 && <WelcomeIntro onNext={next} />}
            {currentStep === 1 && <DatabaseSetup onNext={next} />}
            {currentStep === 2 && (
              <AdminAccount
                onNext={(token) => {
                  setSessionToken(token);
                  next();
                }}
              />
            )}
            {currentStep === 3 && <SetupComplete sessionToken={sessionToken} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
