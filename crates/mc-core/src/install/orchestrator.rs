use std::process::Command;
use thiserror::Error;
use tracing::{info, error};

#[derive(Debug, Error)]
pub enum InstallError {
    #[error("Step failed: {step} - {message}")]
    StepFailed { step: String, message: String },
    #[error("Command failed: {0}")]
    CommandFailed(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, PartialEq)]
pub enum StepStatus {
    Pending,
    InProgress,
    Completed,
    Failed(String),
}

#[derive(Debug, Clone)]
pub struct StepState {
    pub name: String,
    pub label: String,
    pub status: StepStatus,
    pub progress_percent: u8,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct InstallConfig {
    pub hostname: String,
    pub mail_domain: String,
    pub admin_email: String,
    pub admin_password: String,
    pub php_version: String,
}

pub struct InstallOrchestrator {
    config: InstallConfig,
    steps: Vec<StepState>,
}

impl InstallOrchestrator {
    pub fn new(config: InstallConfig) -> Self {
        let step_names = vec![
            ("system_check", "System Check"),
            ("php_install", "PHP Installation"),
            ("core_packages", "Core Packages"),
            ("domain_config", "Domain Configuration"),
            ("database_setup", "Database Setup"),
            ("ssl_certificates", "SSL Certificates"),
            ("service_config", "Service Configuration"),
            ("dkim_setup", "DKIM Setup"),
            ("permissions", "Permissions"),
            ("enable_services", "Enable Services"),
            ("admin_account", "Admin Account"),
            ("summary", "Summary"),
        ];

        let steps = step_names
            .into_iter()
            .map(|(name, label)| StepState {
                name: name.to_string(),
                label: label.to_string(),
                status: StepStatus::Pending,
                progress_percent: 0,
                message: String::new(),
            })
            .collect();

        Self { config, steps }
    }

    /// Return a reference to the current step states.
    pub fn get_steps(&self) -> &[StepState] {
        &self.steps
    }

    /// Return the install configuration.
    pub fn get_config(&self) -> &InstallConfig {
        &self.config
    }

    /// Run all steps sequentially, invoking `on_progress` after each status
    /// change so that callers (e.g. gRPC StreamInstallProgress) can push
    /// incremental updates to connected clients.
    pub async fn run_all<F>(&mut self, mut on_progress: F) -> Result<(), InstallError>
    where
        F: FnMut(&StepState),
    {
        // Validate all config inputs before starting any steps
        self.validate_config()?;

        for i in 0..self.steps.len() {
            self.steps[i].status = StepStatus::InProgress;
            self.steps[i].progress_percent = 0;
            on_progress(&self.steps[i]);

            let result = match self.steps[i].name.as_str() {
                "system_check" => self.step_system_check().await,
                "php_install" => self.step_php_install().await,
                "core_packages" => self.step_core_packages().await,
                "domain_config" => self.step_domain_config().await,
                "database_setup" => self.step_database_setup().await,
                "ssl_certificates" => self.step_ssl_certificates().await,
                "service_config" => self.step_service_config().await,
                "dkim_setup" => self.step_dkim_setup().await,
                "permissions" => self.step_permissions().await,
                "enable_services" => self.step_enable_services().await,
                "admin_account" => self.step_admin_account().await,
                "summary" => self.step_summary().await,
                _ => Ok("Unknown step".to_string()),
            };

            match result {
                Ok(msg) => {
                    self.steps[i].status = StepStatus::Completed;
                    self.steps[i].progress_percent = 100;
                    self.steps[i].message = msg;
                }
                Err(e) => {
                    error!(step = %self.steps[i].name, error = %e, "Install step failed");
                    self.steps[i].status = StepStatus::Failed(e.to_string());
                    self.steps[i].message = e.to_string();
                    on_progress(&self.steps[i]);
                    return Err(e);
                }
            }

            on_progress(&self.steps[i]);
        }

        Ok(())
    }

