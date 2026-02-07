use std::process::Command;
use thiserror::Error;
use tracing::{info, debug};

#[derive(Debug, Error)]
pub enum PackageError {
    #[error("Package install failed: {0}")]
    InstallFailed(String),
    #[error("Command error: {0}")]
    CommandError(#[from] std::io::Error),
}

/// Core packages required for a complete CeyMail mail server installation.
/// These are installed via `apt-get` on Debian/Ubuntu systems.
pub const CORE_PACKAGES: &[&str] = &[
    "apache2",
    "certbot",
    "python3-certbot-apache",
    "wget",
    "unzip",
    "curl",
    "spamassassin",
    "spamc",
    "mariadb-server",
    "postfix",
    "postfix-mysql",
    "postfix-policyd-spf-python",
    "postfix-pcre",
    "dovecot-common",
    "dovecot-imapd",
    "dovecot-pop3d",
    "dovecot-core",
    "dovecot-sieve",
    "dovecot-lmtpd",
    "dovecot-mysql",
    "opendkim",
    "opendkim-tools",
    "coreutils",
    "dos2unix",
    "dnsutils",
    "rsyslog",
    "unbound",
];

/// Install a single package using apt-get.
///
/// Runs `apt-get install -y --no-install-recommends <package>` in a
/// non-interactive environment.  Returns `Ok(())` on success or a
/// `PackageError` describing the failure.
pub fn install_package(package: &str) -> Result<(), PackageError> {
    info!(package = %package, "Installing package");

    let output = Command::new("apt-get")
        .arg("install")
        .arg("-y")
        .arg("--no-install-recommends")
        .arg(package)
        .env("DEBIAN_FRONTEND", "noninteractive")
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(PackageError::InstallFailed(format!(
            "Failed to install {}: {}",
            package, stderr
        )));
    }

    debug!(package = %package, "Successfully installed");
    Ok(())
}

/// Install multiple packages in a single `apt-get install` invocation.
///
/// This is more efficient than calling `install_package` in a loop because
/// apt-get resolves all dependencies in one pass.
pub fn install_packages(packages: &[&str]) -> Result<(), PackageError> {
    info!(count = packages.len(), "Installing packages in batch");

    let mut cmd = Command::new("apt-get");
    cmd.arg("install")
        .arg("-y")
        .arg("--no-install-recommends")
        .env("DEBIAN_FRONTEND", "noninteractive");

    for pkg in packages {
        cmd.arg(pkg);
    }

    let output = cmd.output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(PackageError::InstallFailed(format!(
            "Batch install failed: {}",
            stderr
        )));
    }

    debug!(count = packages.len(), "Batch install complete");
    Ok(())
}

/// Update apt package lists by running `apt-get update`.
pub fn apt_update() -> Result<(), PackageError> {
    info!("Updating package lists");
    let output = Command::new("apt-get")
        .arg("update")
        .env("DEBIAN_FRONTEND", "noninteractive")
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(PackageError::InstallFailed(format!(
            "apt-get update failed: {}",
            stderr
        )));
    }

    debug!("Package lists updated");
    Ok(())
}

/// Check if a package is already installed by querying `dpkg -s`.
pub fn is_installed(package: &str) -> bool {
    Command::new("dpkg")
        .arg("-s")
        .arg(package)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get the installed version string for a package, or `None` if not installed.
pub fn get_version(package: &str) -> Option<String> {
    let output = Command::new("dpkg-query")
        .args(["-W", "-f=${Version}", package])
        .output()
        .ok()?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if version.is_empty() {
            None
        } else {
            Some(version)
        }
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_core_packages_not_empty() {
        assert!(!CORE_PACKAGES.is_empty());
    }

    #[test]
    fn test_core_packages_contains_essential() {
        assert!(CORE_PACKAGES.contains(&"postfix"));
        assert!(CORE_PACKAGES.contains(&"dovecot-core"));
        assert!(CORE_PACKAGES.contains(&"opendkim"));
        assert!(CORE_PACKAGES.contains(&"mariadb-server"));
        assert!(CORE_PACKAGES.contains(&"apache2"));
        assert!(CORE_PACKAGES.contains(&"certbot"));
        assert!(CORE_PACKAGES.contains(&"spamassassin"));
        assert!(CORE_PACKAGES.contains(&"unbound"));
    }

    #[test]
    fn test_no_duplicate_packages() {
        let mut sorted = CORE_PACKAGES.to_vec();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), CORE_PACKAGES.len(), "Duplicate packages found");
    }
}
