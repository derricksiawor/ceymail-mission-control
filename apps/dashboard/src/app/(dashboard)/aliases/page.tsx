"use client";

import { useState, useEffect, useCallback } from "react";
import { Mail, Plus, Trash2, Search, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAliases, useCreateAlias, useDeleteAlias } from "@/lib/hooks/use-aliases";
import { useDomains } from "@/lib/hooks/use-domains";
import type { Alias } from "@/lib/hooks/use-aliases";

export default function AliasesPage() {
  const { data: aliases = [], isLoading } = useAliases();
  const { data: domainsList = [] } = useDomains();
  const createAlias = useCreateAlias();
  const deleteAlias = useDeleteAlias();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<Alias | null>(null);
  const [search, setSearch] = useState("");
  const [filterDomain, setFilterDomain] = useState<string>("all");

  // Add alias form
  const [newSourceUser, setNewSourceUser] = useState("");
  const [newSourceDomainId, setNewSourceDomainId] = useState<number>(0);
  const [newDestination, setNewDestination] = useState("");
  const [addError, setAddError] = useState("");

  const closeDialogs = useCallback(() => {
    setShowAddDialog(false);
    setShowDeleteDialog(null);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialogs();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeDialogs]);

  const emailRegex = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  const resetAddForm = () => {
    setNewSourceUser("");
    setNewSourceDomainId(domainsList.length > 0 ? domainsList[0].id : 0);
    setNewDestination("");
    setAddError("");
  };

  const handleAddAlias = () => {
    setAddError("");
    const trimmedUser = newSourceUser.trim().toLowerCase();
    const trimmedDest = newDestination.trim().toLowerCase();

    if (!trimmedUser) {
      setAddError("Source address is required");
      return;
    }
    if (!/^[a-zA-Z0-9._+-]+$/.test(trimmedUser)) {
      setAddError("Invalid source username format");
      return;
    }
    if (!newSourceDomainId) {
      setAddError("Please select a domain");
      return;
    }
    if (!trimmedDest) {
      setAddError("Destination email is required");
      return;
    }
    if (!emailRegex.test(trimmedDest)) {
      setAddError("Invalid destination email format");
      return;
    }

    const selectedDomain = domainsList.find((d) => d.id === newSourceDomainId);
    if (!selectedDomain) {
      setAddError("Invalid domain selected");
      return;
    }
    const sourceEmail = `${trimmedUser}@${selectedDomain.name}`;
    if (sourceEmail === trimmedDest) {
      setAddError("Source and destination cannot be the same");
      return;
    }

    createAlias.mutate(
      { source: sourceEmail, destination: trimmedDest, domain_id: newSourceDomainId },
      {
        onSuccess: () => {
          setShowAddDialog(false);
          resetAddForm();
        },
        onError: (err) => {
          setAddError(err.message);
        },
      }
    );
  };

  const [deleteError, setDeleteError] = useState("");

  const handleDeleteAlias = () => {
    if (showDeleteDialog) {
      setDeleteError("");
      deleteAlias.mutate(showDeleteDialog.id, {
        onSuccess: () => {
          setShowDeleteDialog(null);
        },
        onError: (err) => {
          setDeleteError(err.message);
        },
      });
    }
  };

  const filtered = aliases
    .filter((a) => {
      const domainName = a.domain_name ?? "";
      if (filterDomain !== "all" && domainName !== filterDomain) return false;
      if (search) {
        const q = search.toLowerCase();
        return a.source.toLowerCase().includes(q) || a.destination.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => a.source.localeCompare(b.source));

  const uniqueDomains = [...new Set(aliases.map((a) => a.domain_name).filter(Boolean))] as string[];

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-mc-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-mc-text">Aliases</h1>
          <p className="text-sm text-mc-text-muted">Manage email aliases and forwarding rules</p>
        </div>
        <button
          onClick={() => {
            setShowAddDialog(true);
            resetAddForm();
          }}
          className="flex items-center gap-2 rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover"
        >
          <Plus className="h-4 w-4" />
          Add Alias
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-accent/10">
              <Mail className="h-5 w-5 text-mc-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{aliases.length}</p>
              <p className="text-xs text-mc-text-muted">Total Aliases</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-success/10">
              <Mail className="h-5 w-5 text-mc-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{aliases.length}</p>
              <p className="text-xs text-mc-text-muted">Active</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-info/10">
              <ArrowRight className="h-5 w-5 text-mc-info" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">
                {new Set(aliases.map((a) => a.destination)).size}
              </p>
              <p className="text-xs text-mc-text-muted">Unique Destinations</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search aliases..."
            className="w-full rounded-lg border border-mc-border bg-mc-surface py-2 pl-10 pr-4 text-sm text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
          />
        </div>
        <select
          value={filterDomain}
          onChange={(e) => setFilterDomain(e.target.value)}
          className="rounded-lg border border-mc-border bg-mc-surface px-4 py-2 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
        >
          <option value="all">All Domains</option>
          {uniqueDomains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {/* Add Alias Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAddDialog(false)}>
          <div className="mx-4 w-full max-w-2xl glass-subtle overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-text">Add New Alias</h2>
            <p className="mt-1 text-sm text-mc-text-muted">
              Create a forwarding rule from a source address to a destination.
            </p>

            <div className="mt-5 space-y-4">
              {/* Source Email */}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                  Source Address
                </label>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <input
                    type="text"
                    value={newSourceUser}
                    onChange={(e) => {
                      setNewSourceUser(e.target.value);
                      setAddError("");
                    }}
                    placeholder="alias"
                    autoFocus
                    className="w-full min-w-0 rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                  />
                  <span className="text-mc-text-muted">@</span>
                  <select
                    value={newSourceDomainId}
                    onChange={(e) => setNewSourceDomainId(Number(e.target.value))}
                    className="w-full min-w-0 rounded-lg border border-mc-border bg-mc-bg px-3 py-2.5 text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                  >
                    <option value={0}>Select domain</option>
                    {domainsList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Arrow indicator */}
              <div className="flex items-center justify-center">
                <div className="flex items-center gap-2 text-mc-text-muted">
                  <div className="h-px w-8 bg-mc-border" />
                  <ArrowRight className="h-4 w-4" />
                  <div className="h-px w-8 bg-mc-border" />
                </div>
              </div>

              {/* Destination Email */}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                  Destination Email
                </label>
                <input
                  type="email"
                  value={newDestination}
                  onChange={(e) => {
                    setNewDestination(e.target.value);
                    setAddError("");
                  }}
                  placeholder="user@domain.com"
                  className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                />
                <p className="mt-1 text-xs text-mc-text-muted">
                  Can be any email address, including external ones.
                </p>
              </div>
            </div>

            {addError && <p className="mt-3 text-sm text-mc-danger">{addError}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowAddDialog(false)}
                className="rounded-lg border border-mc-border px-4 py-2 text-sm text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={handleAddAlias}
                disabled={createAlias.isPending}
                className="rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover disabled:opacity-50"
              >
                {createAlias.isPending ? "Creating..." : "Create Alias"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Alias Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteDialog(null)}>
          <div className="mx-4 w-full max-w-md glass-subtle overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-danger">Delete Alias</h2>
            <p className="mt-2 text-sm text-mc-text-muted">
              Are you sure you want to delete the alias from{" "}
              <span className="font-semibold text-mc-text">{showDeleteDialog.source}</span>{" "}
              to{" "}
              <span className="font-semibold text-mc-text">{showDeleteDialog.destination}</span>?
            </p>
            {deleteError && <p className="mt-3 text-sm text-mc-danger">{deleteError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => { setShowDeleteDialog(null); setDeleteError(""); }}
                className="rounded-lg border border-mc-border px-4 py-2 text-sm text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAlias}
                disabled={deleteAlias.isPending}
                className="rounded-lg bg-mc-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-danger/80 disabled:opacity-50"
              >
                {deleteAlias.isPending ? "Deleting..." : "Delete Alias"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aliases Table */}
      <div className="glass-subtle overflow-x-auto rounded-xl">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-mc-border">
              <th className="px-6 py-3 text-left text-xs font-medium uppercase text-mc-text-muted">
                Source Email
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase text-mc-text-muted">
                {" "}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase text-mc-text-muted">
                Destination Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase text-mc-text-muted">
                Domain
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase text-mc-text-muted">
                Created
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase text-mc-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-sm text-mc-text-muted">
                  {search || filterDomain !== "all"
                    ? "No aliases match your filters."
                    : "No aliases configured yet."}
                </td>
              </tr>
            ) : (
              filtered.map((alias) => (
                <tr
                  key={alias.id}
                  className="border-b border-mc-border last:border-0 transition-colors hover:bg-mc-surface-hover"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-mc-accent" />
                      <span className="font-medium text-mc-text">
                        {alias.source}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-4 text-center">
                    <ArrowRight className="mx-auto h-4 w-4 text-mc-text-muted" />
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-mc-text">
                      {alias.destination}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="rounded-full bg-mc-accent/10 px-2.5 py-0.5 text-xs font-medium text-mc-accent">
                      {alias.domain_name ?? "--"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-mc-text-muted">
                    {alias.created_at ? new Date(alias.created_at).toLocaleDateString() : "--"}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setShowDeleteDialog(alias)}
                        className="rounded-lg p-2 text-mc-text-muted transition-colors hover:bg-mc-danger/10 hover:text-mc-danger"
                        title="Delete alias"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="text-xs text-mc-text-muted">
        Showing {filtered.length} of {aliases.length} alias(es)
      </div>
    </div>
  );
}