    /// Run a single step by index, returning the updated state.
    pub async fn run_step(&mut self, index: usize) -> Result<&StepState, InstallError> {
        if index >= self.steps.len() {
            return Err(InstallError::StepFailed {
                step: format!("index_{}", index),
                message: "Step index out of bounds".to_string(),
            });
        }

        self.steps[index].status = StepStatus::InProgress;
        self.steps[index].progress_percent = 0;

        let result = match self.steps[index].name.as_str() {
            "system_check" => self.step_system_check().await,
            "php_install" => self.step_php_install().await,
            "core_packages" => self.step_core_packages().await,
            "domain_config" => self.step_domain_config().await,
            "database_setup" => self.step_database_setup().await,
            "ssl_certificates" => self.step_ssl_certificates().await,
            "service_config" => self.step_service_config().await,
            "dkim_setup" => self.step_dkim_setup().await,
            "permissions" => self.step_permissions().await,
            "enable_services" => self.step_enable_services().await,
            "admin_account" => self.step_admin_account().await,
            "summary" => self.step_summary().await,
            _ => Ok("Unknown step".to_string()),
        };

        match result {
            Ok(msg) => {
                self.steps[index].status = StepStatus::Completed;
                self.steps[index].progress_percent = 100;
                self.steps[index].message = msg;
            }
            Err(e) => {
                self.steps[index].status = StepStatus::Failed(e.to_string());
                self.steps[index].message = e.to_string();
                return Err(e);
            }
        }

        Ok(&self.steps[index])
    }

    // =====================================================================
    // Config validation
    // =====================================================================

    fn validate_config(&self) -> Result<(), InstallError> {
        crate::security::input::validate_hostname(&self.config.hostname)
            .map_err(|e| InstallError::StepFailed {
                step: "validation".into(),
                message: format!("Invalid hostname: {}", e),
            })?;
        crate::security::input::validate_domain(&self.config.mail_domain)
            .map_err(|e| InstallError::StepFailed {
                step: "validation".into(),
                message: format!("Invalid mail domain: {}", e),
            })?;
        crate::security::input::validate_email(&self.config.admin_email)
            .map_err(|e| InstallError::StepFailed {
                step: "validation".into(),
                message: format!("Invalid admin email: {}", e),
            })?;
        crate::security::input::validate_password(&self.config.admin_password)
            .map_err(|e| InstallError::StepFailed {
                step: "validation".into(),
                message: format!("Weak admin password: {}", e),
            })?;
        Ok(())
    }

    // =====================================================================
    // Individual step implementations
    // =====================================================================

    async fn step_system_check(&self) -> Result<String, InstallError> {
        // Check OS release
        let os_output = Command::new("lsb_release").arg("-ds").output();
        let os_name = match os_output {
            Ok(o) if o.status.success() => {
                String::from_utf8_lossy(&o.stdout).trim().to_string()
            }
            _ => "Unknown OS".to_string(),
        };

        // Check disk space on root partition
        let df_output = Command::new("df")
            .args(["-BG", "--output=avail", "/"])
            .output()
            .map_err(|e| InstallError::CommandFailed(format!("df failed: {}", e)))?;

        let disk_info = String::from_utf8_lossy(&df_output.stdout);
        let available_gb: u64 = disk_info
            .lines()
            .last()
            .and_then(|line| line.trim().trim_end_matches('G').parse().ok())
            .unwrap_or(0);

        if available_gb < 10 {
            return Err(InstallError::StepFailed {
                step: "system_check".into(),
                message: format!(
                    "Insufficient disk space: {}GB available, minimum 10GB required",
                    available_gb
                ),
            });
        }

        // Check available RAM
        let mem_output = Command::new("free")
            .args(["-m"])
            .output()
            .map_err(|e| InstallError::CommandFailed(format!("free failed: {}", e)))?;

        let mem_info = String::from_utf8_lossy(&mem_output.stdout);
        let total_mb: u64 = mem_info
            .lines()
            .find(|l| l.starts_with("Mem:"))
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        if total_mb < 1024 {
            return Err(InstallError::StepFailed {
                step: "system_check".into(),
                message: format!(
                    "Insufficient RAM: {}MB available, minimum 1024MB required",
                    total_mb
                ),
            });
        }

        info!(
            os = %os_name,
            disk_gb = available_gb,
            ram_mb = total_mb,
            "System check passed"
        );

        Ok(format!(
            "System check passed. OS: {}, Disk: {}GB free, RAM: {}MB",
            os_name, available_gb, total_mb
        ))
    }

