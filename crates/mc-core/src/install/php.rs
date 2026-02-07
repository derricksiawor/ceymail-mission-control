use std::process::Command;
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum PhpError {
    #[error("PHP installation failed: {0}")]
    InstallFailed(String),
    #[error("Unsupported PHP version: {0}")]
    UnsupportedVersion(String),
    #[error("Command error: {0}")]
    CommandError(#[from] std::io::Error),
}

/// PHP versions supported by the CeyMail installer.
pub const SUPPORTED_VERSIONS: &[&str] = &["7.4", "8.0", "8.2"];

/// The recommended PHP version for new installations.
pub const RECOMMENDED_VERSION: &str = "8.2";

/// PHP extensions required by CeyMail and its web interfaces.
pub const PHP_EXTENSIONS: &[&str] = &[
    "cli", "common", "mysql", "zip", "gd", "intl",
    "opcache", "xml", "mbstring", "curl", "bcmath",
];

/// Install PHP and all required extensions for a given version.
///
/// This adds the `ondrej/php` PPA if needed, then installs the PHP package
/// itself along with every extension listed in `PHP_EXTENSIONS` and the
/// corresponding Apache module (`libapache2-mod-php`).
pub fn install_php(version: &str) -> Result<(), PhpError> {
    if !SUPPORTED_VERSIONS.contains(&version) {
        return Err(PhpError::UnsupportedVersion(version.to_string()));
    }

    info!(version = %version, "Installing PHP and extensions");

    // Add the ondrej/php PPA for the latest PHP builds
    let ppa_output = Command::new("add-apt-repository")
        .args(["-y", "ppa:ondrej/php"])
        .env("DEBIAN_FRONTEND", "noninteractive")
        .output();

    match ppa_output {
        Ok(o) if o.status.success() => {
            info!("PHP PPA added successfully");
            // Update package lists after adding PPA
            let _ = Command::new("apt-get")
                .arg("update")
                .env("DEBIAN_FRONTEND", "noninteractive")
                .output();
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            info!(stderr = %stderr, "PPA add returned non-zero (may already exist)");
        }
        Err(e) => {
            info!(error = %e, "add-apt-repository not found, skipping PPA");
        }
    }

    // Build package list: base PHP + extensions + Apache module
    let mut packages = vec![format!("php{}", version)];
    for ext in PHP_EXTENSIONS {
        packages.push(format!("php{}-{}", version, ext));
    }
    packages.push(format!("libapache2-mod-php{}", version));

    // Install all PHP packages
    let mut cmd = Command::new("apt-get");
    cmd.arg("install")
        .arg("-y")
        .arg("--no-install-recommends")
        .env("DEBIAN_FRONTEND", "noninteractive");

    for pkg in &packages {
        cmd.arg(pkg);
    }

    let output = cmd.output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(PhpError::InstallFailed(format!(
            "Failed to install PHP {} packages: {}",
            version, stderr
        )));
    }

    // Enable the PHP module in Apache
    let a2enmod_output = Command::new("a2enmod")
        .arg(format!("php{}", version))
        .output();

    match a2enmod_output {
        Ok(o) if o.status.success() => {
            info!(version = %version, "Apache PHP module enabled");
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            info!(stderr = %stderr, "a2enmod returned non-zero (may already be enabled)");
        }
        Err(e) => {
            info!(error = %e, "a2enmod not available");
        }
    }

    // Disable other PHP versions in Apache to avoid conflicts
    for other in SUPPORTED_VERSIONS {
        if *other != version {
            let _ = Command::new("a2dismod")
                .arg(format!("php{}", other))
                .output();
        }
    }

    info!(version = %version, extensions = PHP_EXTENSIONS.len(), "PHP installed successfully");
    Ok(())
}

/// Get the currently active PHP CLI version as a "major.minor" string.
///
/// Returns `None` if `php` is not installed or the version string cannot
/// be parsed.
pub fn get_active_version() -> Option<String> {
    Command::new("php")
        .arg("-v")
        .output()
        .ok()
        .and_then(|o| {
            if !o.status.success() {
                return None;
            }
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.lines().next().and_then(|line| {
                // Line looks like: "PHP 8.2.15 (cli) (built: ...)"
                line.split_whitespace().nth(1).map(|v| {
                    let parts: Vec<&str> = v.split('.').collect();
                    if parts.len() >= 2 {
                        format!("{}.{}", parts[0], parts[1])
                    } else {
                        v.to_string()
                    }
                })
            })
        })
}

/// Check whether a specific PHP version is currently installed.
pub fn is_version_installed(version: &str) -> bool {
    let pkg = format!("php{}", version);
    Command::new("dpkg")
        .args(["-s", &pkg])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// List all PHP extensions installed for a given version.
pub fn list_installed_extensions(version: &str) -> Vec<String> {
    let output = Command::new("dpkg")
        .args(["--list", &format!("php{}-*", version)])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout
                .lines()
                .filter(|l| l.starts_with("ii"))
                .filter_map(|line| {
                    line.split_whitespace().nth(1).map(|pkg| {
                        // Strip the "php8.2-" prefix to get just the extension name
                        let prefix = format!("php{}-", version);
                        pkg.strip_prefix(&prefix)
                            .unwrap_or(pkg)
                            .to_string()
                    })
                })
                .collect()
        }
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_versions() {
        assert!(SUPPORTED_VERSIONS.contains(&"7.4"));
        assert!(SUPPORTED_VERSIONS.contains(&"8.0"));
        assert!(SUPPORTED_VERSIONS.contains(&"8.2"));
        assert!(!SUPPORTED_VERSIONS.contains(&"5.6"));
    }

    #[test]
    fn test_recommended_version_is_supported() {
        assert!(SUPPORTED_VERSIONS.contains(&RECOMMENDED_VERSION));
    }

    #[test]
    fn test_extensions_not_empty() {
        assert!(!PHP_EXTENSIONS.is_empty());
        assert!(PHP_EXTENSIONS.contains(&"cli"));
        assert!(PHP_EXTENSIONS.contains(&"mysql"));
        assert!(PHP_EXTENSIONS.contains(&"mbstring"));
    }

    #[test]
    fn test_unsupported_version_error() {
        let result = install_php("5.6");
        assert!(result.is_err());
        match result {
            Err(PhpError::UnsupportedVersion(v)) => assert_eq!(v, "5.6"),
            _ => panic!("Expected UnsupportedVersion error"),
        }
    }
}
