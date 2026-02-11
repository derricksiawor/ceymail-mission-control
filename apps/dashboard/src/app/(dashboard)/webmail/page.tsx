"use client";

import { useState, useEffect, useRef } from "react";
import {
  MailOpen, ExternalLink, Globe, CheckCircle2,
  Loader2, Server, Settings, Copy, Check, Mail,
  Package, Shield, Inbox, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWebmailStatus, useSetupWebmail, useReconfigureWebmail } from "@/lib/hooks/use-webmail";
import { useSettings } from "@/lib/hooks/use-settings";

export default function WebmailPage() {
  const { data: webmail, isLoading, isError, error } = useWebmailStatus();
  const { data: settings } = useSettings();
  const setupMutation = useSetupWebmail();
  const reconfigureMutation = useReconfigureWebmail();

  const [domain, setDomain] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [setupError, setSetupError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dnsInstructions, setDnsInstructions] = useState<string[]>([]);
  const [setupComplete, setSetupComplete] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoFilled = useRef(false);
  const reconfigureAttempted = useRef(false);
  const reconfigureMutRef = useRef(reconfigureMutation);
  reconfigureMutRef.current = reconfigureMutation;

  // Auto-fill domain and admin email from settings (one-time only)
  useEffect(() => {
    if (autoFilled.current || !settings) return;
    if (settings?.general?.hostname) {
      setDomain(settings.general.hostname);
    }
    if (settings?.general?.adminEmail) {
      setAdminEmail(settings.general.adminEmail);
    }
    autoFilled.current = true;
  }, [settings]);

  // Auto-reconfigure when SSL mismatch is detected (e.g. SSL cert added after initial setup)
  useEffect(() => {
    if (
      webmail?.installed &&
      webmail?.needsReconfigure &&
      webmail?.domain &&
      settings?.general?.adminEmail &&
      !reconfigureAttempted.current &&
      !reconfigureMutRef.current.isPending
    ) {
      reconfigureAttempted.current = true;
      reconfigureMutRef.current.mutate({
        domain: webmail.domain,
        adminEmail: settings.general.adminEmail,
      });
    }
  }, [webmail?.installed, webmail?.needsReconfigure, webmail?.domain, settings?.general?.adminEmail]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopyUrl = async () => {
    if (!webmail?.url) return;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    try {
      await navigator.clipboard.writeText(webmail.url);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for mobile browsers where Clipboard API is unavailable
      try {
        const textarea = document.createElement("textarea");
        textarea.value = webmail.url;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopied(true);
        copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
      } catch {
        // Both clipboard methods unavailable
      }
    }
  };

  const handleSetup = () => {
    setSetupError("");
    const trimmedDomain = domain.trim().toLowerCase();
    const trimmedEmail = adminEmail.trim().toLowerCase();

    if (!trimmedDomain) {
      setSetupError("Domain is required");
      return;
    }
    if (trimmedDomain.length > 253 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(trimmedDomain)) {
      setSetupError("Invalid domain format");
      return;
    }
    if (!trimmedEmail) {
      setSetupError("Admin email is required");
      return;
    }
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmedEmail)) {
      setSetupError("Invalid email format");
      return;
    }

    setupMutation.mutate(
      { domain: trimmedDomain, adminEmail: trimmedEmail },
      {
        onSuccess: (data) => {
          setDnsInstructions(data.dnsInstructions);
          setSetupComplete(true);
        },
        onError: (err) => {
          setSetupError(err instanceof Error ? err.message : "Failed to setup webmail");
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-mc-accent" />
          <p className="text-sm text-mc-text-muted">Checking webmail status...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <MailOpen className="h-8 w-8 text-mc-danger" />
          <p className="text-sm text-mc-danger">Failed to check webmail status</p>
          <p className="text-xs text-mc-text-muted">{error?.message ?? "Unknown error"}</p>
        </div>
      </div>
    );
  }

  // ── Installed State ──
  if (webmail?.installed) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-mc-text">Webmail</h1>
            <p className="text-sm text-mc-text-muted">Roundcube webmail management</p>
          </div>
          {webmail.url && (
            <a
              href={webmail.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] w-fit items-center gap-2 rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover"
            >
              <ExternalLink className="h-4 w-4" />
              Open Webmail
            </a>
          )}
        </div>

        {/* SSL Reconfiguration Status */}
        {reconfigureMutation.isPending && (
          <div className="flex items-center gap-3 rounded-xl bg-mc-accent/5 px-4 py-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-mc-accent" />
            <p className="text-sm text-mc-accent">Reconfiguring webmail for SSL...</p>
          </div>
        )}
        {reconfigureMutation.isSuccess && (
          <div className="flex items-center gap-2 rounded-xl bg-mc-success/5 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-mc-success" />
            <p className="text-sm text-mc-success">SSL configuration updated successfully</p>
          </div>
        )}
        {reconfigureMutation.isError && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-mc-danger/5 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 shrink-0 text-mc-danger" />
              <p className="text-sm text-mc-danger">
                SSL reconfiguration failed: {reconfigureMutation.error?.message}
              </p>
            </div>
            <button
              onClick={() => {
                if (webmail?.domain && settings?.general?.adminEmail) {
                  reconfigureMutation.mutate({
                    domain: webmail.domain,
                    adminEmail: settings.general.adminEmail,
                  });
                }
              }}
              disabled={reconfigureMutation.isPending}
              className={cn(
                "flex min-h-[44px] w-fit shrink-0 items-center rounded-lg bg-mc-danger/10 px-3 py-2 text-xs font-medium text-mc-danger transition-colors hover:bg-mc-danger/20",
                reconfigureMutation.isPending && "cursor-not-allowed opacity-50"
              )}
            >
              Retry
            </button>
          </div>
        )}

        {/* DNS Instructions (shown after fresh setup) */}
        {dnsInstructions.length > 0 && (
          <div className="glass-subtle rounded-xl p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
              DNS Configuration
            </h3>
            <div className="space-y-2">
              {dnsInstructions.map((instruction, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-mc-warning/5 px-4 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-mc-warning" />
                  <p className="text-sm text-mc-text">{instruction}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="glass-subtle rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                webmail.status === "running" ? "bg-mc-success/10" : "bg-mc-danger/10"
              )}>
                <Server className={cn(
                  "h-5 w-5",
                  webmail.status === "running" ? "text-mc-success" : "text-mc-danger"
                )} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-mc-text capitalize">{webmail.status}</p>
                <p className="text-xs text-mc-text-muted">Web Server Status</p>
              </div>
            </div>
          </div>
          <div className="glass-subtle rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-mc-accent/10">
                <Settings className="h-5 w-5 text-mc-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-mc-text">{webmail.version ?? "N/A"}</p>
                <p className="text-xs text-mc-text-muted">Roundcube Version</p>
              </div>
            </div>
          </div>
          <div className="glass-subtle rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-mc-info/10">
                <Globe className="h-5 w-5 text-mc-info" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xl font-bold text-mc-text sm:text-2xl" title={webmail.domain ?? "N/A"}>{webmail.domain ?? "N/A"}</p>
                <p className="text-xs text-mc-text-muted">Domain</p>
              </div>
            </div>
          </div>
        </div>

        {/* Webmail URL */}
        {webmail.url && (
          <div className="glass-subtle rounded-xl p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
              Webmail Access
            </h3>
            <div className="flex flex-col gap-3 rounded-lg bg-mc-bg px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-mc-text-muted">URL</p>
                <code className="block break-all font-mono text-sm font-medium text-mc-accent">
                  {webmail.url}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyUrl}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-mc-accent/5 px-3 py-2 text-xs text-mc-text-muted transition-colors hover:bg-mc-accent/10 hover:text-mc-accent"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-mc-success" />
                      <span className="text-mc-success">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </button>
                <a
                  href={webmail.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-mc-accent/10 px-3 py-2 text-xs font-medium text-mc-accent transition-colors hover:bg-mc-accent/20"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Configuration Summary */}
        {webmail.domain && (
          <div className="glass-subtle rounded-xl p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
              Configuration
            </h3>
            <div className="space-y-3">
              {[
                { label: "Path", value: "/webmail" },
                { label: "Web Server", value: webmail.webServer === "nginx" ? "Nginx" : webmail.webServer === "apache2" ? "Apache" : webmail.webServer },
                { label: "IMAP Host", value: `ssl://${webmail.domain}:993` },
                { label: "SMTP Host", value: `tls://${webmail.domain}:587` },
                { label: "Skin", value: "Elastic" },
                { label: "Plugins", value: "archive, zipdownload" },
                { label: "Auto-save Drafts", value: "Every 2 minutes" },
              ].map((item) => (
                <div key={item.label} className="flex flex-col gap-1 rounded-lg bg-mc-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <span className="shrink-0 text-sm text-mc-text-muted">{item.label}</span>
                  <span className="break-all font-mono text-sm font-medium text-mc-text">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status Indicator */}
        {webmail.status === "running" && webmail.url && (
          <div className="flex items-center gap-2 rounded-lg bg-mc-success/5 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-mc-success" />
            <p className="break-all text-xs text-mc-success">
              Webmail is active and accessible at {webmail.url}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Not Installed State ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-mc-text">Webmail</h1>
        <p className="text-sm text-mc-text-muted">Set up Roundcube webmail for your mail server</p>
      </div>

      {/* Setup Card */}
      <div className="glass-subtle rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-mc-accent/10">
            <MailOpen className="h-6 w-6 text-mc-accent" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-mc-text">Setup Roundcube Webmail</h2>
            <p className="mt-1 text-sm text-mc-text-muted">
              Install and configure Roundcube so your users can access email from any browser.
              Roundcube provides a modern, responsive webmail interface with IMAP and SMTP support.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-mc-text">
              Mail Server Domain
            </label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
              <input
                type="text"
                value={domain}
                onChange={(e) => { setDomain(e.target.value); setSetupError(""); }}
                disabled={setupMutation.isPending}
                placeholder="mail.example.com"
                className="w-full rounded-lg border border-mc-border bg-mc-bg py-3 pl-10 pr-4 text-sm text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <p className="mt-1 text-xs text-mc-text-muted">
              The hostname of your mail server. Used for IMAP and SMTP connections.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-mc-text">
              Admin Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => { setAdminEmail(e.target.value); setSetupError(""); }}
                disabled={setupMutation.isPending}
                placeholder="admin@example.com"
                className="w-full rounded-lg border border-mc-border bg-mc-bg py-3 pl-10 pr-4 text-sm text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <p className="mt-1 text-xs text-mc-text-muted">
              Contact email displayed on the Roundcube support page.
            </p>
          </div>
        </div>

        {setupError && (
          <div className="mt-4 rounded-lg bg-mc-danger/5 px-4 py-3">
            <p className="text-sm text-mc-danger">{setupError}</p>
          </div>
        )}

        <div className="mt-6">
          <button
            onClick={handleSetup}
            disabled={setupMutation.isPending || setupComplete}
            className={cn(
              "flex min-h-[44px] w-fit items-center gap-2 rounded-lg bg-mc-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover",
              setupMutation.isPending && "cursor-not-allowed opacity-70"
            )}
          >
            {setupMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Setting up...
              </>
            ) : (
              <>
                <MailOpen className="h-4 w-4" />
                Setup Webmail
              </>
            )}
          </button>
        </div>
      </div>

      {/* What Gets Installed */}
      <div className="glass-subtle rounded-xl p-6">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
          What Gets Installed
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            { icon: Package, label: "Roundcube", desc: "Modern webmail client with responsive UI" },
            { icon: Inbox, label: "IMAP/SMTP", desc: "Secure mail access via SSL/TLS encryption" },
            { icon: Shield, label: "Security", desc: "Session protection, IP checking, HTTPS enforced" },
            { icon: Settings, label: "Web Server", desc: "Auto-configured for your active web server" },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex items-start gap-3 rounded-lg bg-mc-bg px-4 py-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-mc-accent" />
                <div>
                  <p className="text-sm font-medium text-mc-text">{item.label}</p>
                  <p className="text-xs text-mc-text-muted">{item.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