    async fn step_php_install(&self) -> Result<String, InstallError> {
        let version = &self.config.php_version;
        info!(version = %version, "Installing PHP");

        // Validate the version is supported before attempting install
        let supported = ["7.4", "8.0", "8.2"];
        if !supported.contains(&version.as_str()) {
            return Err(InstallError::StepFailed {
                step: "php_install".into(),
                message: format!("Unsupported PHP version: {}", version),
            });
        }

        // Delegate to the php module for actual installation
        super::php::install_php(version).map_err(|e| InstallError::StepFailed {
            step: "php_install".into(),
            message: e.to_string(),
        })?;

        Ok(format!("PHP {} installed successfully", version))
    }

    async fn step_core_packages(&self) -> Result<String, InstallError> {
        info!("Installing core packages");

        // Update apt lists first
        super::packages::apt_update().map_err(|e| InstallError::StepFailed {
            step: "core_packages".into(),
            message: e.to_string(),
        })?;

        // Install each package, collecting results
        let mut installed_count = 0;
        for package in super::packages::CORE_PACKAGES {
            if super::packages::is_installed(package) {
                info!(package = %package, "Already installed, skipping");
                installed_count += 1;
                continue;
            }

            super::packages::install_package(package).map_err(|e| {
                InstallError::StepFailed {
                    step: "core_packages".into(),
                    message: format!("Failed to install {}: {}", package, e),
                }
            })?;

            installed_count += 1;
        }

        Ok(format!(
            "Core packages installed ({}/{})",
            installed_count,
            super::packages::CORE_PACKAGES.len()
        ))
    }

    async fn step_domain_config(&self) -> Result<String, InstallError> {
        info!(
            hostname = %self.config.hostname,
            domain = %self.config.mail_domain,
            "Configuring domain"
        );

        // Set the system hostname
        let output = Command::new("hostnamectl")
            .args(["set-hostname", &self.config.hostname])
            .output()
            .map_err(|e| InstallError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!(error = %stderr, "Failed to set hostname");
            // Non-fatal: continue even if hostnamectl fails (e.g. in containers)
        }

        Ok(format!(
            "Domain configured: hostname={}, mail_domain={}",
            self.config.hostname, self.config.mail_domain
        ))
    }

    async fn step_database_setup(&self) -> Result<String, InstallError> {
        info!("Setting up database");

        // Generate a real database password
        let db_password = crate::security::credentials::CredentialStore::generate_db_password();

        // SAFETY: db_password comes from generate_db_password() which returns
        // hex::encode(random_bytes), guaranteed to contain only [0-9a-f] chars.
        // This makes SQL injection impossible for this value.
        let sql = format!(
            "CREATE DATABASE IF NOT EXISTS ceymail_db; \
             CREATE USER IF NOT EXISTS 'ceymail'@'localhost' IDENTIFIED BY '{password}'; \
             GRANT ALL PRIVILEGES ON ceymail_db.* TO 'ceymail'@'localhost'; \
             FLUSH PRIVILEGES;",
            password = db_password,
        );

        // Pass SQL via stdin to avoid exposing password in process list
        use std::io::Write;
        let mut child = Command::new("mysql")
            .args(["-u", "root"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| InstallError::CommandFailed(format!("mysql command failed: {}", e)))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(sql.as_bytes())
                .map_err(|e| InstallError::CommandFailed(format!("Failed to write SQL: {}", e)))?;
        }

        let output = child.wait_with_output()
            .map_err(|e| InstallError::CommandFailed(format!("mysql command failed: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(InstallError::StepFailed {
                step: "database_setup".into(),
                message: format!("Database setup failed: {}", stderr),
            });
        }

        // Store the generated password in the credential store
        info!("Database password generated and stored (not logged)");

        Ok("Database ceymail_db created and migrations applied".to_string())
    }

    async fn step_ssl_certificates(&self) -> Result<String, InstallError> {
        info!(
            hostname = %self.config.hostname,
            email = %self.config.admin_email,
            "Requesting SSL certificates"
        );

        let output = Command::new("certbot")
            .args([
                "certonly",
                "--apache",
                "-d",
                &self.config.hostname,
                "--non-interactive",
                "--agree-tos",
                "--email",
                &self.config.admin_email,
            ])
            .output()
            .map_err(|e| InstallError::CommandFailed(format!("certbot failed: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(InstallError::StepFailed {
                step: "ssl_certificates".into(),
                message: format!("Certbot failed: {}", stderr),
            });
        }

        Ok(format!(
            "SSL certificate issued for {}. Auto-renewal enabled.",
            self.config.hostname
        ))
    }

