"use client";

import Image from "next/image";
import { Database, Shield, Rocket } from "lucide-react";

interface Props {
  onNext: () => void;
  dbConfigured?: boolean;
}

export function WelcomeIntro({ onNext, dbConfigured = true }: Props) {
  return (
    <div className="glass rounded-2xl p-6 shadow-xl shadow-black/10 sm:p-8">
      <div className="text-center">
        <Image src="/icon.png" alt="CeyMail" width={64} height={64} className="mx-auto mb-6 h-16 w-16" />
        <h1 className="text-2xl font-bold text-mc-text">
          Welcome to CeyMail Mission Control
        </h1>
        <p className="mt-2 text-sm text-mc-text-muted">
          {dbConfigured
            ? "Your databases have been configured automatically. Just one quick step and you'll be ready to manage your mail server."
            : "Let's get your mail server dashboard up and running. This wizard will guide you through the initial setup in just a few steps."}
        </p>
      </div>

      <div className="mt-8 space-y-4">
        {!dbConfigured && (
          <div className="flex items-start gap-4 rounded-xl border border-mc-border bg-mc-surface/50 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-mc-accent/10">
              <Database className="h-5 w-5 text-mc-accent" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-mc-text">
                Configure Database
              </h3>
              <p className="mt-0.5 text-xs text-mc-text-muted">
                Connect to your MariaDB/MySQL server and create the required
                databases and tables.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-4 rounded-xl border border-mc-border bg-mc-surface/50 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-mc-success/10">
            <Shield className="h-5 w-5 text-mc-success" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-mc-text">
              Create Admin Account
            </h3>
            <p className="mt-0.5 text-xs text-mc-text-muted">
              {dbConfigured
                ? "Set up your administrator account, then you'll be automatically logged in and ready to configure your mail server."
                : "Set up your administrator account to manage the dashboard securely."}
            </p>
          </div>
        </div>

        {!dbConfigured && (
          <div className="flex items-start gap-4 rounded-xl border border-mc-border bg-mc-surface/50 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-mc-info/10">
              <Rocket className="h-5 w-5 text-mc-info" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-mc-text">
                Start Managing
              </h3>
              <p className="mt-0.5 text-xs text-mc-text-muted">
                You&apos;ll be automatically logged in and ready to configure your
                mail server.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 text-center">
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 rounded-lg bg-mc-accent px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover shadow-lg shadow-mc-accent/20"
        >
          <Rocket className="h-4 w-4" />
          Get Started
        </button>
      </div>
    </div>
  );
}
