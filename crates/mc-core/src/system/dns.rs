use std::process::Command;
use thiserror::Error;
use tracing::{debug, info, warn};

#[derive(Debug, Error)]
pub enum DnsError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("DNS lookup failed: {0}")]
    LookupFailed(String),
    #[error("Command not found: {0}")]
    ToolNotFound(String),
    #[error("Invalid input: {0}")]
    InvalidInput(String),
}

/// Common DNS blocklists to check against
const DNSBL_LISTS: &[&str] = &[
    "zen.spamhaus.org",
    "bl.spamcop.net",
    "b.barracudacentral.org",
    "dnsbl.sorbs.net",
    "ips.backscatterer.org",
];

/// Check if a domain resolves to an IP address using `dig`.
///
/// Returns true if the domain has at least one A or AAAA record.
/// Uses Command::new("dig") with proper arg passing -- no shell interpolation.
pub fn check_dns_resolution(domain: &str) -> Result<bool, DnsError> {
    // Basic validation: reject empty or obviously malicious input
    if domain.is_empty() || domain.len() > 253 {
        return Err(DnsError::InvalidInput(format!(
            "Invalid domain length: {}", domain.len()
        )));
    }

    let output = Command::new("dig")
        .arg("+short")
        .arg("+timeout=5")
        .arg("+tries=2")
        .arg(domain)
        .arg("A")
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                DnsError::ToolNotFound("dig".to_string())
            } else {
                DnsError::Io(e)
            }
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let has_records = stdout.lines().any(|line| {
        let trimmed = line.trim();
        !trimmed.is_empty() && !trimmed.starts_with(";;")
    });

    debug!("DNS resolution for {}: {}", domain, if has_records { "found" } else { "not found" });
    Ok(has_records)
}

/// Check if an IP address is listed on common DNS blocklists (DNSBLs).
///
/// Returns a list of blocklists that the IP appears on.
/// An empty list means the IP is clean.
///
/// The IP is reversed and queried against each DNSBL (standard DNSBL lookup).
/// Uses Command::new("dig") with proper arg passing.
pub fn check_dnsbl(ip: &str) -> Result<Vec<String>, DnsError> {
    // Validate IP format (basic check for IPv4)
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 || !parts.iter().all(|p| p.parse::<u8>().is_ok()) {
        return Err(DnsError::InvalidInput(format!(
            "Invalid IPv4 address: {}", ip
        )));
    }

    // Reverse the IP octets for DNSBL lookup
    let reversed = format!("{}.{}.{}.{}", parts[3], parts[2], parts[1], parts[0]);

    let mut listed_on = Vec::new();

    for dnsbl in DNSBL_LISTS {
        let query = format!("{}.{}", reversed, dnsbl);

        let output = Command::new("dig")
            .arg("+short")
            .arg("+timeout=3")
            .arg("+tries=1")
            .arg(&query)
            .arg("A")
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    DnsError::ToolNotFound("dig".to_string())
                } else {
                    DnsError::Io(e)
                }
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let is_listed = stdout.lines().any(|line| {
            let trimmed = line.trim();
            // DNSBL returns 127.0.0.x when listed
            trimmed.starts_with("127.")
        });

        if is_listed {
            warn!("IP {} is listed on DNSBL: {}", ip, dnsbl);
            listed_on.push(dnsbl.to_string());
        } else {
            debug!("IP {} is NOT listed on {}", ip, dnsbl);
        }
    }

    if listed_on.is_empty() {
        info!("IP {} is clean on all checked DNSBLs", ip);
    }

    Ok(listed_on)
}

/// Test if the Unbound DNS resolver is responding.
///
/// Sends a simple query to localhost (where Unbound should be listening)
/// and checks for a valid response.
pub fn test_unbound() -> Result<bool, DnsError> {
    let output = Command::new("dig")
        .arg("@127.0.0.1")
        .arg("+short")
        .arg("+timeout=3")
        .arg("+tries=1")
        .arg("example.com")
        .arg("A")
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                DnsError::ToolNotFound("dig".to_string())
            } else {
                DnsError::Io(e)
            }
        })?;

    if !output.status.success() {
        debug!("Unbound test failed: dig returned non-zero exit code");
        return Ok(false);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let has_response = stdout.lines().any(|line| {
        let trimmed = line.trim();
        !trimmed.is_empty() && !trimmed.starts_with(";;")
    });

    if has_response {
        debug!("Unbound is responding on 127.0.0.1");
    } else {
        warn!("Unbound did not return results for test query");
    }

    Ok(has_response)
}