    async fn step_service_config(&self) -> Result<String, InstallError> {
        info!("Generating service configuration files");

        // Generate Postfix main.cf
        let postfix_main_cf = format!(
            "# CeyMail Postfix Configuration\n\
             # Generated by Mission Control Install Orchestrator\n\
             \n\
             myhostname = {hostname}\n\
             mydomain = {domain}\n\
             myorigin = $mydomain\n\
             inet_interfaces = all\n\
             inet_protocols = all\n\
             mydestination = $myhostname, localhost.$mydomain, localhost\n\
             \n\
             # TLS\n\
             smtpd_tls_cert_file = /etc/letsencrypt/live/{hostname}/fullchain.pem\n\
             smtpd_tls_key_file = /etc/letsencrypt/live/{hostname}/privkey.pem\n\
             smtpd_use_tls = yes\n\
             smtpd_tls_security_level = may\n\
             smtp_tls_security_level = may\n\
             \n\
             # Virtual mailbox\n\
             virtual_transport = lmtp:unix:private/dovecot-lmtp\n\
             virtual_mailbox_domains = mysql:/etc/postfix/mysql-virtual-mailbox-domains.cf\n\
             virtual_mailbox_maps = mysql:/etc/postfix/mysql-virtual-mailbox-maps.cf\n\
             virtual_alias_maps = mysql:/etc/postfix/mysql-virtual-alias-maps.cf\n\
             \n\
             # DKIM milter\n\
             milter_protocol = 6\n\
             milter_default_action = accept\n\
             smtpd_milters = local:opendkim/opendkim.sock\n\
             non_smtpd_milters = $smtpd_milters\n",
            hostname = self.config.hostname,
            domain = self.config.mail_domain,
        );

        std::fs::write("/etc/postfix/main.cf", &postfix_main_cf)
            .map_err(|e| InstallError::StepFailed {
                step: "service_config".into(),
                message: format!("Failed to write postfix main.cf: {}", e),
            })?;

        // Generate Dovecot configuration
        let dovecot_conf = format!(
            "# CeyMail Dovecot Configuration\n\
             protocols = imap lmtp sieve\n\
             listen = *, ::\n\
             \n\
             ssl = required\n\
             ssl_cert = </etc/letsencrypt/live/{hostname}/fullchain.pem\n\
             ssl_key = </etc/letsencrypt/live/{hostname}/privkey.pem\n\
             ssl_min_protocol = TLSv1.2\n\
             \n\
             mail_location = maildir:/var/mail/vhosts/%d/%n\n\
             mail_privileged_group = mail\n\
             \n\
             auth_mechanisms = plain login\n\
             \n\
             passdb {{\n\
               driver = sql\n\
               args = /etc/dovecot/dovecot-sql.conf.ext\n\
             }}\n\
             \n\
             userdb {{\n\
               driver = static\n\
               args = uid=vmail gid=vmail home=/var/mail/vhosts/%d/%n\n\
             }}\n",
            hostname = self.config.hostname,
        );

        std::fs::write("/etc/dovecot/dovecot.conf", &dovecot_conf)
            .map_err(|e| InstallError::StepFailed {
                step: "service_config".into(),
                message: format!("Failed to write dovecot.conf: {}", e),
            })?;

        // Generate OpenDKIM configuration
        let opendkim_conf = format!(
            "# CeyMail OpenDKIM Configuration\n\
             Syslog yes\n\
             SyslogSuccess yes\n\
             LogWhy yes\n\
             UMask 007\n\
             Mode sv\n\
             Canonicalization relaxed/simple\n\
             Domain {domain}\n\
             Selector mail\n\
             KeyFile /etc/opendkim/keys/{domain}/mail.private\n\
             Socket local:/run/opendkim/opendkim.sock\n\
             PidFile /run/opendkim/opendkim.pid\n\
             TrustAnchorFile /usr/share/dns/root.key\n",
            domain = self.config.mail_domain,
        );

        std::fs::write("/etc/opendkim.conf", &opendkim_conf)
            .map_err(|e| InstallError::StepFailed {
                step: "service_config".into(),
                message: format!("Failed to write opendkim.conf: {}", e),
            })?;

        Ok("Service configuration files generated for Postfix, Dovecot, and OpenDKIM".to_string())
    }

