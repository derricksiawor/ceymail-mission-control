use anyhow::{Context, Result};
use rcgen::{CertificateParams, KeyPair};
use std::path::{Path, PathBuf};
use tokio::fs;
use tonic::transport::server::ServerTlsConfig;
use tonic::transport::{Certificate, Identity};
use tracing::{info, warn};

/// Directory where TLS certificates are stored.
const CERTS_DIR: &str = "/etc/ceymail-mc/certs";

/// CA certificate filename.
const CA_CERT_FILE: &str = "ca.pem";

/// Server certificate filename.
const SERVER_CERT_FILE: &str = "server.pem";

/// Server private key filename.
const SERVER_KEY_FILE: &str = "server-key.pem";

/// Load TLS configuration for the gRPC server.
///
/// Attempts to load existing certificates from the certs directory. If no
/// certificates are found, generates self-signed certificates and saves them.
pub async fn load_tls_config() -> Result<ServerTlsConfig> {
    let certs_dir = PathBuf::from(CERTS_DIR);
    let ca_path = certs_dir.join(CA_CERT_FILE);
    let cert_path = certs_dir.join(SERVER_CERT_FILE);
    let key_path = certs_dir.join(SERVER_KEY_FILE);

    // Check if certificates already exist.
    if cert_path.exists() && key_path.exists() {
        info!("Loading existing TLS certificates from {}", CERTS_DIR);
        let cert_pem = fs::read_to_string(&cert_path)
            .await
            .context("Failed to read server certificate")?;
        let key_pem = fs::read_to_string(&key_path)
            .await
            .context("Failed to read server key")?;

        let identity = Identity::from_pem(cert_pem, key_pem);

        let mut tls_config = ServerTlsConfig::new().identity(identity);

        // If CA cert exists, use it for client verification.
        if ca_path.exists() {
            let ca_pem = fs::read_to_string(&ca_path)
                .await
                .context("Failed to read CA certificate")?;
            let ca_cert = Certificate::from_pem(ca_pem);
            tls_config = tls_config.client_ca_root(ca_cert);
        }

        return Ok(tls_config);
    }

    // No certs found; generate self-signed.
    warn!("No TLS certificates found, generating self-signed certificates");
    let (ca_pem, cert_pem, key_pem) = generate_self_signed_certs()
        .context("Failed to generate self-signed certificates")?;

    // Ensure the certs directory exists.
    fs::create_dir_all(&certs_dir)
        .await
        .context("Failed to create certs directory")?;

    // Write the certificates to disk.
    fs::write(&ca_path, &ca_pem)
        .await
        .context("Failed to write CA certificate")?;
    fs::write(&cert_path, &cert_pem)
        .await
        .context("Failed to write server certificate")?;
    fs::write(&key_path, &key_pem)
        .await
        .context("Failed to write server key")?;

    // Set restrictive permissions on private key files
    use std::os::unix::fs::PermissionsExt;
    let key_perms = std::fs::Permissions::from_mode(0o600);
    tokio::fs::set_permissions(&ca_path, std::fs::Permissions::from_mode(0o644)).await
        .context("Failed to set CA cert permissions")?;
    tokio::fs::set_permissions(&cert_path, std::fs::Permissions::from_mode(0o644)).await
        .context("Failed to set server cert permissions")?;
    tokio::fs::set_permissions(&key_path, key_perms).await
        .context("Failed to set server key permissions")?;

    info!("Self-signed certificates written to {}", CERTS_DIR);

    let identity = Identity::from_pem(cert_pem, key_pem);
    let tls_config = ServerTlsConfig::new().identity(identity);

    Ok(tls_config)
}

/// Generate a self-signed CA certificate and a server certificate signed by that CA.
///
/// Returns (ca_cert_pem, server_cert_pem, server_key_pem).
fn generate_self_signed_certs() -> Result<(String, String, String)> {
    // Generate the CA key pair and certificate.
    let ca_key_pair = KeyPair::generate()
        .context("Failed to generate CA key pair")?;

    let mut ca_params = CertificateParams::new(vec!["CeyMail MC CA".to_string()])
        .context("Failed to create CA certificate params")?;
    ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);

    let ca_cert = ca_params
        .self_signed(&ca_key_pair)
        .context("Failed to self-sign CA certificate")?;
    let ca_pem = ca_cert.pem();

    // Generate the server key pair and certificate.
    let server_key_pair = KeyPair::generate()
        .context("Failed to generate server key pair")?;

    let server_params = CertificateParams::new(vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
    ])
    .context("Failed to create server certificate params")?;

    let server_cert = server_params
        .signed_by(&server_key_pair, &ca_cert, &ca_key_pair)
        .context("Failed to sign server certificate")?;
    let server_cert_pem = server_cert.pem();
    let server_key_pem = server_key_pair.serialize_pem();

    Ok((ca_pem, server_cert_pem, server_key_pem))
}
