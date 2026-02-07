use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_root = PathBuf::from("../../proto");

    let protos = [
        "ceymail/v1/common.proto",
        "ceymail/v1/services.proto",
        "ceymail/v1/config.proto",
        "ceymail/v1/users.proto",
        "ceymail/v1/dkim.proto",
        "ceymail/v1/logs.proto",
        "ceymail/v1/stats.proto",
        "ceymail/v1/install.proto",
        "ceymail/v1/webmail.proto",
        "ceymail/v1/backup.proto",
        "ceymail/v1/control.proto",
    ];

    let proto_paths: Vec<PathBuf> = protos
        .iter()
        .map(|p| proto_root.join(p))
        .collect();

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .out_dir(std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("src/generated"))
        .compile_protos(&proto_paths, &[&proto_root])?;

    Ok(())
}