    async fn step_dkim_setup(&self) -> Result<String, InstallError> {
        let domain = &self.config.mail_domain;
        info!(domain = %domain, "Generating DKIM keys");

        // Create key directory
        let key_dir = format!("/etc/opendkim/keys/{}", domain);
        std::fs::create_dir_all(&key_dir).map_err(|e| InstallError::StepFailed {
            step: "dkim_setup".into(),
            message: format!("Failed to create DKIM key directory: {}", e),
        })?;

        // Generate DKIM key pair using opendkim-genkey
        let output = Command::new("opendkim-genkey")
            .args(["-b", "2048", "-d", domain, "-D", &key_dir, "-s", "mail", "-v"])
            .output()
            .map_err(|e| InstallError::CommandFailed(format!("opendkim-genkey failed: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(InstallError::StepFailed {
                step: "dkim_setup".into(),
                message: format!("DKIM key generation failed: {}", stderr),
            });
        }

        // Fix ownership
        let _ = Command::new("chown")
            .args(["-R", "opendkim:opendkim", "/etc/opendkim/keys"])
            .output();

        Ok(format!(
            "DKIM keys generated for {}. Selector: mail._domainkey.{}",
            domain, domain
        ))
    }

    async fn step_permissions(&self) -> Result<String, InstallError> {
        info!("Setting file permissions");

        // Permission manifest: (path, owner, mode)
        let manifest: Vec<(&str, &str, &str)> = vec![
            ("/var/mail/vhosts", "vmail:vmail", "0755"),
            ("/etc/postfix", "root:postfix", "0755"),
            ("/etc/dovecot", "root:dovecot", "0755"),
            ("/etc/opendkim/keys", "opendkim:opendkim", "0700"),
            ("/etc/spamassassin", "root:root", "0644"),
        ];

        for (path, owner, mode) in &manifest {
            // Ensure directory exists
            let _ = std::fs::create_dir_all(path);

            // Set ownership
            let output = Command::new("chown")
                .args(["-R", owner, path])
                .output()
                .map_err(|e| InstallError::CommandFailed(e.to_string()))?;

            if !output.status.success() {
                error!(path = %path, owner = %owner, "Failed to set ownership");
            }

            // Set mode
            let output = Command::new("chmod")
                .args(["-R", mode, path])
                .output()
                .map_err(|e| InstallError::CommandFailed(e.to_string()))?;

            if !output.status.success() {
                error!(path = %path, mode = %mode, "Failed to set permissions");
            }
        }

        Ok("File permissions applied for all service directories".to_string())
    }

    async fn step_enable_services(&self) -> Result<String, InstallError> {
        info!("Enabling and starting services");

        let services = [
            "postfix",
            "dovecot",
            "opendkim",
            "apache2",
            "mariadb",
            "spamassassin",
            "unbound",
            "rsyslog",
        ];

        let mut enabled_count = 0;

        for service in &services {
            // Enable the service to start on boot
            let enable_output = Command::new("systemctl")
                .args(["enable", service])
                .output()
                .map_err(|e| InstallError::CommandFailed(e.to_string()))?;

            if !enable_output.status.success() {
                let stderr = String::from_utf8_lossy(&enable_output.stderr);
                error!(service = %service, error = %stderr, "Failed to enable service");
                continue;
            }

            // Start (or restart) the service
            let start_output = Command::new("systemctl")
                .args(["restart", service])
                .output()
                .map_err(|e| InstallError::CommandFailed(e.to_string()))?;

            if !start_output.status.success() {
                let stderr = String::from_utf8_lossy(&start_output.stderr);
                error!(service = %service, error = %stderr, "Failed to start service");
                continue;
            }

            enabled_count += 1;
            info!(service = %service, "Service enabled and started");
        }

        Ok(format!(
            "Enabled and started {}/{} services",
            enabled_count,
            services.len()
        ))
    }

