"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  Package,
  ShieldCheck,
  FileCode,
  Key,
  Power,
  XCircle,
} from "lucide-react";
import { StepTracker, type StepInfo, type StepStatusType } from "./step-tracker";
import { SystemCheck } from "./steps/system-check";
import { PhpSelect } from "./steps/php-select";
import { DomainConfig } from "./steps/domain-config";
import { Summary } from "./steps/summary";
import { useCompleteInstall } from "@/lib/hooks/use-install-status";

// ---------- Types ----------

interface FormData {
  phpVersion: string;
  hostname: string;
  mailDomain: string;
  adminEmail: string;
  enabledServices: Record<string, boolean>;
}

interface PackageProgress {
  name: string;
  progress: number;
  status: "pending" | "installing" | "installed" | "failed";
  error?: string;
}

// ---------- Step definitions ----------

const STEP_DEFINITIONS: { label: string; description: string }[] = [
  { label: "System Check", description: "Verify server requirements" },
  { label: "PHP Version", description: "Select PHP version to install" },
  { label: "Core Packages", description: "Install required system packages" },
  { label: "Domain Configuration", description: "Set hostname and mail domain" },
  { label: "SSL Certificates", description: "Generate Let's Encrypt certificates" },
  { label: "Service Configuration", description: "Generate config files" },
  { label: "DKIM Setup", description: "Generate DKIM signing keys" },
  { label: "Permissions", description: "Set file ownership and modes" },
  { label: "Enable Services", description: "Start and enable systemd services" },
  { label: "Summary", description: "Review DNS records and finish" },
];

type WebServer = "nginx" | "apache" | "none";

function getCorePackages(webServer: WebServer): string[] {
  const base = [
    "certbot",
    "mariadb-server",
    "postfix",
    "postfix-mysql",
    "dovecot-core",
    "dovecot-imapd",
    "dovecot-lmtpd",
    "dovecot-mysql",
    "opendkim",
    "opendkim-tools",
    "spamassassin",
    "unbound",
    "rsyslog",
  ];

  if (webServer === "nginx") {
    return ["python3-certbot-nginx", ...base];
  }
  // apache or none (default to apache packages)
  return ["apache2", "python3-certbot-apache", ...base];
}

function getDefaultServices(webServer: WebServer): Record<string, boolean> {
  const base: Record<string, boolean> = {
    postfix: true,
    dovecot: true,
    opendkim: true,
    mariadb: true,
    spamassassin: true,
    unbound: true,
    rsyslog: true,
  };

  if (webServer === "nginx") {
    return { ...base, nginx: true };
  }
  return { ...base, apache2: true };
}

// =================================================================
// Main Wizard Component
// =================================================================

