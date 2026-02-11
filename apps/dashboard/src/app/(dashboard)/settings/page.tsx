"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Settings, Server, Shield, Bell, Info, Save, Check,
  Globe, Mail, Clock, Lock, Loader2, RotateCcw, AlertTriangle, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings, useUpdateSetting, type AppSettings } from "@/lib/hooks/use-settings";
import { useInstallStatus, useResetInstall } from "@/lib/hooks/use-install-status";
import { useFactoryReset } from "@/lib/hooks/use-factory-reset";

type Tab = "general" | "security" | "notifications" | "about";

const TABS: { id: Tab; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Server },
  { id: "security", label: "Security", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "about", label: "About", icon: Info },
];

export default function SettingsPage() {
  const { data: settings, isLoading, error } = useSettings();
  const updateMutation = useUpdateSetting();
  const { data: installStatus } = useInstallStatus();
  const resetInstall = useResetInstall();
  const factoryReset = useFactoryReset();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showReinstallConfirm, setShowReinstallConfirm] = useState(false);
  const [reinstallError, setReinstallError] = useState("");
  const [showFactoryResetConfirm, setShowFactoryResetConfirm] = useState(false);
  const [factoryResetConfirmText, setFactoryResetConfirmText] = useState("");
  const [factoryResetError, setFactoryResetError] = useState("");
  const [factoryResetDone, setFactoryResetDone] = useState(false);
  const [factoryResetStatus, setFactoryResetStatus] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Escape key handler for dialogs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowReinstallConfirm(false);
        setReinstallError("");
        if (!factoryReset.isPending && !factoryResetDone) {
          setShowFactoryResetConfirm(false);
          setFactoryResetConfirmText("");
          setFactoryResetError("");
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [factoryReset.isPending, factoryResetDone]);

  // Local state for editing
  const [general, setGeneral] = useState({
    hostname: "",
    adminEmail: "",
    timezone: "UTC",
    maxMessageSize: "25",
    smtpBanner: "$myhostname ESMTP CeyMail",
  });

  const [security, setSecurity] = useState({
    minPasswordLength: 8,
    requireUppercase: true,
    requireNumbers: true,
    requireSpecialChars: false,
    sessionTimeout: 30,
    maxLoginAttempts: 5,
    lockoutDuration: 15,
    enforceSSL: true,
  });

  const [notifications, setNotifications] = useState({
    enableEmailAlerts: false,
    alertRecipient: "",
    notifyOnServiceDown: true,
    notifyOnDiskWarning: true,
    notifyOnLoginFailure: true,
    notifyOnQueueBacklog: false,
    diskWarningThreshold: 85,
    queueBacklogThreshold: 100,
  });

  // Sync settings from API when loaded
  useEffect(() => {
    if (settings) {
      setGeneral(settings.general);
      setSecurity(settings.security);
      setNotifications(settings.notifications);
    }
  }, [settings]);

  const handleSave = async () => {
    setSaveError("");
    const fields = [
      { key: "hostname", value: general.hostname },
      { key: "maxMessageSize", value: general.maxMessageSize },
      { key: "smtpBanner", value: general.smtpBanner },
    ];
    const failed: string[] = [];

    for (const field of fields) {
      try {
        await updateMutation.mutateAsync({
          section: "general",
          key: field.key,
          value: field.value,
        });
      } catch {
        failed.push(field.key);
      }
    }

    if (failed.length > 0) {
      setSaveError(`Failed to save: ${failed.join(", ")}`);
    } else {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaved(true);
      saveTimerRef.current = setTimeout(() => setSaved(false), 2000);
    }
  };

  const updateGeneral = (key: keyof typeof general, value: string) => {
    setGeneral((prev) => ({ ...prev, [key]: value }));
  };

  const updateSecurity = (key: keyof typeof security, value: number | boolean) => {
    setSecurity((prev) => ({ ...prev, [key]: value }));
  };

  const updateNotifications = (key: keyof typeof notifications, value: string | number | boolean) => {
    setNotifications((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-mc-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-mc-danger/20 bg-mc-danger/5 p-4">
        <p className="text-sm text-mc-danger">Failed to load settings: {error.message}</p>
      </div>
    );
  }

  const aboutData = settings?.about;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-mc-text">Settings</h1>
          <p className="text-sm text-mc-text-muted">Configure CeyMail server settings</p>
        </div>
        {activeTab === "general" && (
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors",
              saved
                ? "bg-mc-success hover:bg-mc-success/80"
                : "bg-mc-accent hover:bg-mc-accent-hover"
            )}
          >
            {saved ? (
              <>
                <Check className="h-4 w-4" />
                Saved
              </>
            ) : updateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Changes
              </>
            )}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-mc-border bg-mc-surface p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-mc-accent text-white"
                  : "text-mc-text-muted hover:bg-mc-surface-hover hover:text-mc-text"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-xs sm:text-sm">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* General Tab */}
      {activeTab === "general" && (
        <div className="space-y-6">
          {saveError && (
            <div className="flex items-center gap-2 rounded-lg border border-mc-danger/30 bg-mc-danger/10 px-4 py-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-mc-danger" />
              <p className="text-sm text-mc-danger">{saveError}</p>
            </div>
          )}
          <div className="glass-subtle rounded-xl p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
              Server Configuration
            </h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-mc-text">Hostname</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
                  <input
                    type="text"
                    value={general.hostname}
                    onChange={(e) => updateGeneral("hostname", e.target.value)}
                    className="w-full rounded-lg border border-mc-border bg-mc-bg py-2.5 pl-10 pr-4 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                  />
                </div>
                <p className="mt-1 text-xs text-mc-text-muted">
                  The fully qualified domain name of this mail server.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-mc-text">Admin Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
                  <input
                    type="email"
                    value={general.adminEmail}
                    readOnly
                    className="w-full rounded-lg border border-mc-border bg-mc-bg/50 py-2.5 pl-10 pr-4 text-sm text-mc-text-muted cursor-not-allowed"
                  />
                </div>
                <p className="mt-1 text-xs text-mc-text-muted">
                  Derived from server configuration. Change via Postfix config.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-mc-text">Timezone</label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
                  <input
                    type="text"
                    value={general.timezone}
                    readOnly
                    className="w-full rounded-lg border border-mc-border bg-mc-bg/50 py-2.5 pl-10 pr-4 text-sm text-mc-text-muted cursor-not-allowed"
                  />
                </div>
                <p className="mt-1 text-xs text-mc-text-muted">
                  Derived from server timezone. Change via timedatectl.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-mc-text">
                  Max Message Size (MB)
                </label>
                <input
                  type="number"
                  value={general.maxMessageSize}
                  onChange={(e) => updateGeneral("maxMessageSize", e.target.value)}
                  min="1"
                  max="100"
                  className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                />
                <p className="mt-1 text-xs text-mc-text-muted">
                  Maximum size for incoming and outgoing email messages.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-mc-text">SMTP Banner</label>
                <input
                  type="text"
                  value={general.smtpBanner}
                  onChange={(e) => updateGeneral("smtpBanner", e.target.value)}
                  className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 font-mono text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                />
                <p className="mt-1 text-xs text-mc-text-muted">
                  The greeting banner displayed to connecting SMTP clients.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === "security" && (
        <div className="space-y-6">
          <div className="rounded-lg bg-mc-accent/5 px-4 py-3">
            <p className="text-xs text-mc-accent">
              <Lock className="mr-1.5 inline-block h-3.5 w-3.5" />
              Security settings are currently read-only. Password policy is enforced server-side.
            </p>
          </div>
          <div className="glass-subtle rounded-xl p-6 opacity-75 pointer-events-none">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
              Password Policy
            </h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-mc-text">
                  Minimum Password Length
                </label>
                <input
                  type="number"
                  value={security.minPasswordLength}
                  onChange={(e) => updateSecurity("minPasswordLength", parseInt(e.target.value) || 6)}
                  min="6"
                  max="32"
                  className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                />
              </div>

              <div className="space-y-3">
                {([
                  { key: "requireUppercase" as const, label: "Require uppercase letter" },
                  { key: "requireNumbers" as const, label: "Require number" },
                  { key: "requireSpecialChars" as const, label: "Require special character" },
                ]).map((item) => (
                  <div key={item.key} className="flex items-center justify-between">
                    <span className="text-sm text-mc-text">{item.label}</span>
                    <button
                      role="switch"
                      aria-checked={security[item.key]}
                      aria-label={item.label}
                      onClick={() => updateSecurity(item.key, !security[item.key])}
                      className="relative flex items-center justify-center min-h-[44px] min-w-[44px]"
                    >
                      <span className={cn(
                        "relative h-5 w-9 rounded-full transition-colors",
                        security[item.key] ? "bg-mc-success" : "bg-mc-text-muted/30"
                      )}>
                        <span
                          className={cn(
                            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                            security[item.key] ? "left-[18px]" : "left-0.5"
                          )}
                        />
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="glass-subtle rounded-xl p-6 opacity-75 pointer-events-none">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
              Session & Login
            </h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-mc-text">
                  Session Timeout (minutes)
                </label>
                <input
                  type="number"
                  value={security.sessionTimeout}
                  onChange={(e) => updateSecurity("sessionTimeout", parseInt(e.target.value) || 5)}
                  min="5"
                  max="1440"
                  className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                />
                <p className="mt-1 text-xs text-mc-text-muted">
                  Time of inactivity before a dashboard session expires.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-mc-text">
                  Max Login Attempts
                </label>
                <input
                  type="number"
                  value={security.maxLoginAttempts}
                  onChange={(e) => updateSecurity("maxLoginAttempts", parseInt(e.target.value) || 3)}
                  min="3"
                  max="20"
                  className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-mc-text">
                  Lockout Duration (minutes)
                </label>
                <input
                  type="number"
                  value={security.lockoutDuration}
                  onChange={(e) => updateSecurity("lockoutDuration", parseInt(e.target.value) || 5)}
                  min="1"
                  max="120"
                  className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                />
                <p className="mt-1 text-xs text-mc-text-muted">
                  Duration to lock an account after exceeding max login attempts.
                </p>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="text-sm font-medium text-mc-text">Enforce SSL/TLS</span>
                  <p className="text-xs text-mc-text-muted">
                    Require encrypted connections for all services.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={security.enforceSSL}
                  aria-label="Enforce SSL/TLS"
                  onClick={() => updateSecurity("enforceSSL", !security.enforceSSL)}
                  className="relative shrink-0 flex items-center justify-center min-h-[44px] min-w-[44px]"
                >
                  <span className={cn(
                    "relative h-5 w-9 rounded-full transition-colors",
                    security.enforceSSL ? "bg-mc-success" : "bg-mc-text-muted/30"
                  )}>
                    <span
                      className={cn(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                        security.enforceSSL ? "left-[18px]" : "left-0.5"
                      )}
                    />
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notifications Tab */}
      {activeTab === "notifications" && (
        <div className="space-y-6">
          <div className="rounded-lg bg-mc-accent/5 px-4 py-3">
            <p className="text-xs text-mc-accent">
              <Bell className="mr-1.5 inline-block h-3.5 w-3.5" />
              Notification settings are currently read-only. Email alerting is not yet available.
            </p>
          </div>
          <div className="glass-subtle rounded-xl p-6 opacity-75 pointer-events-none">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
              Email Alerts
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-mc-text">Enable Email Alerts</span>
                  <p className="text-xs text-mc-text-muted">
                    Send email notifications for important events.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={notifications.enableEmailAlerts}
                  aria-label="Enable Email Alerts"
                  onClick={() => updateNotifications("enableEmailAlerts", !notifications.enableEmailAlerts)}
                  className="relative shrink-0 flex items-center justify-center min-h-[44px] min-w-[44px]"
                >
                  <span className={cn(
                    "relative h-5 w-9 rounded-full transition-colors",
                    notifications.enableEmailAlerts ? "bg-mc-success" : "bg-mc-text-muted/30"
                  )}>
                    <span
                      className={cn(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                        notifications.enableEmailAlerts ? "left-[18px]" : "left-0.5"
                      )}
                    />
                  </span>
                </button>
              </div>

              {notifications.enableEmailAlerts && (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-mc-text">
                      Alert Recipient
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
                      <input
                        type="email"
                        value={notifications.alertRecipient}
                        onChange={(e) => updateNotifications("alertRecipient", e.target.value)}
                        className="w-full rounded-lg border border-mc-border bg-mc-bg py-2.5 pl-10 pr-4 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                      />
                    </div>
                  </div>

                  <div className="border-t border-mc-border pt-4">
                    <p className="mb-3 text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                      Alert Types
                    </p>
                    <div className="space-y-3">
                      {([
                        { key: "notifyOnServiceDown" as const, label: "Service Down", desc: "Alert when a service stops unexpectedly" },
                        { key: "notifyOnDiskWarning" as const, label: "Disk Space Warning", desc: "Alert when disk usage exceeds threshold" },
                        { key: "notifyOnLoginFailure" as const, label: "Failed Login Attempts", desc: "Alert on repeated failed IMAP/SMTP logins" },
                        { key: "notifyOnQueueBacklog" as const, label: "Queue Backlog", desc: "Alert when mail queue exceeds threshold" },
                      ]).map((item) => (
                        <div key={item.key} className="flex items-center justify-between">
                          <div>
                            <span className="text-sm text-mc-text">{item.label}</span>
                            <p className="text-xs text-mc-text-muted">{item.desc}</p>
                          </div>
                          <button
                            role="switch"
                            aria-checked={notifications[item.key] as boolean}
                            aria-label={item.label}
                            onClick={() => updateNotifications(item.key, !notifications[item.key])}
                            className="relative shrink-0 flex items-center justify-center min-h-[44px] min-w-[44px]"
                          >
                            <span className={cn(
                              "relative h-5 w-9 rounded-full transition-colors",
                              notifications[item.key] ? "bg-mc-success" : "bg-mc-text-muted/30"
                            )}>
                              <span
                                className={cn(
                                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                                  notifications[item.key] ? "left-[18px]" : "left-0.5"
                                )}
                              />
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-mc-border pt-4">
                    <p className="mb-3 text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                      Thresholds
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-mc-text">
                          Disk Warning Threshold (%)
                        </label>
                        <input
                          type="number"
                          value={notifications.diskWarningThreshold}
                          onChange={(e) =>
                            updateNotifications("diskWarningThreshold", parseInt(e.target.value) || 50)
                          }
                          min="50"
                          max="99"
                          className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-mc-text">
                          Queue Backlog Threshold
                        </label>
                        <input
                          type="number"
                          value={notifications.queueBacklogThreshold}
                          onChange={(e) =>
                            updateNotifications("queueBacklogThreshold", parseInt(e.target.value) || 10)
                          }
                          min="10"
                          max="10000"
                          className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* About Tab */}
      {activeTab === "about" && aboutData && (
        <div className="space-y-6">
          <div className="glass-subtle rounded-xl p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
              Version Information
            </h3>
            <div className="space-y-3">
              {[
                { label: "CeyMail Mission Control", value: `v${process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0"}` },
                { label: "Dashboard Framework", value: "Next.js 15" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg bg-mc-bg px-4 py-3">
                  <span className="shrink-0 text-sm text-mc-text-muted">{item.label}</span>
                  <span className="truncate font-mono text-sm font-medium text-mc-text">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-subtle rounded-xl p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
              System Information
            </h3>
            <div className="space-y-3">
              {[
                { label: "Operating System", value: aboutData.os },
                { label: "Kernel", value: aboutData.kernel },
                { label: "Architecture", value: aboutData.architecture },
                { label: "Hostname", value: aboutData.hostname },
                { label: "Timezone", value: aboutData.timezone },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg bg-mc-bg px-4 py-3">
                  <span className="shrink-0 text-sm text-mc-text-muted">{item.label}</span>
                  <span className="truncate font-mono text-sm font-medium text-mc-text">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-subtle rounded-xl p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
              Component Versions
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {aboutData.components.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between rounded-lg bg-mc-bg px-4 py-3"
                >
                  <span className="text-sm text-mc-text">{item.name}</span>
                  <span className="rounded-full bg-mc-accent/10 px-2.5 py-0.5 font-mono text-xs font-medium text-mc-accent">
                    {item.version}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Maintenance Section */}
          <div className="glass-subtle rounded-xl p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-text-muted">
              Maintenance
            </h3>
            <div className="flex flex-col gap-3 rounded-lg bg-mc-bg px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-sm font-medium text-mc-text">Re-install Mail Services</span>
                <p className="mt-0.5 text-xs text-mc-text-muted">
                  {installStatus?.installed && installStatus.completedAt
                    ? `Last installed: ${new Date(installStatus.completedAt).toLocaleString()}`
                    : "Mail services have not been installed yet"}
                </p>
              </div>
              <button
                onClick={() => setShowReinstallConfirm(true)}
                className="flex w-fit items-center gap-2 rounded-lg bg-mc-warning/10 px-4 py-2 text-sm font-medium text-mc-warning transition-colors hover:bg-mc-warning/20"
              >
                <RotateCcw className="h-4 w-4" />
                Re-install
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="rounded-xl bg-mc-danger/5 p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-mc-danger">
              Danger Zone
            </h3>
            <div className="flex flex-col gap-3 rounded-lg bg-mc-bg px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-sm font-medium text-mc-text">Factory Reset</span>
                <p className="mt-0.5 text-xs text-mc-text-muted">
                  Completely wipe all data and return to the setup wizard. This drops all databases,
                  removes configuration, and restarts the service.
                </p>
              </div>
              <button
                onClick={() => setShowFactoryResetConfirm(true)}
                className="flex w-fit shrink-0 whitespace-nowrap items-center gap-2 rounded-lg bg-mc-danger/10 px-6 py-2 text-sm font-medium text-mc-danger transition-colors hover:bg-mc-danger/20"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                Factory Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Re-install Confirmation Modal */}
      {showReinstallConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowReinstallConfirm(false)}>
          <div className="mx-4 w-full max-w-md rounded-xl bg-mc-surface-solid p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mc-warning/10">
                <AlertTriangle className="h-5 w-5 text-mc-warning" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-mc-text">Confirm Re-install</h3>
                <p className="text-sm text-mc-text-muted">This will reset the installation state</p>
              </div>
            </div>
            <p className="mb-4 text-sm text-mc-text-muted">
              You will be redirected to the install wizard to re-configure mail services.
              Existing configurations will not be deleted, but may be overwritten during re-installation.
            </p>
            {reinstallError && <p className="mb-4 text-sm text-mc-danger">{reinstallError}</p>}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowReinstallConfirm(false)}
                className="w-fit rounded-lg px-4 py-2 text-sm font-medium text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setReinstallError("");
                  resetInstall.mutate(undefined, {
                    onSuccess: () => {
                      setShowReinstallConfirm(false);
                      router.push("/install");
                    },
                    onError: (err) => {
                      setReinstallError(err instanceof Error ? err.message : "Failed to reset install state");
                    },
                  });
                }}
                disabled={resetInstall.isPending}
                className={cn(
                  "flex w-fit items-center gap-2 rounded-lg bg-mc-warning px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-warning/90",
                  resetInstall.isPending && "opacity-70 cursor-not-allowed"
                )}
              >
                {resetInstall.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                {resetInstall.isPending ? "Resetting..." : "Proceed with Re-install"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Factory Reset Confirmation Modal */}
      {showFactoryResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => {
            if (!factoryReset.isPending && !factoryResetDone) {
              setShowFactoryResetConfirm(false);
              setFactoryResetConfirmText("");
              setFactoryResetError("");
            }
          }}
        >
          <div className="mx-4 w-full max-w-md rounded-xl bg-mc-surface-solid p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {factoryResetDone ? (
              <div className="text-center py-4">
                <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-mc-accent" />
                <h3 className="text-lg font-semibold text-mc-text">Restarting Service</h3>
                <p className="mt-2 text-sm text-mc-text-muted">{factoryResetStatus}</p>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mc-danger/10">
                    <AlertTriangle className="h-5 w-5 text-mc-danger" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-mc-text">Factory Reset</h3>
                    <p className="text-sm text-mc-text-muted">This action is irreversible</p>
                  </div>
                </div>
                <div className="mb-4 space-y-2 text-sm text-mc-text-muted">
                  <p>This will permanently destroy:</p>
                  <ul className="ml-4 list-disc space-y-1">
                    <li>All mail domains, users, and aliases</li>
                    <li>All dashboard accounts and audit logs</li>
                    <li>All configuration and session data</li>
                  </ul>
                  <p>
                    The service will restart and you will be redirected to the setup wizard.
                  </p>
                </div>
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-mc-text">
                    Type <span className="font-mono font-bold text-mc-danger">FACTORY RESET</span> to confirm
                  </label>
                  <input
                    type="text"
                    value={factoryResetConfirmText}
                    onChange={(e) => setFactoryResetConfirmText(e.target.value)}
                    placeholder="FACTORY RESET"
                    autoComplete="off"
                    className="w-full rounded-lg bg-mc-bg px-4 py-2.5 font-mono text-sm text-mc-text placeholder:text-mc-text-muted/40 focus:outline-none focus:ring-1 focus:ring-mc-danger/50"
                  />
                </div>
                {factoryResetError && <p className="mb-4 text-sm text-mc-danger">{factoryResetError}</p>}
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => {
                      setShowFactoryResetConfirm(false);
                      setFactoryResetConfirmText("");
                      setFactoryResetError("");
                    }}
                    disabled={factoryReset.isPending}
                    className={cn(
                      "w-fit rounded-lg px-4 py-2 text-sm font-medium text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text",
                      factoryReset.isPending && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setFactoryResetError("");
                      factoryReset.mutate(undefined, {
                        onSuccess: () => {
                          setFactoryResetDone(true);
                          setFactoryResetStatus("Waiting for service restart...");

                          // Simple polling: config is deleted and cache invalidated, so
                          // /api/welcome/status returns { state: "UNCONFIGURED" } with 200 OK
                          // regardless of whether the old or new process handles the request.
                          // Just wait for a 200 response, then redirect.
                          let attempt = 0;

                          function poll() {
                            if (!mountedRef.current) return;

                            if (attempt > 60) {
                              // Timeout: switch from spinner back to form state so user sees the error
                              // and can close the modal manually or navigate to /welcome
                              setFactoryResetDone(false);
                              setFactoryResetConfirmText("");
                              setFactoryResetError("Service did not restart within 60 seconds. The reset was successful — navigate to /welcome to continue setup.");
                              return;
                            }
                            attempt++;
                            setFactoryResetStatus(`Waiting for service restart... (${attempt})`);

                            fetch("/api/welcome/status")
                              .then((r) => {
                                if (!mountedRef.current) return;
                                if (r.ok) {
                                  setFactoryResetStatus("Redirecting to setup wizard...");
                                  window.location.href = "/welcome";
                                } else {
                                  pollTimerRef.current = setTimeout(poll, 1000);
                                }
                              })
                              .catch(() => {
                                if (!mountedRef.current) return;
                                // Connection refused — service is restarting, keep trying
                                pollTimerRef.current = setTimeout(poll, 1000);
                              });
                          }

                          // Give the service 2s before starting to poll
                          pollTimerRef.current = setTimeout(poll, 2000);
                        },
                        onError: (err) => {
                          setFactoryResetError(err instanceof Error ? err.message : "Factory reset failed");
                        },
                      });
                    }}
                    disabled={factoryResetConfirmText !== "FACTORY RESET" || factoryReset.isPending}
                    className={cn(
                      "flex w-fit items-center gap-2 rounded-lg bg-mc-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-danger/90",
                      (factoryResetConfirmText !== "FACTORY RESET" || factoryReset.isPending) && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    {factoryReset.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    {factoryReset.isPending ? "Resetting..." : "Erase Everything"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
