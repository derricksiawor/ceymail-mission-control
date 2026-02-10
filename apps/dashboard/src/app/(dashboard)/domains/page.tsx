"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Globe, Plus, Trash2, Shield, Users, Search, ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { useDomains, useCreateDomain, useDeleteDomain } from "@/lib/hooks/use-domains";
import type { Domain } from "@/lib/hooks/use-domains";
import { useUsers } from "@/lib/hooks/use-users";
import { useDkimKeys } from "@/lib/hooks/use-dkim";

const DOMAIN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

type SortField = "name" | "createdAt";
type SortDir = "asc" | "desc";

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (sortField !== field) return null;
  return sortDir === "asc" ? (
    <ChevronUp className="h-3 w-3" />
  ) : (
    <ChevronDown className="h-3 w-3" />
  );
}

export default function DomainsPage() {
  const { data: domains = [], isLoading } = useDomains();
  const { data: users = [] } = useUsers();
  const { data: dkimKeys = [] } = useDkimKeys();
  const createDomain = useCreateDomain();
  const deleteDomain = useDeleteDomain();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<Domain | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Close any dialog on Escape
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

  const handleAddDomain = () => {
    setError("");
    const trimmed = newDomain.trim().toLowerCase();
    if (!trimmed) {
      setError("Domain name is required");
      return;
    }
    if (!DOMAIN_REGEX.test(trimmed)) {
      setError("Invalid domain format (e.g. example.com)");
      return;
    }
    if (domains.some((d) => d.name === trimmed)) {
      setError("Domain already exists");
      return;
    }
    createDomain.mutate(trimmed, {
      onSuccess: () => {
        setNewDomain("");
        setShowAddDialog(false);
      },
      onError: (err) => {
        setError(err.message);
      },
    });
  };

  const handleDelete = () => {
    if (showDeleteDialog) {
      setDeleteError("");
      deleteDomain.mutate(showDeleteDialog.id, {
        onSuccess: () => {
          setShowDeleteDialog(null);
        },
        onError: (err) => {
          setDeleteError(err.message);
        },
      });
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const activeDkimCount = useMemo(
    () => dkimKeys.filter((k) => k.status === "active").length,
    [dkimKeys]
  );

  const filtered = useMemo(() =>
    domains
      .filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        if (sortField === "name") return a.name.localeCompare(b.name) * dir;
        if (sortField === "createdAt") return (a.created_at ?? "").localeCompare(b.created_at ?? "") * dir;
        return 0;
      }),
    [domains, search, sortField, sortDir]
  );

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
          <h1 className="text-2xl font-bold text-mc-text">Domains</h1>
          <p className="text-sm text-mc-text-muted">Manage virtual mail domains</p>
        </div>
        <button
          onClick={() => {
            setShowAddDialog(true);
            setError("");
            setNewDomain("");
          }}
          className="flex items-center gap-2 rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover"
        >
          <Plus className="h-4 w-4" />
          Add Domain
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-accent/10">
              <Globe className="h-5 w-5 text-mc-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{domains.length}</p>
              <p className="text-xs text-mc-text-muted">Total Domains</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-success/10">
              <Shield className="h-5 w-5 text-mc-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{activeDkimCount}</p>
              <p className="text-xs text-mc-text-muted">DKIM Active</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-warning/10">
              <Users className="h-5 w-5 text-mc-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{users.length}</p>
              <p className="text-xs text-mc-text-muted">Total Users</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search domains..."
          className="w-full rounded-lg border border-mc-border bg-mc-surface py-2 pl-10 pr-4 text-sm text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
        />
      </div>

      {/* Add Domain Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAddDialog(false)}>
          <div className="mx-4 w-full max-w-md bg-mc-surface-solid overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-text">Add New Domain</h2>
            <p className="mt-1 text-sm text-mc-text-muted">
              Enter the domain name you want to manage mail for.
            </p>
            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                Domain Name
              </label>
              <input
                type="text"
                value={newDomain}
                onChange={(e) => {
                  setNewDomain(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleAddDomain()}
                placeholder="example.com"
                autoFocus
                className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
              />
              {error && <p className="mt-2 text-sm text-mc-danger">{error}</p>}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowAddDialog(false)}
                className="rounded-lg border border-mc-border px-4 py-2 text-sm text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={handleAddDomain}
                disabled={createDomain.isPending}
                className="rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover disabled:opacity-50"
              >
                {createDomain.isPending ? "Adding..." : "Add Domain"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteDialog(null)}>
          <div className="mx-4 w-full max-w-md bg-mc-surface-solid overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-danger">Delete Domain</h2>
            <p className="mt-2 text-sm text-mc-text-muted">
              Are you sure you want to delete{" "}
              <span className="font-semibold text-mc-text">{showDeleteDialog.name}</span>?
            </p>
            <div className="mt-3 rounded-lg border border-mc-danger/20 bg-mc-danger/5 p-3">
              <p className="text-sm text-mc-danger">
                Deletion will fail if users or aliases still reference this domain. Remove them first.
              </p>
            </div>
            {deleteError && <p className="mt-3 text-sm text-mc-danger">{deleteError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => { setShowDeleteDialog(null); setDeleteError(""); }}
                className="rounded-lg border border-mc-border px-4 py-2 text-sm text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteDomain.isPending}
                className="rounded-lg bg-mc-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-danger/80 disabled:opacity-50"
              >
                {deleteDomain.isPending ? "Deleting..." : "Delete Domain"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Domains Table */}
      <div className="glass-subtle overflow-x-auto rounded-xl">
        <table className="w-full min-w-[500px]">
          <thead>
            <tr className="border-b border-mc-border">
              <th
                className="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase text-mc-text-muted hover:text-mc-text"
                onClick={() => handleSort("name")}
              >
                <div className="flex items-center gap-1">
                  Domain <SortIcon field="name" sortField={sortField} sortDir={sortDir} />
                </div>
              </th>
              <th
                className="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase text-mc-text-muted hover:text-mc-text"
                onClick={() => handleSort("createdAt")}
              >
                <div className="flex items-center gap-1">
                  Created <SortIcon field="createdAt" sortField={sortField} sortDir={sortDir} />
                </div>
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase text-mc-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-12 text-center text-sm text-mc-text-muted">
                  {search ? "No domains match your search." : "No domains configured yet."}
                </td>
              </tr>
            ) : (
              filtered.map((domain) => (
                <tr
                  key={domain.id}
                  className="border-b border-mc-border last:border-0 transition-colors hover:bg-mc-surface-hover"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-mc-accent" />
                      <span className="font-medium text-mc-text">{domain.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-mc-text-muted">
                    {domain.created_at ? new Date(domain.created_at).toLocaleDateString() : "--"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => setShowDeleteDialog(domain)}
                      className="rounded-lg p-2.5 text-mc-text-muted transition-colors hover:bg-mc-danger/10 hover:text-mc-danger min-h-[44px] min-w-[44px] flex items-center justify-center"
                      title="Delete domain"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer info */}
      <div className="text-xs text-mc-text-muted">
        Showing {filtered.length} of {domains.length} domain(s)
      </div>
    </div>
  );
}