export function InstallWizard() {
  const router = useRouter();
  const completeInstall = useCompleteInstall();
  const [currentStep, setCurrentStep] = useState(0);
  const [stepStatuses, setStepStatuses] = useState<StepStatusType[]>(
    STEP_DEFINITIONS.map(() => "pending")
  );
  const [stepValid, setStepValid] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    phpVersion: "8.2",
    hostname: "",
    mailDomain: "",
    adminEmail: "",
    enabledServices: getDefaultServices("none"),
  });

  // Package install state
  const [packages, setPackages] = useState<PackageProgress[]>(
    getCorePackages("none").map((name) => ({
      name,
      progress: 0,
      status: "pending" as const,
    }))
  );
  const [packagesRunning, setPackagesRunning] = useState(false);

  // Auto-progress for API-driven steps
  const [autoProgress, setAutoProgress] = useState(0);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoMessage, setAutoMessage] = useState("");
  const [autoError, setAutoError] = useState("");

  // Generated configs for step 6
  const [generatedConfigs, setGeneratedConfigs] = useState<
    { name: string; content: string }[]
  >([]);

  // Permissions checklist for step 8
  const [permChecklist, setPermChecklist] = useState<
    { label: string; done: boolean; error?: string }[]
  >([]);

  // Detected web server (from system check)
  const [detectedWebServer, setDetectedWebServer] = useState<WebServer>("none");

  // Update package list and services when web server is detected
  useEffect(() => {
    if (detectedWebServer === "none") return;

    // Update packages only if install hasn't started yet
    setPackages((prev) => {
      if (prev.some((p) => p.status !== "pending")) return prev;
      return getCorePackages(detectedWebServer).map((name) => ({
        name,
        progress: 0,
        status: "pending" as const,
      }));
    });

    // Update enabled services to match detected web server
    setFormData((prev) => {
      const services = { ...prev.enabledServices };
      delete services.apache2;
      delete services.nginx;
      services[detectedWebServer === "nginx" ? "nginx" : "apache2"] = true;
      return { ...prev, enabledServices: services };
    });
  }, [detectedWebServer]);

  // ---------- Status helpers ----------

  const updateStatus = (index: number, status: StepStatusType) => {
    setStepStatuses((prev) => {
      const next = [...prev];
      next[index] = status;
      return next;
    });
  };

  const steps: StepInfo[] = STEP_DEFINITIONS.map((def, i) => ({
    label: def.label,
    description: def.description,
    status: stepStatuses[i],
  }));

  // ---------- Real package install via API ----------

  const runPackageInstall = useCallback(async () => {
    setPackagesRunning(true);
    const pkgNames = getCorePackages(detectedWebServer);
    const pkgs: PackageProgress[] = pkgNames.map((name) => ({
      name,
      progress: 0,
      status: "pending" as const,
    }));
    setPackages(pkgs);

    for (let i = 0; i < pkgs.length; i++) {
      pkgs[i] = { ...pkgs[i], status: "installing", progress: 10 };
      setPackages([...pkgs]);

      try {
        const res = await fetch("/api/install/packages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package: pkgs[i].name }),
        });

        const data = await res.json();

        if (res.ok && data.status === "installed") {
          pkgs[i] = { ...pkgs[i], status: "installed", progress: 100 };
        } else {
          pkgs[i] = {
            ...pkgs[i],
            status: "failed",
            progress: 100,
            error: data.output || data.error || "Installation failed",
          };
        }
      } catch (err: unknown) {
        pkgs[i] = {
          ...pkgs[i],
          status: "failed",
          progress: 100,
          error: err instanceof Error ? err.message : "Network error",
        };
      }

      setPackages([...pkgs]);
    }

    setPackagesRunning(false);
    const allInstalled = pkgs.every((p) => p.status === "installed");
    // Critical packages: mail services + web server (only if we're installing it)
    const criticalNames = ["postfix", "dovecot-core", "mariadb-server"];
    if (detectedWebServer !== "nginx") criticalNames.push("apache2");
    const criticalInstalled = pkgs
      .filter((p) => criticalNames.includes(p.name))
      .every((p) => p.status === "installed");
    setStepValid(allInstalled || criticalInstalled);
  }, [detectedWebServer]);

  // ---------- SSL setup via API ----------

  const runSslSetup = useCallback(async () => {
    setAutoRunning(true);
    setAutoProgress(10);
    setAutoMessage(`Requesting SSL certificate for ${formData.hostname} via Let's Encrypt...`);
    setAutoError("");

    try {
      const res = await fetch("/api/install/ssl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: formData.hostname,
          adminEmail: formData.adminEmail,
          webServer: detectedWebServer === "nginx" ? "nginx" : "apache",
        }),
      });

      setAutoProgress(80);

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`SSL API returned unexpected response (${res.status})`);
      }
      const data = await res.json();

      if (res.ok || data.success) {
        setAutoProgress(100);
        setAutoMessage(data.message || `SSL certificate issued for ${formData.hostname}.`);
        setAutoRunning(false);
        setStepValid(true);
      } else {
        throw new Error(data.message || data.error || "SSL setup failed");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setAutoProgress(100);
      setAutoError(message);
      setAutoMessage("SSL certificate request failed");
      setAutoRunning(false);
    }
  }, [formData.hostname, formData.adminEmail, detectedWebServer]);

  // ---------- Config generation via API ----------

  const runConfigGeneration = useCallback(async () => {
    setGeneratedConfigs([]);

    try {
      const res = await fetch("/api/install/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: formData.hostname,
          mailDomain: formData.mailDomain,
          adminEmail: formData.adminEmail,
          phpVersion: formData.phpVersion,
          writeFiles: false, // Preview only
        }),
      });

      const data = await res.json();

      if (res.ok && data.configs) {
        setGeneratedConfigs(data.configs);
        setStepValid(true);
      } else {
        // Show error - do not mark step valid
        setGeneratedConfigs([{
          name: "Error",
          content: data.error || "Failed to generate configurations",
        }]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error generating configurations";
      setGeneratedConfigs([{
        name: "Error",
        content: message,
      }]);
    }
  }, [formData.hostname, formData.mailDomain, formData.adminEmail, formData.phpVersion]);

  // ---------- Database setup (ensures domain exists in virtual_domains) ----------

  const runDatabaseSetup = useCallback(async () => {
    const res = await fetch("/api/install/database", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mailDomain: formData.mailDomain,
        hostname: formData.hostname,
        adminEmail: formData.adminEmail,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Database setup failed" }));
      throw new Error(errData.error || "Failed to set up database tables and domain");
    }

    return res.json();
  }, [formData.mailDomain, formData.hostname, formData.adminEmail]);

  // ---------- Write configs to disk ----------

  const writeConfigs = useCallback(async () => {
    const res = await fetch("/api/install/configure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostname: formData.hostname,
        mailDomain: formData.mailDomain,
        adminEmail: formData.adminEmail,
        phpVersion: formData.phpVersion,
        writeFiles: true,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Config write failed" }));
      throw new Error(errData.error || "Failed to write configuration files");
    }

    return res.json();
  }, [formData.hostname, formData.mailDomain, formData.adminEmail, formData.phpVersion]);

  // ---------- DKIM setup via existing API ----------

  const runDkimSetup = useCallback(async () => {
    // Note: autoRunning/autoProgress are managed by the step 6 chain caller.
    // Only update progress forward to avoid regression.
    setAutoMessage(`Generating DKIM key pair for ${formData.mailDomain} (selector: mail)...`);

    try {
      const res = await fetch("/api/dkim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: formData.mailDomain,
          selector: "mail",
          bits: 2048,
        }),
      });

      setAutoProgress(80);

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`DKIM API returned unexpected response (${res.status})`);
      }
      const data = await res.json();

      if (res.ok) {
        setAutoProgress(100);
        setAutoMessage(`DKIM keys generated. Selector: mail._domainkey.${formData.mailDomain}`);
        setAutoRunning(false);
        setStepValid(true);
      } else {
        throw new Error(data.error || "DKIM key generation failed");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setAutoProgress(100);
      setAutoError(message);
      setAutoMessage("DKIM key generation failed");
      setAutoRunning(false);
    }
  }, [formData.mailDomain]);

  // ---------- Permissions via API ----------

  const runPermissions = useCallback(async () => {
    setPermChecklist([]);

    try {
      const res = await fetch("/api/install/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();

      if (res.ok && data.results) {
        setPermChecklist(data.results);
        setStepValid(data.allDone || data.results.some((r: { done: boolean }) => r.done));
      } else {
        setPermChecklist([{ label: "Error: " + (data.error || "Failed"), done: false }]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setPermChecklist([{ label: "Error: " + message, done: false }]);
    }
  }, []);

  // ---------- Enable services via API ----------

  const runEnableServices = useCallback(async (): Promise<boolean> => {
    setAutoRunning(true);
    setAutoProgress(10);
    setAutoMessage("Enabling and starting selected services...");
    setAutoError("");

    try {
      const res = await fetch("/api/install/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services: formData.enabledServices }),
      });

      setAutoProgress(80);

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Services API returned unexpected response (${res.status})`);
      }
      const data = await res.json();

      if (res.ok) {
        setAutoProgress(100);
        setAutoMessage("Services enabled and started.");
        setAutoRunning(false);
        setStepValid(true);
        return true;
      } else {
        throw new Error(data.error || "Failed to enable services");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setAutoProgress(100);
      setAutoError(message);
      setAutoMessage("Service enable failed");
      setAutoRunning(false);
      return false;
    }
  }, [formData.enabledServices]);

  // ---------- Next step handler ----------

  const handleNext = () => {
    // Mark current step as completed
    updateStatus(currentStep, "completed");

    const nextStep = currentStep + 1;
    if (nextStep >= STEP_DEFINITIONS.length) return;

    setCurrentStep(nextStep);
    updateStatus(nextStep, "in-progress");
    setStepValid(false);

    // Reset shared auto-progress state to prevent cross-step contamination
    setAutoProgress(0);
    setAutoRunning(false);
    setAutoMessage("");
    setAutoError("");

    // Auto-run certain steps
    switch (nextStep) {
      case 2: // Core Packages
        runPackageInstall();
        break;
      case 4: // SSL Certificates
        runSslSetup();
        break;
      case 5: // Service Configuration - generate configs for preview
        runConfigGeneration();
        break;
      case 6: // DKIM Setup - ensure domain in DB, write configs, then generate DKIM
        setAutoRunning(true);
        setAutoProgress(5);
        setAutoMessage("Preparing database and writing configuration files...");
        runDatabaseSetup()
          .then(() => {
            setAutoProgress(20);
            setAutoMessage("Writing configuration files to disk...");
            return writeConfigs();
          })
          .then(() => {
            setAutoProgress(30);
            return runDkimSetup();
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : "Config write or DKIM setup failed";
            setAutoProgress(100);
            setAutoError(message);
            setAutoMessage("DKIM setup failed");
            setAutoRunning(false);
            // Allow user to proceed past failure (configs may still be valid)
            setStepValid(true);
          });
        break;
      case 7: // Permissions
        runPermissions();
        break;
      case 8: // Enable Services - show checkboxes, valid immediately
        setStepValid(true);
        break;
      case 9: // Summary - always valid
        setStepValid(true);
        break;
    }
  };

  const handleBack = () => {
    if (currentStep === 0) return;
    updateStatus(currentStep, "pending");
    setCurrentStep((prev) => prev - 1);
    setStepValid(true); // Going back to a completed step
    // Reset auto-progress state to prevent stale values from previous step
    setAutoProgress(0);
    setAutoRunning(false);
    setAutoMessage("");
    setAutoError("");
  };

  // Mark first step as in-progress on mount
  useEffect(() => {
    if (stepStatuses[0] === "pending" && currentStep === 0) {
      updateStatus(0, "in-progress");
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Step content renderer ----------

  const renderStepContent = () => {
    switch (currentStep) {
      // ---- Step 0: System Check ----
      case 0:
        return (
          <SystemCheck
            onValidChange={(valid) => setStepValid(valid)}
            onWebServerDetected={(ws) => setDetectedWebServer(ws)}
          />
        );

      // ---- Step 1: PHP Version ----
      case 1:
        return (
          <PhpSelect
            value={formData.phpVersion}
            onChange={(v) =>
              setFormData((prev) => ({ ...prev, phpVersion: v }))
            }
            onValidChange={setStepValid}
          />
        );

      // ---- Step 2: Core Packages ----
      case 2:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-mc-text">
                Core Packages
              </h3>
              <p className="mt-1 text-sm text-mc-text-muted">
                Installing required system packages via apt-get. This may take several minutes.
              </p>
            </div>
            <div className="space-y-2">
              {packages.map((pkg) => (
                <div
                  key={pkg.name}
                  className="flex items-center gap-3 rounded-lg border border-mc-border bg-mc-surface px-4 py-2.5"
                >
                  <div className="w-5 shrink-0">
                    {pkg.status === "installed" && (
                      <CheckCircle2 className="h-4 w-4 text-mc-success" />
                    )}
                    {pkg.status === "installing" && (
                      <Loader2 className="h-4 w-4 animate-spin text-mc-accent" />
                    )}
                    {pkg.status === "pending" && (
                      <Package className="h-4 w-4 text-mc-text-muted/40" />
                    )}
                    {pkg.status === "failed" && (
                      <XCircle className="h-4 w-4 text-mc-danger" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "min-w-[180px] font-mono text-sm",
                      pkg.status === "installed"
                        ? "text-mc-success"
                        : pkg.status === "installing"
                          ? "text-mc-text"
                          : pkg.status === "failed"
                            ? "text-mc-danger"
                            : "text-mc-text-muted"
                    )}
                  >
                    {pkg.name}
                  </span>
                  <div className="flex-1">
                    {pkg.status === "installing" ? (
                      <div className="h-1.5 overflow-hidden rounded-full bg-mc-bg">
                        <div className="h-full w-full animate-pulse rounded-full bg-mc-accent" />
                      </div>
                    ) : (
                      <div className="h-1.5 overflow-hidden rounded-full bg-mc-bg">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            pkg.status === "installed"
                              ? "bg-mc-success"
                              : pkg.status === "failed"
                                ? "bg-mc-danger"
                                : "bg-mc-accent"
                          )}
                          style={{ width: pkg.status === "installed" || pkg.status === "failed" ? "100%" : "0%" }}
                        />
                      </div>
                    )}
                  </div>
                  <span className="w-12 text-right font-mono text-xs text-mc-text-muted">
                    {pkg.status === "installed"
                      ? "done"
                      : pkg.status === "failed"
                        ? "error"
                        : pkg.status === "installing"
                          ? "..."
                          : ""}
                  </span>
                </div>
              ))}
            </div>
            {!packagesRunning && packages.some((p) => p.status === "failed") && (
              <div className="rounded-lg border border-mc-danger/30 bg-mc-danger/5 p-3 text-sm text-mc-danger">
                Some packages failed to install. Check server logs for details.
                {packages.filter((p) => p.status === "failed").map((p) => (
                  <div key={p.name} className="mt-1 font-mono text-xs">
                    {p.name}: {p.error}
                  </div>
                ))}
              </div>
            )}
            {!packagesRunning && packages.every((p) => p.status === "installed") && (
              <div className="rounded-lg border border-mc-success/30 bg-mc-success/5 p-3 text-sm text-mc-success">
                All {packages.length} packages installed successfully.
              </div>
            )}
          </div>
        );

      // ---- Step 3: Domain Configuration ----
      case 3:
        return (
          <DomainConfig
            value={{
              hostname: formData.hostname,
              mailDomain: formData.mailDomain,
              adminEmail: formData.adminEmail,
            }}
            onChange={(data) =>
              setFormData((prev) => ({
                ...prev,
                hostname: data.hostname,
                mailDomain: data.mailDomain,
                adminEmail: data.adminEmail,
              }))
            }
            onValidChange={setStepValid}
          />
        );

      // ---- Step 4: SSL Certificates ----
      case 4:
        return (
          <AutoProgressStep
            title="SSL Certificates"
            description="Obtaining SSL/TLS certificates from Let's Encrypt using Certbot."
            icon={<ShieldCheck className="h-5 w-5" />}
            progress={autoProgress}
            running={autoRunning}
            message={autoMessage}
            error={autoError}
            completedMessage={`SSL certificate issued for ${formData.hostname}. Auto-renewal enabled.`}
          />
        );

      // ---- Step 5: Service Configuration ----
      case 5:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-mc-text">
                Service Configuration
              </h3>
              <p className="mt-1 text-sm text-mc-text-muted">
                Review the generated configuration files. These will be written
                to their respective locations when you proceed to the next step.
              </p>
            </div>
            {generatedConfigs.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-mc-border bg-mc-surface p-6">
                <Loader2 className="h-5 w-5 animate-spin text-mc-accent" />
                <span className="text-sm text-mc-text-muted">Generating configuration files...</span>
              </div>
            ) : (
              <div className="space-y-4">
                {generatedConfigs.map((cfg) => (
                  <div
                    key={cfg.name}
                    className="overflow-hidden rounded-lg border border-mc-border"
                  >
                    <div className="flex items-center gap-2 border-b border-mc-border bg-mc-surface px-4 py-2">
                      <FileCode className="h-4 w-4 text-mc-accent" />
                      <span className="font-mono text-sm font-medium text-mc-text">
                        /etc/{cfg.name}
                      </span>
                    </div>
                    <pre className="overflow-x-auto bg-mc-bg p-4 font-mono text-xs leading-relaxed text-mc-text-muted">
                      {cfg.content}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      // ---- Step 6: DKIM Setup ----
      case 6:
        return (
          <AutoProgressStep
            title="DKIM Setup"
            description={`Generating DKIM signing key pair for ${formData.mailDomain}.`}
            icon={<Key className="h-5 w-5" />}
            progress={autoProgress}
            running={autoRunning}
            message={autoMessage}
            error={autoError}
            completedMessage={`DKIM keys generated. Selector: mail._domainkey.${formData.mailDomain}`}
          />
        );

      // ---- Step 7: Permissions ----
      case 7:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-mc-text">
                File Permissions
              </h3>
              <p className="mt-1 text-sm text-mc-text-muted">
                Setting correct file ownership and permissions for all mail
                services.
              </p>
            </div>
            {permChecklist.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-mc-border bg-mc-surface p-6">
                <Loader2 className="h-5 w-5 animate-spin text-mc-accent" />
                <span className="text-sm text-mc-text-muted">Applying permissions...</span>
              </div>
            ) : (
              <div className="space-y-2">
                {permChecklist.map((item, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-4 py-3 transition-all duration-300",
                      item.done
                        ? "border-mc-success/20 bg-mc-success/5"
                        : item.error
                          ? "border-mc-danger/20 bg-mc-danger/5"
                          : "border-mc-border bg-mc-surface"
                    )}
                  >
                    {item.done ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-mc-success" />
                    ) : item.error ? (
                      <XCircle className="h-4 w-4 shrink-0 text-mc-danger" />
                    ) : (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-mc-accent" />
                    )}
                    <div className="flex-1">
                      <span
                        className={cn(
                          "font-mono text-sm",
                          item.done ? "text-mc-success" : item.error ? "text-mc-danger" : "text-mc-text-muted"
                        )}
                      >
                        {item.label}
                      </span>
                      {item.error && (
                        <p className="mt-0.5 text-xs text-mc-danger">{item.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {permChecklist.length > 0 && permChecklist.every((p) => p.done) && (
              <div className="rounded-lg border border-mc-success/30 bg-mc-success/5 p-3 text-sm text-mc-success">
                All permissions verified and applied.
              </div>
            )}
          </div>
        );

      // ---- Step 8: Enable Services ----
      case 8:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-mc-text">
                Enable Services
              </h3>
              <p className="mt-1 text-sm text-mc-text-muted">
                Select which services to enable and start. All services are
                enabled by default.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Object.entries(formData.enabledServices).map(
                ([service, enabled]) => (
                  <label
                    key={service}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-all",
                      enabled
                        ? "border-mc-accent/30 bg-mc-accent/5"
                        : "border-mc-border bg-mc-surface"
                    )}
                  >
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            enabledServices: {
                              ...prev.enabledServices,
                              [service]: e.target.checked,
                            },
                          }))
                        }
                        className="peer sr-only"
                      />
                      <div
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded border-2 transition-colors",
                          enabled
                            ? "border-mc-accent bg-mc-accent"
                            : "border-mc-text-muted bg-mc-bg"
                        )}
                      >
                        {enabled && (
                          <svg
                            className="h-3 w-3 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Power
                        className={cn(
                          "h-4 w-4",
                          enabled ? "text-mc-accent" : "text-mc-text-muted"
                        )}
                      />
                      <span
                        className={cn(
                          "text-sm font-medium",
                          enabled ? "text-mc-text" : "text-mc-text-muted"
                        )}
                      >
                        {service}
                      </span>
                    </div>
                  </label>
                )
              )}
            </div>
          </div>
        );

      // ---- Step 9: Summary ----
      case 9:
        return (
          <Summary
            hostname={formData.hostname}
            mailDomain={formData.mailDomain}
            adminEmail={formData.adminEmail}
          />
        );

      default:
        return null;
    }
  };

  const isLastStep = currentStep === STEP_DEFINITIONS.length - 1;
  const isFirstStep = currentStep === 0;

  // When clicking Next on the Enable Services step, actually enable them
  const handleNextWithServiceEnable = () => {
    if (currentStep === 8) {
      // Enable services before proceeding — only advance on success
      runEnableServices().then((success) => {
        if (success) {
          handleNext();
        }
      }).catch((err) => {
        const message = err instanceof Error ? err.message : "Failed to enable services";
        setAutoError(message);
      });
      return;
    }
    handleNext();
  };

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-mc-border bg-mc-surface/50 p-4 md:flex-row md:p-6">
      {/* Left: Step Tracker */}
      <div className="w-full shrink-0 border-b border-mc-border pb-4 md:w-64 md:border-b-0 md:border-r md:pb-0 md:pr-6">
        <StepTracker
          steps={steps}
          currentStep={currentStep}
          onStepClick={(index) => {
            // Only allow clicking completed steps
            if (stepStatuses[index] === "completed") {
              setCurrentStep(index);
              setStepValid(true);
              // Reset auto-progress state to prevent cross-step contamination
              setAutoProgress(0);
              setAutoRunning(false);
              setAutoMessage("");
              setAutoError("");
            }
          }}
        />
      </div>

      {/* Right: Step Content */}
      <div className="flex min-h-[400px] flex-1 flex-col md:min-h-[500px]">
        <div className="flex-1">{renderStepContent()}</div>

        {/* Navigation buttons */}
        <div className="mt-6 flex items-center justify-between border-t border-mc-border pt-4">
          <button
            onClick={handleBack}
            disabled={isFirstStep}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              isFirstStep
                ? "cursor-not-allowed text-mc-text-muted/40"
                : "text-mc-text-muted hover:bg-mc-surface-hover hover:text-mc-text"
            )}
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex items-center gap-3">
            <span className="text-xs text-mc-text-muted">
              Step {currentStep + 1} of {STEP_DEFINITIONS.length}
            </span>

            {!isLastStep && (
              <button
                onClick={handleNextWithServiceEnable}
                disabled={!stepValid || autoRunning || packagesRunning}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium transition-all",
                  stepValid && !autoRunning && !packagesRunning
                    ? "bg-mc-accent text-white shadow-lg shadow-mc-accent/20 hover:bg-mc-accent-hover"
                    : "cursor-not-allowed bg-mc-accent/20 text-mc-accent/50"
                )}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            )}

            {isLastStep && (
              <button
                onClick={() => {
                  updateStatus(currentStep, "completed");
                  completeInstall.mutate(undefined, {
                    onSuccess: () => {
                      router.replace("/");
                    },
                    onError: (err) => {
                      updateStatus(currentStep, "in-progress");
                      setAutoError(err instanceof Error ? err.message : "Failed to complete install");
                    },
                  });
                }}
                disabled={completeInstall.isPending}
                className={cn(
                  "flex items-center gap-2 rounded-lg bg-mc-success px-5 py-2 text-sm font-medium text-white shadow-lg shadow-mc-success/20 transition-all hover:bg-mc-success/90",
                  completeInstall.isPending && "opacity-70 cursor-not-allowed"
                )}
              >
                {completeInstall.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {completeInstall.isPending ? "Finishing..." : "Finish"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =================================================================
// Auto Progress Step (reusable for DB, SSL, DKIM, services)
// =================================================================

function AutoProgressStep({
  title,
  description,
  icon,
  progress,
  running,
  message,
  error,
  completedMessage,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  progress: number;
  running: boolean;
  message: string;
  error?: string;
  completedMessage: string;
}) {
  const isComplete = !running && progress >= 100 && !error;
  const isFailed = !running && error;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-mc-text">{title}</h3>
        <p className="mt-1 text-sm text-mc-text-muted">{description}</p>
      </div>

      <div className="rounded-lg border border-mc-border bg-mc-surface p-6">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl",
              isComplete
                ? "bg-mc-success/10 text-mc-success"
                : isFailed
                  ? "bg-mc-danger/10 text-mc-danger"
                  : "bg-mc-accent/10 text-mc-accent"
            )}
          >
            {isComplete ? (
              <CheckCircle2 className="h-6 w-6" />
            ) : isFailed ? (
              <XCircle className="h-6 w-6" />
            ) : running ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              icon
            )}
          </div>

          <div className="flex-1">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-mc-text">
                {isComplete ? completedMessage : message || "Waiting..."}
              </p>
              {running && (
                <span className="font-mono text-xs text-mc-text-muted">
                  {progress}%
                </span>
              )}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-mc-bg">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  isComplete ? "bg-mc-success" : isFailed ? "bg-mc-danger" : "bg-mc-accent"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {isComplete && (
        <div className="rounded-lg border border-mc-success/30 bg-mc-success/5 p-3 text-sm text-mc-success">
          {completedMessage}
        </div>
      )}

      {isFailed && (
        <div className="rounded-lg border border-mc-danger/30 bg-mc-danger/5 p-3 text-sm text-mc-danger">
          <p className="font-medium">Operation failed</p>
          <p className="mt-1 font-mono text-xs">{error}</p>
        </div>
      )}
    </div>
  );
}

// AdminAccountStep removed — admin account creation now handled by first-run welcome wizard
