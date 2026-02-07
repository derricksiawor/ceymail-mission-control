"use client";

import { cn } from "@/lib/utils";
import { Globe, Mail, Server, AlertCircle } from "lucide-react";
import { useState, useCallback, useEffect } from "react";

interface DomainConfigData {
  hostname: string;
  mailDomain: string;
  adminEmail: string;
}

interface FieldError {
  hostname?: string;
  mailDomain?: string;
  adminEmail?: string;
}

interface DomainConfigProps {
  value: DomainConfigData;
  onChange: (data: DomainConfigData) => void;
  onValidChange: (valid: boolean) => void;
}

function validateHostname(value: string): string | undefined {
  if (!value.trim()) return "Hostname is required";
  const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
  if (!hostnameRegex.test(value)) return "Invalid hostname format";
  if (!value.includes(".")) return "Hostname must include a domain (e.g., mail.example.com)";
  return undefined;
}

function validateDomain(value: string): string | undefined {
  if (!value.trim()) return "Mail domain is required";
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;
  if (!domainRegex.test(value)) return "Invalid domain format";
  return undefined;
}

function validateEmail(value: string): string | undefined {
  if (!value.trim()) return "Admin email is required";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) return "Invalid email format";
  return undefined;
}

export function DomainConfig({ value, onChange, onValidChange }: DomainConfigProps) {
  const [errors, setErrors] = useState<FieldError>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validate = useCallback(
    (data: DomainConfigData): boolean => {
      const newErrors: FieldError = {
        hostname: validateHostname(data.hostname),
        mailDomain: validateDomain(data.mailDomain),
        adminEmail: validateEmail(data.adminEmail),
      };
      setErrors(newErrors);
      const isValid = !newErrors.hostname && !newErrors.mailDomain && !newErrors.adminEmail;
      return isValid;
    },
    []
  );

  useEffect(() => {
    const isValid = validate(value);
    onValidChange(isValid);
  }, [value, validate, onValidChange]);

  const handleChange = (field: keyof DomainConfigData, fieldValue: string) => {
    const updated = { ...value, [field]: fieldValue };
    onChange(updated);
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const fields: {
    key: keyof DomainConfigData;
    label: string;
    placeholder: string;
    icon: React.ComponentType<{ className?: string }>;
    hint: string;
  }[] = [
    {
      key: "hostname",
      label: "Server Hostname",
      placeholder: "mail.example.com",
      icon: Server,
      hint: "The fully qualified domain name of your mail server",
    },
    {
      key: "mailDomain",
      label: "Mail Domain",
      placeholder: "example.com",
      icon: Globe,
      hint: "The domain for email addresses (user@example.com)",
    },
    {
      key: "adminEmail",
      label: "Admin Email",
      placeholder: "admin@example.com",
      icon: Mail,
      hint: "The administrator email for system notifications and SSL certificates",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-mc-text">
          Domain Configuration
        </h3>
        <p className="mt-1 text-sm text-mc-text-muted">
          Configure the hostname and domain for your mail server. These values
          will be used across Postfix, Dovecot, and SSL certificate generation.
        </p>
      </div>

      <div className="space-y-4">
        {fields.map((field) => {
          const Icon = field.icon;
          const error = errors[field.key];
          const showError = touched[field.key] && error;

          return (
            <div key={field.key}>
              <label
                htmlFor={field.key}
                className="mb-1.5 block text-sm font-medium text-mc-text"
              >
                {field.label}
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                  <Icon
                    className={cn(
                      "h-4 w-4",
                      showError ? "text-mc-danger" : "text-mc-text-muted"
                    )}
                  />
                </div>
                <input
                  id={field.key}
                  type={field.key === "adminEmail" ? "email" : "text"}
                  value={value[field.key]}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  onBlur={() => handleBlur(field.key)}
                  placeholder={field.placeholder}
                  className={cn(
                    "w-full rounded-lg border bg-mc-bg py-2.5 pl-10 pr-4 text-sm text-mc-text placeholder-mc-text-muted/50 outline-none transition-colors",
                    "focus:border-mc-accent focus:ring-1 focus:ring-mc-accent/30",
                    showError
                      ? "border-mc-danger"
                      : "border-mc-border"
                  )}
                />
              </div>
              {showError ? (
                <div className="mt-1.5 flex items-center gap-1 text-xs text-mc-danger">
                  <AlertCircle className="h-3 w-3" />
                  {error}
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-mc-text-muted">
                  {field.hint}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Preview */}
      {value.hostname && value.mailDomain && (
        <div className="rounded-lg border border-mc-border bg-mc-surface p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-mc-text-muted">
            Configuration Preview
          </p>
          <div className="space-y-1 font-mono text-xs">
            <p>
              <span className="text-mc-text-muted">myhostname = </span>
              <span className="text-mc-accent">{value.hostname}</span>
            </p>
            <p>
              <span className="text-mc-text-muted">mydomain = </span>
              <span className="text-mc-accent">{value.mailDomain}</span>
            </p>
            <p>
              <span className="text-mc-text-muted">myorigin = </span>
              <span className="text-mc-accent">$mydomain</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
