use anyhow::{Context, Result};
use tokio::signal;
use tonic::transport::Server;
use tracing::info;

use crate::tls;

/// Default gRPC listen address.
const DEFAULT_GRPC_ADDR: &str = "127.0.0.1:50051";

/// Run the Mission Control gRPC server.
///
/// This sets up TLS, registers all service implementations from `mc-services`,
/// and listens for incoming connections. The server shuts down gracefully on
/// SIGTERM or SIGINT.
pub async fn run() -> Result<()> {
    let grpc_addr = DEFAULT_GRPC_ADDR
        .parse()
        .context("Failed to parse gRPC bind address")?;

    // Load or generate TLS configuration.
    let tls_config = tls::load_tls_config()
        .await
        .context("Failed to load TLS configuration")?;

    info!("Starting gRPC server on {}", grpc_addr);

    // Build the tonic server with TLS and the tonic-web layer for gRPC-Web support.
    // TODO: Register all service implementations from mc-services once they are implemented.
    let server = Server::builder()
        .tls_config(tls_config)
        .context("Failed to configure TLS on gRPC server")?
        .accept_http1(true)
        .layer(tonic_web::GrpcWebLayer::new());

    // TODO: Add service routes here, e.g.:
    // let server = server
    //     .add_service(mc_services::control::ControlServiceServer::new(control_svc))
    //     .add_service(mc_services::config::ConfigServiceServer::new(config_svc))
    //     ...

    info!("Server configured, awaiting connections");

    // Serve with graceful shutdown.
    server
        .serve_with_shutdown(grpc_addr, shutdown_signal())
        .await
        .context("gRPC server error")?;

    info!("Server shut down gracefully");
    Ok(())
}

/// Wait for a shutdown signal (SIGTERM or SIGINT).
async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Failed to install SIGINT handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            info!("Received SIGINT, initiating graceful shutdown");
        }
        _ = terminate => {
            info!("Received SIGTERM, initiating graceful shutdown");
        }
    }
}
