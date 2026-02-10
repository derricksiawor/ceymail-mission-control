"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Key, Shield, Copy, Check, Trash2, RefreshCw, Globe, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDkimKeys, useGenerateDkim, useDeleteDkim, type DkimKey } from "@/lib/hooks/use-dkim";

const STATUS_CONFIG = {
  active: { label: "Active", color: "text-mc-success", bg: "bg-mc-success/10", icon: Shield },
  pending: { label: "Pending DNS", color: "text-mc-warning", bg: "bg-mc-warning/10", icon: AlertTriangle },
  missing: { label: "Not Configured", color: "text-mc-text-muted", bg: "bg-mc-text-muted/10", icon: Key },
} as const;

export default function DkimPage() {
  const { data: dkimKeys, isLoading, error } = useDkimKeys();
  const generateMutation = useGenerateDkim();
  const deleteMutation = useDeleteDkim();

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState<DkimKey | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const closeDialogs = useCallback(() => {
    setShowDeleteDialog(null);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialogs();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeDialogs]);

  const handleCopyDns = async (key: DkimKey) => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    const fullRecord = `${key.selector}._domainkey.${key.domain} IN TXT "${key.dnsRecord}"`;
    try {
      await navigator.clipboard.writeText(fullRecord);
      setCopiedId(key.id);
      copyTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard API unavailable (e.g. non-HTTPS or permissions denied)
    }
  };

  const handleGenerate = (domain: string) => {
    setGenerateError(null);
    generateMutation.mutate({ domain }, {
      onError: (err) => {
        setGenerateError(err instanceof Error ? err.message : "Failed to generate DKIM key");
      },
    });
  };

  const handleDelete = () => {
    if (showDeleteDialog) {
      setDeleteError("");
      deleteMutation.mutate(showDeleteDialog.domain, {
        onSuccess: () => {
          setShowDeleteDialog(null);
          setDeleteError("");
        },
        onError: (err) => {
          setDeleteError(err instanceof Error ? err.message : "Failed to delete DKIM key");
        },
      });
    }
  };

  const keys = dkimKeys ?? [];
  const { activeCount, pendingCount, missingCount } = useMemo(() => {
    let active = 0, pending = 0, missing = 0;
    for (const k of keys) {
      if (k.status === "active") active++;
      else if (k.status === "pending") pending++;
      else if (k.status === "missing") missing++;
    }
    return { activeCount: active, pendingCount: pending, missingCount: missing };
  }, [keys]);

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
        <p className="text-sm text-mc-danger">Failed to load DKIM keys: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-mc-text">DKIM Keys</h1>
          <p className="text-sm text-mc-text-muted">Manage DKIM signing keys and DNS records</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-success/10">
              <Shield className="h-5 w-5 text-mc-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{activeCount}</p>
              <p className="text-xs text-mc-text-muted">Active</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-warning/10">
              <AlertTriangle className="h-5 w-5 text-mc-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{pendingCount}</p>
              <p className="text-xs text-mc-text-muted">Pending DNS</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-text-muted/10">
              <Key className="h-5 w-5 text-mc-text-muted" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{missingCount}</p>
              <p className="text-xs text-mc-text-muted">Not Configured</p>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteDialog(null)}>
          <div className="mx-4 w-full max-w-md bg-mc-surface-solid overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-danger">Delete DKIM Key</h2>
            <p className="mt-2 text-sm text-mc-text-muted">
              Are you sure you want to delete the DKIM key for{" "}
              <span className="font-semibold text-mc-text">{showDeleteDialog.domain}</span>?
            </p>
            <div className="mt-3 rounded-lg border border-mc-danger/20 bg-mc-danger/5 p-3">
              <p className="text-sm text-mc-danger">
                Emails sent from this domain will no longer be DKIM-signed, which may affect
                deliverability.
              </p>
            </div>
            {deleteError && (
              <div className="mt-3 rounded-lg border border-mc-danger/20 bg-mc-danger/5 p-3">
                <p className="text-sm text-mc-danger">{deleteError}</p>
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => { setShowDeleteDialog(null); setDeleteError(""); }}
                className="rounded-lg border border-mc-border px-4 py-2 text-sm text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="rounded-lg bg-mc-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-danger/80 disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Key"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {keys.length === 0 && (
        <div className="rounded-xl border border-mc-border bg-mc-surface p-12 text-center">
          <Key className="mx-auto mb-3 h-10 w-10 text-mc-text-muted/30" />
          <p className="text-sm text-mc-text-muted">No domains found. Add domains first to manage DKIM keys.</p>
        </div>
      )}

      {/* DKIM Key Cards */}
      <div className="space-y-4">
        {keys.map((key) => {
          const config = STATUS_CONFIG[key.status];
          const StatusIcon = config.icon;
          const isGenerating = generateMutation.isPending && generateMutation.variables?.domain === key.domain;

          return (
            <div
              key={key.id}
              className="glass-subtle overflow-hidden rounded-xl"
            >
              {/* Card Header */}
              <div className="flex flex-col gap-3 border-b border-mc-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex items-center gap-3 min-w-0">
                  <Globe className="h-5 w-5 shrink-0 text-mc-accent" />
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-mc-text">{key.domain}</h3>
                    <p className="truncate text-xs text-mc-text-muted">
                      Selector: <span className="font-mono text-mc-text">{key.selector}</span>
                      {key.keySize > 0 && (
                        <>
                          {" "} | Key Size: <span className="font-mono text-mc-text">{key.keySize}-bit</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center">
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                      config.bg,
                      config.color
                    )}
                  >
                    <StatusIcon className="h-3.5 w-3.5" />
                    {config.label}
                  </span>
                </div>
              </div>

              {/* Card Body */}
              <div className="px-4 py-4 sm:px-6">
                {key.status === "missing" ? (
                  <div className="flex flex-col items-center justify-center py-6">
                    <Key className="mb-3 h-10 w-10 text-mc-text-muted/30" />
                    <p className="mb-1 text-sm text-mc-text-muted">No DKIM key configured for this domain</p>
                    <p className="mb-4 text-xs text-mc-text-muted">
                      Generate a key to enable DKIM signing for outgoing emails.
                    </p>
                    <button
                      onClick={() => handleGenerate(key.domain)}
                      disabled={isGenerating}
                      className={cn(
                        "flex items-center gap-2 rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover",
                        isGenerating && "cursor-not-allowed opacity-50"
                      )}
                    >
                      {isGenerating ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Key className="h-4 w-4" />
                          Generate DKIM Key
                        </>
                      )}
                    </button>
                    {generateError && (
                      <p className="mt-3 text-sm text-mc-danger">{generateError}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* DNS Record */}
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <label className="text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                          DNS TXT Record
                        </label>
                        <button
                          onClick={() => handleCopyDns(key)}
                          className="flex items-center gap-1.5 rounded-md bg-mc-accent/5 px-3 py-2 text-xs text-mc-text-muted transition-colors hover:bg-mc-accent/10 hover:text-mc-accent min-h-[44px]"
                        >
                          {copiedId === key.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-mc-success" />
                              <span className="text-mc-success">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                      <div className="rounded-lg border border-mc-border bg-mc-bg p-4">
                        <p className="mb-1 text-xs text-mc-text-muted">Record Name:</p>
                        <code className="block break-all font-mono text-xs text-mc-accent">
                          {key.selector}._domainkey.{key.domain}
                        </code>
                        <p className="mb-1 mt-3 text-xs text-mc-text-muted">Record Value:</p>
                        <code className="block break-all font-mono text-xs text-mc-text">
                          {key.dnsRecord}
                        </code>
                      </div>
                    </div>

                    {/* Info row */}
                    {key.createdAt && (
                      <div className="flex items-center justify-between text-xs text-mc-text-muted">
                        <span>Created: {key.createdAt}</span>
                      </div>
                    )}

                    {key.status === "pending" && (
                      <div className="rounded-lg border border-mc-warning/20 bg-mc-warning/5 p-3">
                        <p className="text-xs text-mc-warning">
                          Add the DNS TXT record above to your domain&apos;s DNS configuration.
                          DKIM signing will activate once the DNS record is verified.
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 border-t border-mc-border pt-4">
                      <button
                        onClick={() => handleGenerate(key.domain)}
                        disabled={isGenerating}
                        className={cn(
                          "flex min-h-[44px] items-center gap-1.5 rounded-lg bg-mc-accent/10 px-3 py-2 text-xs font-medium text-mc-accent transition-colors hover:bg-mc-accent/20",
                          isGenerating && "cursor-not-allowed opacity-50"
                        )}
                      >
                        {isGenerating ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Regenerate
                      </button>
                      <button
                        onClick={() => setShowDeleteDialog(key)}
                        className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-mc-danger/10 px-3 py-2 text-xs font-medium text-mc-danger transition-colors hover:bg-mc-danger/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
