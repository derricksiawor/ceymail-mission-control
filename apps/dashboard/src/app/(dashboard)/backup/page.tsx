"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Archive, Plus, Trash2, RotateCcw, Download, HardDrive,
  Database, Key, FolderOpen, Settings, Clock, CheckCircle2, Loader2,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { useBackups, useCreateBackup, useDeleteBackup, type Backup } from "@/lib/hooks/use-backups";

interface BackupContents {
  config: boolean;
  database: boolean;
  dkim: boolean;
  mailboxes: boolean;
}

const contentIcons: Record<keyof BackupContents, { icon: typeof Settings; label: string }> = {
  config: { icon: Settings, label: "Config" },
  database: { icon: Database, label: "Database" },
  dkim: { icon: Key, label: "DKIM Keys" },
  mailboxes: { icon: FolderOpen, label: "Mailboxes" },
};

export default function BackupPage() {
  const { data: backups, isLoading, error } = useBackups();
  const createMutation = useCreateBackup();
  const deleteMutation = useDeleteBackup();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState<Backup | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState<Backup | null>(null);
  const [createError, setCreateError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const closeDialogs = useCallback(() => {
    setShowCreateDialog(false);
    setShowRestoreDialog(null);
    setShowDeleteDialog(null);
    setCreateError("");
    setDeleteError("");
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialogs();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeDialogs]);

  // Create backup form
  const [includeConfig, setIncludeConfig] = useState(true);
  const [includeDatabase, setIncludeDatabase] = useState(true);
  const [includeDkim, setIncludeDkim] = useState(true);
  const [includeMailboxes, setIncludeMailboxes] = useState(true);

  const handleCreateBackup = () => {
    if (!includeConfig && !includeDatabase && !includeDkim && !includeMailboxes) return;
    setCreateError("");

    createMutation.mutate(
      {
        config: includeConfig,
        database: includeDatabase,
        dkim: includeDkim,
        mailboxes: includeMailboxes,
      },
      {
        onSuccess: () => setShowCreateDialog(false),
        onError: (err) => {
          setCreateError(err instanceof Error ? err.message : "Failed to create backup");
        },
      }
    );
  };

  const handleDelete = () => {
    if (showDeleteDialog) {
      setDeleteError("");
      deleteMutation.mutate(showDeleteDialog.id, {
        onSuccess: () => setShowDeleteDialog(null),
        onError: (err) => {
          setDeleteError(err instanceof Error ? err.message : "Failed to delete backup");
        },
      });
    }
  };

  const allBackups = backups ?? [];
  const { totalSize, completeCount, latestDate } = useMemo(() => {
    let size = 0, count = 0, latest = "";
    for (const b of allBackups) {
      if (b.status === "complete") {
        size += b.size;
        count++;
        if (!latest) latest = b.date;
      }
    }
    return { totalSize: size, completeCount: count, latestDate: latest || "Never" };
  }, [allBackups]);

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
        <p className="text-sm text-mc-danger">Failed to load backups: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-mc-text">Backups</h1>
          <p className="text-sm text-mc-text-muted">Manage server backups and restore points</p>
        </div>
        <button
          onClick={() => {
            setShowCreateDialog(true);
            setIncludeConfig(true);
            setIncludeDatabase(true);
            setIncludeDkim(true);
            setIncludeMailboxes(true);
          }}
          disabled={createMutation.isPending}
          className={cn(
            "flex items-center gap-2 rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover",
            createMutation.isPending && "cursor-not-allowed opacity-50"
          )}
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {createMutation.isPending ? "Creating..." : "Create Backup"}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-accent/10">
              <Archive className="h-5 w-5 text-mc-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{allBackups.length}</p>
              <p className="text-xs text-mc-text-muted">Total Backups</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-success/10">
              <CheckCircle2 className="h-5 w-5 text-mc-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">
                {completeCount}
              </p>
              <p className="text-xs text-mc-text-muted">Successful</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-info/10">
              <HardDrive className="h-5 w-5 text-mc-info" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{formatBytes(totalSize)}</p>
              <p className="text-xs text-mc-text-muted">Total Size</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-warning/10">
              <Clock className="h-5 w-5 text-mc-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">
                {latestDate}
              </p>
              <p className="text-xs text-mc-text-muted">Latest Backup</p>
            </div>
          </div>
        </div>
      </div>

      {/* Create Backup Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateDialog(false)}>
          <div className="mx-4 w-full max-w-md glass-subtle overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-text">Create Backup</h2>
            <p className="mt-1 text-sm text-mc-text-muted">
              Select what to include in the backup.
            </p>

            <div className="mt-5 space-y-3">
              {([
                { key: "config", state: includeConfig, setter: setIncludeConfig, icon: Settings, label: "Configuration Files", desc: "Postfix, Dovecot, OpenDKIM configs" },
                { key: "database", state: includeDatabase, setter: setIncludeDatabase, icon: Database, label: "Database", desc: "Users, domains, aliases data" },
                { key: "dkim", state: includeDkim, setter: setIncludeDkim, icon: Key, label: "DKIM Keys", desc: "Private and public key pairs" },
                { key: "mailboxes", state: includeMailboxes, setter: setIncludeMailboxes, icon: FolderOpen, label: "Mailboxes", desc: "All user email data (may be large)" },
              ] as const).map((item) => {
                const Icon = item.icon;
                return (
                  <label
                    key={item.key}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
                      item.state
                        ? "border-mc-accent/30 bg-mc-accent/5"
                        : "border-mc-border hover:border-mc-border hover:bg-mc-surface-hover"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={item.state}
                      onChange={(e) => item.setter(e.target.checked)}
                      className="h-4 w-4 rounded border-mc-border bg-mc-bg text-mc-accent accent-mc-accent"
                    />
                    <Icon className={cn("h-5 w-5", item.state ? "text-mc-accent" : "text-mc-text-muted")} />
                    <div>
                      <p className={cn("text-sm font-medium", item.state ? "text-mc-text" : "text-mc-text-muted")}>
                        {item.label}
                      </p>
                      <p className="text-xs text-mc-text-muted">{item.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            {!includeConfig && !includeDatabase && !includeDkim && !includeMailboxes && (
              <p className="mt-3 text-sm text-mc-danger">Select at least one item to backup.</p>
            )}
            {createError && <p className="mt-3 text-sm text-mc-danger">{createError}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowCreateDialog(false)}
                className="rounded-lg border border-mc-border px-4 py-2 text-sm text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBackup}
                disabled={createMutation.isPending || (!includeConfig && !includeDatabase && !includeDkim && !includeMailboxes)}
                className={cn(
                  "rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover",
                  (createMutation.isPending || (!includeConfig && !includeDatabase && !includeDkim && !includeMailboxes)) && "cursor-not-allowed opacity-50"
                )}
              >
                {createMutation.isPending ? "Creating..." : "Start Backup"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Dialog */}
      {showRestoreDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowRestoreDialog(null)}>
          <div className="mx-4 w-full max-w-md glass-subtle overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-text">Backup Details</h2>
            <p className="mt-2 text-sm text-mc-text-muted">
              Backup{" "}
              <span className="font-mono font-semibold text-mc-text">{showRestoreDialog.id}</span>
            </p>
            <div className="mt-3 rounded-lg bg-mc-accent/5 p-3">
              <p className="text-sm text-mc-accent">
                Restore from backup requires CLI access. Download the archive and extract it on the server.
              </p>
            </div>
            <div className="mt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                Backup Contents
              </p>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(showRestoreDialog.contents) as [keyof BackupContents, boolean][])
                  .filter(([, included]) => included)
                  .map(([key]) => {
                    const info = contentIcons[key];
                    const Icon = info.icon;
                    return (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 rounded-full bg-mc-accent/10 px-2.5 py-0.5 text-xs font-medium text-mc-accent"
                      >
                        <Icon className="h-3 w-3" />
                        {info.label}
                      </span>
                    );
                  })}
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowRestoreDialog(null)}
                className="rounded-lg border border-mc-border px-4 py-2 text-sm text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteDialog(null)}>
          <div className="mx-4 w-full max-w-md glass-subtle overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-danger">Delete Backup</h2>
            <p className="mt-2 text-sm text-mc-text-muted">
              Are you sure you want to permanently delete backup{" "}
              <span className="font-mono font-semibold text-mc-text">{showDeleteDialog.id}</span>?
            </p>
            {deleteError && <p className="mt-3 text-sm text-mc-danger">{deleteError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteDialog(null)}
                className="rounded-lg border border-mc-border px-4 py-2 text-sm text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="rounded-lg bg-mc-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-danger/80 disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Backup"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backups List */}
      <div className="space-y-3">
        {allBackups.length === 0 ? (
          <div className="rounded-xl border border-mc-border bg-mc-surface p-12 text-center">
            <Archive className="mx-auto mb-3 h-10 w-10 text-mc-text-muted/30" />
            <p className="text-sm text-mc-text-muted">No backups yet. Create your first backup.</p>
          </div>
        ) : (
          allBackups.map((backup) => (
            <div
              key={backup.id}
              className={cn(
                "rounded-xl border bg-mc-surface transition-colors hover:bg-mc-surface-hover",
                backup.status === "failed" ? "border-mc-danger/30" : "border-mc-border",
                backup.status === "in-progress" && "border-mc-accent/30"
              )}
            >
              <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex items-center gap-4 min-w-0">
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      backup.status === "complete" && "bg-mc-success/10",
                      backup.status === "in-progress" && "bg-mc-accent/10",
                      backup.status === "failed" && "bg-mc-danger/10"
                    )}
                  >
                    {backup.status === "in-progress" ? (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-mc-accent border-t-transparent" />
                    ) : (
                      <Archive
                        className={cn(
                          "h-5 w-5",
                          backup.status === "complete" && "text-mc-success",
                          backup.status === "failed" && "text-mc-danger"
                        )}
                      />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-mono text-sm font-semibold text-mc-text">{backup.id}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          backup.status === "complete" && "bg-mc-success/10 text-mc-success",
                          backup.status === "in-progress" && "bg-mc-accent/10 text-mc-accent",
                          backup.status === "failed" && "bg-mc-danger/10 text-mc-danger"
                        )}
                      >
                        {backup.status === "complete" && "Complete"}
                        {backup.status === "in-progress" && "In Progress"}
                        {backup.status === "failed" && "Failed"}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-xs text-mc-text-muted">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {backup.date} {backup.time}
                      </span>
                      {backup.size > 0 && (
                        <span className="flex items-center gap-1">
                          <HardDrive className="h-3 w-3" />
                          {formatBytes(backup.size)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {/* Contents badges */}
                  <div className="hidden items-center gap-1.5 sm:flex">
                    {(Object.entries(backup.contents) as [keyof BackupContents, boolean][]).map(
                      ([key, included]) => {
                        const info = contentIcons[key];
                        const Icon = info.icon;
                        return (
                          <span
                            key={key}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                              included
                                ? "bg-mc-accent/10 text-mc-accent"
                                : "bg-mc-bg text-mc-text-muted/40"
                            )}
                            title={`${info.label}: ${included ? "Included" : "Not included"}`}
                          >
                            <Icon className="h-3 w-3" />
                          </span>
                        );
                      }
                    )}
                  </div>

                  {/* Actions */}
                  {backup.status === "complete" && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setShowRestoreDialog(backup)}
                        className="flex items-center justify-center rounded-lg p-2 text-mc-text-muted transition-colors hover:bg-mc-warning/10 hover:text-mc-warning min-h-[44px] min-w-[44px]"
                        title="Restore backup"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <a
                        href={`/api/backup/${backup.id}/download`}
                        download
                        className="flex items-center justify-center rounded-lg p-2 text-mc-text-muted transition-colors hover:bg-mc-accent/10 hover:text-mc-accent min-h-[44px] min-w-[44px]"
                        title="Download backup"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() => setShowDeleteDialog(backup)}
                        className="flex items-center justify-center rounded-lg p-2 text-mc-text-muted transition-colors hover:bg-mc-danger/10 hover:text-mc-danger min-h-[44px] min-w-[44px]"
                        title="Delete backup"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  {backup.status === "failed" && (
                    <button
                      onClick={() => setShowDeleteDialog(backup)}
                      className="flex items-center justify-center rounded-lg p-2 text-mc-text-muted transition-colors hover:bg-mc-danger/10 hover:text-mc-danger min-h-[44px] min-w-[44px]"
                      title="Delete backup"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
