use nix::unistd::{chown, Uid, Gid};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use thiserror::Error;
use tracing::{debug, info, warn};

#[derive(Debug, Error)]
pub enum PermissionError {
    #[error("Failed to set permissions on {path}: {source}")]
    SetPermissions { path: String, source: io::Error },
    #[error("Failed to set ownership on {path}: {source}")]
    SetOwnership { path: String, source: nix::Error },
    #[error("User not found: {0}")]
    UserNotFound(String),
    #[error("Group not found: {0}")]
    GroupNotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

use std::io;

/// A single permission rule in the manifest
#[derive(Debug, Clone)]
pub struct PermissionRule {
    pub path: String,
    pub owner: String,
    pub group: String,
    pub mode: u32,
    pub recursive: bool,
}

/// The complete permission manifest for CeyMail
pub fn default_manifest() -> Vec<PermissionRule> {
    vec![
        // Postfix
        PermissionRule {
            path: "/etc/postfix".into(),
            owner: "root".into(),
            group: "root".into(),
            mode: 0o755,
            recursive: true,
        },
        PermissionRule {
            path: "/var/lib/postfix".into(),
            owner: "postfix".into(),
            group: "postfix".into(),
            mode: 0o755, // NOT 600 - that breaks postfix
            recursive: false,
        },
        PermissionRule {
            path: "/var/spool/postfix/opendkim".into(),
            owner: "opendkim".into(),
            group: "postfix".into(),
            mode: 0o750,
            recursive: false,
        },
        // Dovecot
        PermissionRule {
            path: "/etc/dovecot".into(),
            owner: "vmail".into(),
            group: "dovecot".into(),
            mode: 0o751,
            recursive: true,
        },
        PermissionRule {
            path: "/etc/dovecot/sieve".into(),
            owner: "mail".into(),
            group: "mail".into(),
            mode: 0o755,
            recursive: true,
        },
        // Virtual mail
        PermissionRule {
            path: "/var/mail/vhosts".into(),
            owner: "vmail".into(),
            group: "vmail".into(),
            mode: 0o755,
            recursive: true,
        },
        // OpenDKIM
        PermissionRule {
            path: "/etc/opendkim".into(),
            owner: "opendkim".into(),
            group: "opendkim".into(),
            mode: 0o755,
            recursive: true,
        },
        PermissionRule {
            path: "/etc/mail/dkim-keys".into(),
            owner: "opendkim".into(),
            group: "opendkim".into(),
            mode: 0o700,
            recursive: true,
        },
        // Web
        PermissionRule {
            path: "/var/www/html".into(),
            owner: "www-data".into(),
            group: "www-data".into(),
            mode: 0o755,
            recursive: true,
        },
        // SpamAssassin
        PermissionRule {
            path: "/var/log/spamassassin".into(),
            owner: "spamd".into(),
            group: "spamd".into(),
            mode: 0o755,
            recursive: true,
        },
    ]
}

/// Resolve a username to a UID
fn resolve_uid(username: &str) -> Result<Uid, PermissionError> {
    nix::unistd::User::from_name(username)
        .map_err(|_| PermissionError::UserNotFound(username.to_string()))?
        .map(|u| u.uid)
        .ok_or_else(|| PermissionError::UserNotFound(username.to_string()))
}

/// Resolve a group name to a GID
fn resolve_gid(groupname: &str) -> Result<Gid, PermissionError> {
    nix::unistd::Group::from_name(groupname)
        .map_err(|_| PermissionError::GroupNotFound(groupname.to_string()))?
        .map(|g| g.gid)
        .ok_or_else(|| PermissionError::GroupNotFound(groupname.to_string()))
}

/// Apply a single permission rule
pub fn apply_rule(rule: &PermissionRule) -> Result<(), PermissionError> {
    let path = Path::new(&rule.path);
    if !path.exists() {
        warn!("Path does not exist, skipping: {}", rule.path);
        return Ok(());
    }

    let uid = resolve_uid(&rule.owner)?;
    let gid = resolve_gid(&rule.group)?;

    if rule.recursive && path.is_dir() {
        apply_recursive(path, uid, gid, rule.mode)?;
    } else {
        apply_single(path, uid, gid, rule.mode)?;
    }

    info!("Applied permissions: {} {}:{} {:o}", rule.path, rule.owner, rule.group, rule.mode);
    Ok(())
}

fn apply_single(path: &Path, uid: Uid, gid: Gid, mode: u32) -> Result<(), PermissionError> {
    chown(path, Some(uid), Some(gid)).map_err(|e| PermissionError::SetOwnership {
        path: path.display().to_string(),
        source: e,
    })?;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|e| {
        PermissionError::SetPermissions {
            path: path.display().to_string(),
            source: e,
        }
    })?;
    Ok(())
}

fn apply_recursive(path: &Path, uid: Uid, gid: Gid, mode: u32) -> Result<(), PermissionError> {
    apply_single(path, uid, gid, mode)?;
    if path.is_dir() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();
            if entry_path.is_dir() {
                apply_recursive(&entry_path, uid, gid, mode)?;
            } else {
                apply_single(&entry_path, uid, gid, mode)?;
            }
        }
    }
    Ok(())
}

/// Apply all rules from the default manifest. Returns a list of errors (non-fatal).
pub fn apply_all_permissions() -> Vec<PermissionError> {
    let manifest = default_manifest();
    let mut errors = Vec::new();
    for rule in &manifest {
        if let Err(e) = apply_rule(rule) {
            warn!("Failed to apply permission rule for {}: {}", rule.path, e);
            errors.push(e);
        }
    }
    errors
}

/// Required group memberships
pub struct GroupMembership {
    pub user: String,
    pub group: String,
}

pub fn required_group_memberships() -> Vec<GroupMembership> {
    vec![
        GroupMembership { user: "postfix".into(), group: "opendkim".into() },
        GroupMembership { user: "vmail".into(), group: "dovecot".into() },
        GroupMembership { user: "vmail".into(), group: "mail".into() },
    ]
}
