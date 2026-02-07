mod generated;
mod server;
mod tls;

use tracing::{error, info};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    // Initialize tracing subscriber with environment filter.
    // Use RUST_LOG env var to control log levels, defaulting to info.
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .init();

    info!("CeyMail Mission Control daemon starting");

    // Run the gRPC server and handle errors.
    if let Err(e) = server::run().await {
        error!("Daemon exited with error: {:#}", e);
        std::process::exit(1);
    }

    info!("CeyMail Mission Control daemon stopped");
}
