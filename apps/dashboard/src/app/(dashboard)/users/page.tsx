"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, Plus, Trash2, KeyRound, Search, Eye, EyeOff, Mail, Globe, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUsers, useCreateUser, useDeleteUser, useChangePassword } from "@/lib/hooks/use-users";
import { useDomains } from "@/lib/hooks/use-domains";
import type { User } from "@/lib/hooks/use-users";

function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score: 1, label: "Weak", color: "bg-mc-danger" };
  if (score <= 3) return { score: 2, label: "Fair", color: "bg-mc-warning" };
  return { score: 3, label: "Strong", color: "bg-mc-success" };
}

export default function UsersPage() {
  const { data: users = [], isLoading } = useUsers();
  const { data: domainsList = [] } = useDomains();
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();
  const changePasswordMutation = useChangePassword();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<User | null>(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState<User | null>(null);
  const [search, setSearch] = useState("");
  const [filterDomain, setFilterDomain] = useState<string>("all");

  // Add user form
  const [newUsername, setNewUsername] = useState("");
  const [newDomainId, setNewDomainId] = useState<number>(0);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [addError, setAddError] = useState("");

  // Change password form
  const [changePassword, setChangePassword] = useState("");
  const [changePasswordConfirm, setChangePasswordConfirm] = useState("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changeError, setChangeError] = useState("");

  // Close any dialog on Escape
  const closeDialogs = useCallback(() => {
    setShowAddDialog(false);
    setShowDeleteDialog(null);
    setShowPasswordDialog(null);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialogs();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeDialogs]);

  const resetAddForm = () => {
    setNewUsername("");
    setNewDomainId(domainsList.length > 0 ? domainsList[0].id : 0);
    setNewPassword("");
    setNewPasswordConfirm("");
    setShowNewPassword(false);
    setAddError("");
  };

  const resetChangeForm = () => {
    setChangePassword("");
    setChangePasswordConfirm("");
    setShowChangePassword(false);
    setChangeError("");
  };

  const handleAddUser = () => {
    setAddError("");
    const trimmedUser = newUsername.trim().toLowerCase();
    if (!trimmedUser) {
      setAddError("Username is required");
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmedUser)) {
      setAddError("Username can only contain letters, numbers, dots, hyphens, and underscores");
      return;
    }
    if (!newDomainId) {
      setAddError("Please select a domain");
      return;
    }
    const selectedDomain = domainsList.find((d) => d.id === newDomainId);
    if (!selectedDomain) {
      setAddError("Invalid domain selected");
      return;
    }
    const fullEmail = `${trimmedUser}@${selectedDomain.name}`;
    if (users.some((u) => u.email === fullEmail)) {
      setAddError("User already exists");
      return;
    }
    if (newPassword.length < 8) {
      setAddError("Password must be at least 8 characters");
      return;
    }
    if (newPassword.length > 128) {
      setAddError("Password must not exceed 128 characters");
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      setAddError("Password must contain uppercase, lowercase, digit, and special character");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setAddError("Passwords do not match");
      return;
    }

    createUser.mutate(
      { email: fullEmail, domain_id: newDomainId, password: newPassword },
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

  const handleDeleteUser = () => {
    if (showDeleteDialog) {
      setDeleteError("");
      deleteUser.mutate(showDeleteDialog.id, {
        onSuccess: () => {
          setShowDeleteDialog(null);
        },
        onError: (err) => {
          setDeleteError(err.message);
        },
      });
    }
  };

  const handleChangePassword = () => {
    setChangeError("");
    if (changePassword.length < 8) {
      setChangeError("Password must be at least 8 characters");
      return;
    }
    if (changePassword.length > 128) {
      setChangeError("Password must not exceed 128 characters");
      return;
    }
    if (!/[A-Z]/.test(changePassword) || !/[a-z]/.test(changePassword) || !/[0-9]/.test(changePassword) || !/[^A-Za-z0-9]/.test(changePassword)) {
      setChangeError("Password must contain uppercase, lowercase, digit, and special character");
      return;
    }
    if (changePassword !== changePasswordConfirm) {
      setChangeError("Passwords do not match");
      return;
    }
    if (!showPasswordDialog) return;
    changePasswordMutation.mutate(
      { user_id: showPasswordDialog.id, new_password: changePassword },
      {
        onSuccess: () => {
          setShowPasswordDialog(null);
          resetChangeForm();
        },
        onError: (err) => {
          setChangeError(err.message);
        },
      }
    );
  };

  const filtered = users
    .filter((u) => {
      const domainName = u.domain_name ?? "";
      if (filterDomain !== "all" && domainName !== filterDomain) return false;
      if (search && !u.email.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => a.email.localeCompare(b.email));

  const uniqueDomains = [...new Set(users.map((u) => u.domain_name).filter(Boolean))] as string[];

  const passwordStrength = getPasswordStrength(newPassword);
  const changePasswordStrength = getPasswordStrength(changePassword);

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
          <h1 className="text-2xl font-bold text-mc-text">Users</h1>
          <p className="text-sm text-mc-text-muted">Manage mailbox users and accounts</p>
        </div>
        <button
          onClick={() => {
            setShowAddDialog(true);
            resetAddForm();
          }}
          className="flex items-center gap-2 rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover"
        >
          <Plus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-accent/10">
              <Users className="h-5 w-5 text-mc-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{users.length}</p>
              <p className="text-xs text-mc-text-muted">Total Users</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-info/10">
              <Globe className="h-5 w-5 text-mc-info" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{uniqueDomains.length}</p>
              <p className="text-xs text-mc-text-muted">Domains</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-success/10">
              <Mail className="h-5 w-5 text-mc-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{users.length}</p>
              <p className="text-xs text-mc-text-muted">Mailboxes</p>
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
            placeholder="Search users..."
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

      {/* Add User Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAddDialog(false)}>
          <div className="mx-4 w-full max-w-2xl glass-subtle overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-text">Add New User</h2>
            <p className="mt-1 text-sm text-mc-text-muted">Create a new mailbox user account.</p>

            <div className="mt-5 space-y-4">
              {/* Email */}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                  Email Address
                </label>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => {
                      setNewUsername(e.target.value);
                      setAddError("");
                    }}
                    placeholder="username"
                    autoFocus
                    className="w-full min-w-0 rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                  />
                  <span className="text-mc-text-muted">@</span>
                  <select
                    value={newDomainId}
                    onChange={(e) => setNewDomainId(Number(e.target.value))}
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

              {/* Password */}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setAddError("");
                    }}
                    placeholder="Minimum 8 characters"
                    className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 pr-10 text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-mc-text-muted hover:text-mc-text"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {/* Password strength indicator */}
                {newPassword && (
                  <div className="mt-2">
                    <div className="flex gap-1">
                      {[1, 2, 3].map((level) => (
                        <div
                          key={level}
                          className={cn(
                            "h-1.5 flex-1 rounded-full",
                            level <= passwordStrength.score ? passwordStrength.color : "bg-mc-border"
                          )}
                        />
                      ))}
                    </div>
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        passwordStrength.score === 1 && "text-mc-danger",
                        passwordStrength.score === 2 && "text-mc-warning",
                        passwordStrength.score === 3 && "text-mc-success"
                      )}
                    >
                      {passwordStrength.label}
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                  Confirm Password
                </label>
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={newPasswordConfirm}
                  onChange={(e) => {
                    setNewPasswordConfirm(e.target.value);
                    setAddError("");
                  }}
                  placeholder="Re-enter password"
                  className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                />
                {newPasswordConfirm && newPassword !== newPasswordConfirm && (
                  <p className="mt-1 text-xs text-mc-danger">Passwords do not match</p>
                )}
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
                onClick={handleAddUser}
                disabled={createUser.isPending}
                className="rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover disabled:opacity-50"
              >
                {createUser.isPending ? "Creating..." : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Dialog */}
      {showPasswordDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setShowPasswordDialog(null); resetChangeForm(); }}>
          <div className="mx-4 w-full max-w-md glass-subtle overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-text">Change Password</h2>
            <p className="mt-1 text-sm text-mc-text-muted">
              Set a new password for{" "}
              <span className="font-medium text-mc-text">{showPasswordDialog.email}</span>
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showChangePassword ? "text" : "password"}
                    value={changePassword}
                    onChange={(e) => {
                      setChangePassword(e.target.value);
                      setChangeError("");
                    }}
                    placeholder="Minimum 8 characters"
                    autoFocus
                    className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 pr-10 text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowChangePassword(!showChangePassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-mc-text-muted hover:text-mc-text"
                  >
                    {showChangePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {changePassword && (
                  <div className="mt-2">
                    <div className="flex gap-1">
                      {[1, 2, 3].map((level) => (
                        <div
                          key={level}
                          className={cn(
                            "h-1.5 flex-1 rounded-full",
                            level <= changePasswordStrength.score ? changePasswordStrength.color : "bg-mc-border"
                          )}
                        />
                      ))}
                    </div>
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        changePasswordStrength.score === 1 && "text-mc-danger",
                        changePasswordStrength.score === 2 && "text-mc-warning",
                        changePasswordStrength.score === 3 && "text-mc-success"
                      )}
                    >
                      {changePasswordStrength.label}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                  Confirm New Password
                </label>
                <input
                  type={showChangePassword ? "text" : "password"}
                  value={changePasswordConfirm}
                  onChange={(e) => {
                    setChangePasswordConfirm(e.target.value);
                    setChangeError("");
                  }}
                  placeholder="Re-enter password"
                  className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
                />
                {changePasswordConfirm && changePassword !== changePasswordConfirm && (
                  <p className="mt-1 text-xs text-mc-danger">Passwords do not match</p>
                )}
              </div>
            </div>

            {changeError && <p className="mt-3 text-sm text-mc-danger">{changeError}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowPasswordDialog(null);
                  resetChangeForm();
                }}
                className="rounded-lg border border-mc-border px-4 py-2 text-sm text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                disabled={changePasswordMutation.isPending}
                className="rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover disabled:opacity-50"
              >
                {changePasswordMutation.isPending ? "Updating..." : "Update Password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteDialog(null)}>
          <div className="mx-4 w-full max-w-md glass-subtle overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-danger">Delete User</h2>
            <p className="mt-2 text-sm text-mc-text-muted">
              Are you sure you want to delete{" "}
              <span className="font-semibold text-mc-text">{showDeleteDialog.email}</span>?
            </p>
            <div className="mt-3 rounded-lg border border-mc-danger/20 bg-mc-danger/5 p-3">
              <p className="text-sm text-mc-danger">
                This will permanently remove the mailbox and all associated emails.
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
                onClick={handleDeleteUser}
                disabled={deleteUser.isPending}
                className="rounded-lg bg-mc-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-danger/80 disabled:opacity-50"
              >
                {deleteUser.isPending ? "Deleting..." : "Delete User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="glass-subtle overflow-x-auto rounded-xl">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b border-mc-border">
              <th className="px-6 py-3 text-left text-xs font-medium uppercase text-mc-text-muted">
                Email
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
                <td colSpan={4} className="px-6 py-12 text-center text-sm text-mc-text-muted">
                  {search || filterDomain !== "all"
                    ? "No users match your filters."
                    : "No users configured yet."}
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-mc-border last:border-0 transition-colors hover:bg-mc-surface-hover"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-mc-accent" />
                      <span className="font-medium text-mc-text">{user.email}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="rounded-full bg-mc-accent/10 px-2.5 py-0.5 text-xs font-medium text-mc-accent">
                      {user.domain_name ?? "--"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-mc-text-muted">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : "--"}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => {
                          setShowPasswordDialog(user);
                          resetChangeForm();
                        }}
                        className="rounded-lg p-2 text-mc-text-muted transition-colors hover:bg-mc-accent/10 hover:text-mc-accent"
                        title="Change password"
                      >
                        <KeyRound className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setShowDeleteDialog(user)}
                        className="rounded-lg p-2 text-mc-text-muted transition-colors hover:bg-mc-danger/10 hover:text-mc-danger"
                        title="Delete user"
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
        Showing {filtered.length} of {users.length} user(s)
      </div>
    </div>
  );
}
