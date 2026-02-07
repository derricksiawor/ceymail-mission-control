use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;
use thiserror::Error;
use tracing::{debug, warn};

#[derive(Debug, Error)]
pub enum AtomicWriteError {
    #[error("Failed to create temp file: {0}")]
    TempFile(#[from] tempfile::PersistError),
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("Parent directory does not exist: {0}")]
    NoParentDir(PathBuf),
    #[error("Backup failed: {0}")]
    BackupFailed(String),
}

/// Atomically write content to a file with optional backup of original.
///
/// Process: write to temp file in same directory -> fsync -> rename over target.
/// This ensures the file is either fully written or not changed at all.
pub fn atomic_write(
    path: &Path,
    content: &[u8],
    mode: Option<u32>,
) -> Result<(), AtomicWriteError> {
    let parent = path.parent()
        .ok_or_else(|| AtomicWriteError::NoParentDir(path.to_path_buf()))?;

    if !parent.exists() {
        return Err(AtomicWriteError::NoParentDir(parent.to_path_buf()));
    }

    // Create temp file in same directory (same filesystem = atomic rename)
    let mut temp = NamedTempFile::new_in(parent)?;

    // Write content
    temp.write_all(content)?;

    // fsync to ensure data is on disk
    temp.as_file().sync_all()?;

    // Set permissions before rename if specified
    if let Some(m) = mode {
        let permissions = fs::Permissions::from_mode(m);
        fs::set_permissions(temp.path(), permissions)?;
    }

    debug!("Atomic write: persisting temp file to {:?}", path);

    // Atomic rename
    temp.persist(path)?;

    // fsync the parent directory to ensure the directory entry is persisted
    if let Ok(dir) = File::open(parent) {
        let _ = dir.sync_all();
    }

    Ok(())
}

/// Atomically write content to a file, creating a .bak backup of the original first.
pub fn atomic_write_with_backup(
    path: &Path,
    content: &[u8],
    mode: Option<u32>,
) -> Result<(), AtomicWriteError> {
    // Create backup if original exists
    if path.exists() {
        let backup_path = path.with_extension(
            format!("{}.bak", path.extension().map(|e| e.to_str().unwrap_or("")).unwrap_or(""))
        );
        fs::copy(path, &backup_path).map_err(|e| {
            AtomicWriteError::BackupFailed(format!("Failed to backup {:?}: {}", path, e))
        })?;
        debug!("Created backup at {:?}", backup_path);
    }

    atomic_write(path, content, mode)
}

/// Atomically write a string to a config file with standard 0644 permissions.
pub fn atomic_write_config(path: &Path, content: &str) -> Result<(), AtomicWriteError> {
    atomic_write(path, content.as_bytes(), Some(0o644))
}

/// Atomically write a string with restricted 0600 permissions (for files with secrets).
pub fn atomic_write_secret(path: &Path, content: &str) -> Result<(), AtomicWriteError> {
    atomic_write(path, content.as_bytes(), Some(0o600))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_atomic_write_creates_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.conf");
        atomic_write(&path, b"hello world", Some(0o644)).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello world");
    }

    #[test]
    fn test_atomic_write_overwrites() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.conf");
        atomic_write(&path, b"first", Some(0o644)).unwrap();
        atomic_write(&path, b"second", Some(0o644)).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
    }

    #[test]
    fn test_atomic_write_with_backup() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.conf");
        fs::write(&path, "original").unwrap();
        atomic_write_with_backup(&path, b"updated", Some(0o644)).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "updated");
        let backup = dir.path().join("test.conf.bak");
        assert!(backup.exists());
    }

    #[test]
    fn test_atomic_write_permissions() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("secret.key");
        atomic_write_secret(&path, "secret-content").unwrap();
        let meta = fs::metadata(&path).unwrap();
        assert_eq!(meta.permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn test_no_parent_dir_error() {
        let result = atomic_write(Path::new("/nonexistent/dir/file.txt"), b"data", None);
        assert!(result.is_err());
    }
}
