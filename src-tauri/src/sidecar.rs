use std::io::Write;
use std::path::Path;
#[cfg(unix)]
use std::fs::File;

pub fn atomic_write(target: &Path, contents: &[u8]) -> std::io::Result<()> {
    let dir = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "target has no parent")
    })?;
    let mut builder = tempfile::Builder::new();
    builder.prefix(".remarkdown-tmp-");
    // tempfile makes its files 0600, and the rename below would carry that
    // onto the document, so a shared 0644 file stopped being readable by
    // anyone else after the first save. Ask for 0666 instead: open() takes
    // the umask off it, so a new file gets the mode any other program would
    // give it.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(std::fs::Permissions::from_mode(0o666));
    }
    let mut tmp = builder.tempfile_in(dir)?;
    // Replacing a file keeps its mode. Set before writing, so the contents
    // are never readable under a wider mode than the target's.
    #[cfg(unix)]
    if let Ok(meta) = std::fs::metadata(target) {
        tmp.as_file().set_permissions(meta.permissions())?;
    }
    tmp.write_all(contents)?;
    tmp.as_file().sync_all()?;
    // persist performs an atomic rename-over-existing on both POSIX (rename syscall) and
    // Windows (SetFileInformationByHandle/FileRenameInfo). Best-effort on SMB/filter drivers.
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
    use std::fs;
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

    #[cfg(unix)]
    fn mode_of(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).unwrap().permissions().mode() & 0o7777
    }

    #[cfg(unix)]
    fn set_mode(path: &Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_a_readable_files_mode() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("shared.md");
        fs::write(&target, b"old").unwrap();
        set_mode(&target, 0o644);
        atomic_write(&target, b"new").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        assert_eq!(mode_of(&target), 0o644);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_a_group_writable_files_mode() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("team.md");
        fs::write(&target, b"old").unwrap();
        set_mode(&target, 0o664);
        atomic_write(&target, b"new").unwrap();
        assert_eq!(mode_of(&target), 0o664);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_a_private_files_mode() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("private.md");
        fs::write(&target, b"old").unwrap();
        set_mode(&target, 0o600);
        atomic_write(&target, b"new").unwrap();
        assert_eq!(mode_of(&target), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_gives_a_new_file_the_usual_mode() {
        // Whatever the umask is, a new file should come out exactly as one
        // made by any other program in the same folder.
        let dir = tempdir().unwrap();
        let reference = dir.path().join("reference.md");
        fs::File::create(&reference).unwrap();
        let target = dir.path().join("new.md");
        atomic_write(&target, b"hello").unwrap();
        assert_eq!(mode_of(&target), mode_of(&reference));
    }
}
