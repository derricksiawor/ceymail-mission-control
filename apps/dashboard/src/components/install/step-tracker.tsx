"use client";

import { cn } from "@/lib/utils";
import { Check, X, Loader2 } from "lucide-react";

export type StepStatusType = "pending" | "in-progress" | "completed" | "failed";

export interface StepInfo {
  label: string;
  status: StepStatusType;
  description: string;
}

interface StepTrackerProps {
  steps: StepInfo[];
  currentStep: number;
  onStepClick?: (index: number) => void;
}

export function StepTracker({ steps, currentStep, onStepClick }: StepTrackerProps) {
  return (
    <nav className="relative flex flex-col gap-0" aria-label="Installation progress">
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isLast = index === steps.length - 1;

        return (
          <div key={index} className="relative flex gap-3">
            {/* Vertical connector line */}
            {!isLast && (
              <div className="absolute left-[15px] top-[32px] h-[calc(100%-16px)] w-0.5">
                <div
                  className={cn(
                    "h-full w-full transition-colors duration-300",
                    step.status === "completed"
                      ? "bg-mc-success/50"
                      : "bg-mc-border"
                  )}
                />
              </div>
            )}

            {/* Step indicator circle */}
            <button
              type="button"
              onClick={() => onStepClick?.(index)}
              disabled={step.status === "pending" && index > currentStep}
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300",
                step.status === "completed" &&
                  "border-mc-success bg-mc-success text-white",
                step.status === "in-progress" &&
                  "border-mc-accent bg-mc-accent/10 text-mc-accent",
                step.status === "failed" &&
                  "border-mc-danger bg-mc-danger/10 text-mc-danger",
                step.status === "pending" &&
                  "border-mc-border bg-mc-surface text-mc-text-muted",
                isActive && step.status !== "failed" && step.status !== "completed" &&
                  "ring-2 ring-mc-accent/30 ring-offset-2 ring-offset-mc-bg"
              )}
              aria-current={isActive ? "step" : undefined}
            >
              {step.status === "completed" && <Check className="h-4 w-4" />}
              {step.status === "in-progress" && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {step.status === "failed" && <X className="h-4 w-4" />}
              {step.status === "pending" && (
                <span className="text-xs font-medium">{index + 1}</span>
              )}
            </button>

            {/* Step label and description */}
            <div className="min-h-[48px] pb-4 pt-1">
              <p
                className={cn(
                  "text-sm font-medium leading-tight transition-colors duration-300",
                  isActive ? "text-mc-text" : "text-mc-text-muted",
                  step.status === "completed" && "text-mc-success",
                  step.status === "failed" && "text-mc-danger"
                )}
              >
                {step.label}
              </p>
              <p className="mt-0.5 text-xs text-mc-text-muted">
                {step.description}
              </p>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