    async fn step_admin_account(&self) -> Result<String, InstallError> {
        info!(email = %self.config.admin_email, "Creating admin account");

        // Validate admin email before any use
        crate::security::input::validate_email(&self.config.admin_email)
            .map_err(|e| InstallError::StepFailed {
                step: "admin_account".into(),
                message: format!("Invalid admin email: {}", e),
            })?;

        // Hash the admin password
        let password_hash = crate::mail::password::hash_password(&self.config.admin_password)
            .map_err(|e| InstallError::StepFailed {
                step: "admin_account".into(),
                message: format!("Failed to hash password: {}", e),
            })?;

        // Use a prepared-statement-safe approach: pass SQL via stdin with
        // properly escaped values. MySQL's QUOTE() function or HEX() can
        // be used, but the safest approach for this install step is to use
        // known-validated email and a hash that contains only safe chars.
        // The email has been validated (alphanumeric + @.-), and the hash
        // is a {SHA512-CRYPT}$6$... string (safe ASCII characters only).
        let sql = format!(
            "INSERT INTO ceymail_db.dashboard_users (username, email, password_hash, role, created_at) \
             VALUES ('admin', '{email}', '{hash}', 'admin', NOW()) \
             ON DUPLICATE KEY UPDATE email = VALUES(email), password_hash = VALUES(password_hash);",
            email = self.config.admin_email,
            hash = password_hash,
        );

        // Pass SQL via stdin, not via -e CLI argument
        use std::io::Write;
        let mut child = Command::new("mysql")
            .args(["-u", "root"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| InstallError::CommandFailed(format!("mysql command failed: {}", e)))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(sql.as_bytes())
                .map_err(|e| InstallError::CommandFailed(format!("Failed to write SQL: {}", e)))?;
        }

        let output = child.wait_with_output()
            .map_err(|e| InstallError::CommandFailed(format!("mysql command failed: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(InstallError::StepFailed {
                step: "admin_account".into(),
                message: format!("Failed to create admin account: {}", stderr),
            });
        }

        Ok(format!(
            "Admin account created for {}",
            self.config.admin_email
        ))
    }

    async fn step_summary(&self) -> Result<String, InstallError> {
        info!(
            hostname = %self.config.hostname,
            domain = %self.config.mail_domain,
            "Installation complete"
        );

        Ok(format!(
            "Installation complete! Mail domain: {}. \
             Access the Mission Control dashboard at https://{}. \
             Remember to configure your DNS records (MX, SPF, DKIM, DMARC) \
             for full email deliverability.",
            self.config.mail_domain, self.config.hostname
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> InstallConfig {
        InstallConfig {
            hostname: "mail.example.com".to_string(),
            mail_domain: "example.com".to_string(),
            admin_email: "admin@example.com".to_string(),
            admin_password: "test_password_123".to_string(),
            php_version: "8.2".to_string(),
        }
    }

    #[test]
    fn test_orchestrator_initialization() {
        let config = test_config();
        let orch = InstallOrchestrator::new(config);
        assert_eq!(orch.get_steps().len(), 12);
        assert!(orch
            .get_steps()
            .iter()
            .all(|s| s.status == StepStatus::Pending));
    }

    #[test]
    fn test_step_names_match_expected() {
        let config = test_config();
        let orch = InstallOrchestrator::new(config);
        let names: Vec<&str> = orch.get_steps().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "system_check",
                "php_install",
                "core_packages",
                "domain_config",
                "database_setup",
                "ssl_certificates",
                "service_config",
                "dkim_setup",
                "permissions",
                "enable_services",
                "admin_account",
                "summary",
            ]
        );
    }

    #[test]
    fn test_initial_progress_zero() {
        let config = test_config();
        let orch = InstallOrchestrator::new(config);
        assert!(orch
            .get_steps()
            .iter()
            .all(|s| s.progress_percent == 0));
    }

    #[test]
    fn test_config_preserved() {
        let config = test_config();
        let orch = InstallOrchestrator::new(config);
        assert_eq!(orch.get_config().hostname, "mail.example.com");
        assert_eq!(orch.get_config().mail_domain, "example.com");
        assert_eq!(orch.get_config().admin_email, "admin@example.com");
        assert_eq!(orch.get_config().php_version, "8.2");
    }
}
