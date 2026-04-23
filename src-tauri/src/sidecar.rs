use std::fs;
#[cfg(unix)]
use std::fs::File;
use std::io::Write;
use std::path::Path;

pub fn atomic_write(target: &Path, contents: &[u8]) -> std::io::Result<()> {
    let dir = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "target has no parent")
    })?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".remarkdown-tmp-")
        .tempfile_in(dir)?;
    tmp.write_all(contents)?;
    tmp.as_file().sync_all()?;
    // persist performs a rename; on Windows this replaces existing atomically when supported.
    tmp.persist(target).map_err(|e| e.error)?;
    // fsync the directory on unix for durability (best-effort).
    #[cfg(unix)]
    if let Ok(dir_file) = File::open(dir) {
        let _ = dir_file.sync_all();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn atomic_write_creates_and_replaces() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("a.md.remarkdown.json");
        atomic_write(&target, b"first").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "first");
        atomic_write(&target, b"second").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "second");
    }
}
