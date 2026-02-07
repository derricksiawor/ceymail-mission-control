"use client";

import { cn } from "@/lib/utils";
import { useEffect } from "react";

interface PhpVersion {
  version: string;
  label: string;
  eol: string;
  recommended: boolean;
}

const phpVersions: PhpVersion[] = [
  {
    version: "7.4",
    label: "PHP 7.4",
    eol: "EOL: Nov 2022",
    recommended: false,
  },
  {
    version: "8.0",
    label: "PHP 8.0",
    eol: "EOL: Nov 2023",
    recommended: false,
  },
  {
    version: "8.2",
    label: "PHP 8.2",
    eol: "Active Support",
    recommended: true,
  },
];

interface PhpSelectProps {
  value: string;
  onChange: (version: string) => void;
  onValidChange: (valid: boolean) => void;
}

export function PhpSelect({ value, onChange, onValidChange }: PhpSelectProps) {
  // Sync validity whenever value changes (including initial mount)
  useEffect(() => {
    onValidChange(!!value);
  }, [value, onValidChange]);

  const handleSelect = (version: string) => {
    onChange(version);
    onValidChange(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-mc-text">
          PHP Version Selection
        </h3>
        <p className="mt-1 text-sm text-mc-text-muted">
          Choose the PHP version to install. PHP 8.2 is recommended for best
          performance and security.
        </p>
      </div>

      <div className="space-y-3">
        {phpVersions.map((php) => {
          const isSelected = value === php.version;

          return (
            <button
              key={php.version}
              type="button"
              onClick={() => handleSelect(php.version)}
              className={cn(
                "flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-all duration-200",
                isSelected
                  ? "border-mc-accent bg-mc-accent/5 ring-1 ring-mc-accent/30"
                  : "border-mc-border bg-mc-surface hover:border-mc-accent/30 hover:bg-mc-surface-hover"
              )}
            >
              {/* Radio circle */}
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  isSelected
                    ? "border-mc-accent"
                    : "border-mc-text-muted"
                )}
              >
                {isSelected && (
                  <div className="h-2.5 w-2.5 rounded-full bg-mc-accent" />
                )}
              </div>

              {/* Version info */}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-mc-text">
                    {php.label}
                  </span>
                  {php.recommended && (
                    <span className="rounded-full bg-mc-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-mc-success">
                      Recommended
                    </span>
                  )}
                </div>
                <p
                  className={cn(
                    "mt-0.5 text-xs",
                    php.recommended
                      ? "text-mc-success"
                      : "text-mc-text-muted"
                  )}
                >
                  {php.eol}
                </p>
              </div>

              {/* Extensions note */}
              <div className="text-right">
                <p className="text-xs text-mc-text-muted">
                  Includes extensions:
                </p>
                <p className="text-[10px] text-mc-text-muted">
                  cli, mysql, gd, intl, xml, mbstring, curl
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {value && (
        <div className="rounded-lg border border-mc-border bg-mc-surface p-4">
          <p className="text-xs text-mc-text-muted">
            <span className="font-medium text-mc-text">Selected:</span> PHP{" "}
            {value} will be installed along with{" "}
            <span className="text-mc-accent">libapache2-mod-php{value}</span>{" "}
            and all required extensions.
          </p>
        </div>
      )}
    </div>
  );
}
