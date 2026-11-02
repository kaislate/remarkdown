use std::io::Write;
use std::path::Path;
#[cfg(unix)]
use std::fs::File;
use tempfile::NamedTempFile;

/// Writes the app's own state (settings, session, recent files, reading
/// progress). These list every document the user opens, so they stay
/// private: tempfile makes its files 0600, and that mode is kept.
pub fn atomic_write(target: &Path, contents: &[u8]) -> std::io::Result<()> {
    let dir = parent_of(target)?;
    let tmp = write_temp(dir, contents)?;
    persist(tmp, target, dir)
}

/// Writes one of the user's own files: a document or its sidecar. On macOS
/// and Linux the rename would carry the temp file's 0600 onto it, so a shared
/// 0644 document stopped being readable by anyone else after the first save.
/// The finished file gets the mode the target had, or, for a new file, the
/// mode any other program would give it.
pub fn atomic_write_user_file(target: &Path, contents: &[u8]) -> std::io::Result<()> {
    let dir = parent_of(target)?;
    let tmp = write_temp(dir, contents)?;
    // Only now, with everything written: anyone who opens the temp file
    // keeps that descriptor whatever the mode becomes later, so it must not
    // be readable by others while it fills. A chmod that fails (a filesystem
    // without Unix modes) leaves it 0600, which is the safe way to be wrong.
    #[cfg(unix)]
    if let Some(mode) = user_file_mode(target, dir) {
        use std::os::unix::fs::PermissionsExt;
        let _ = tmp.as_file().set_permissions(std::fs::Permissions::from_mode(mode));
    }
    persist(tmp, target, dir)
}

fn parent_of(target: &Path) -> std::io::Result<&Path> {
    target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "target has no parent")
    })
}

/// A temp file beside the target holding `contents`, synced to disk. It is
/// 0600 on Unix (tempfile's default) from the moment it exists.
fn write_temp(dir: &Path, contents: &[u8]) -> std::io::Result<NamedTempFile> {
    let mut tmp = tempfile::Builder::new().prefix(".remarkdown-tmp-").tempfile_in(dir)?;
    tmp.write_all(contents)?;
    tmp.as_file().sync_all()?;
    Ok(tmp)
}

fn persist(tmp: NamedTempFile, target: &Path, dir: &Path) -> std::io::Result<()> {
    // persist performs an atomic rename-over-existing on both POSIX (rename syscall) and
    // Windows (SetFileInformationByHandle/FileRenameInfo). Best-effort on SMB/filter drivers.
    tmp.persist(target).map_err(|e| e.error)?;
    // fsync the directory on unix for durability (best-effort).
    #[cfg(unix)]
    if let Ok(dir_file) = File::open(dir) {
        let _ = dir_file.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

/// The mode a saved user file should end up with. An ordinary file keeps
/// its permission bits, but not setuid/setgid/sticky: a document is never
/// meant to carry those. A symlink, which the rename replaces with an
/// ordinary file, gets the mode of a new file less anything the file it led
/// to didn't allow: a link to a private 0600 journal must not leave a 0644
/// copy behind. Anything else (nothing there, a link to no ordinary file)
/// gets the mode of a new file.
#[cfg(unix)]
fn user_file_mode(target: &Path, dir: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    let bits = |meta: &std::fs::Metadata| meta.permissions().mode() & 0o777;
    match std::fs::symlink_metadata(target) {
        Ok(meta) if meta.is_file() => Some(bits(&meta)),
        Ok(meta) if meta.file_type().is_symlink() => {
            let new = new_file_mode(dir)?;
            match std::fs::metadata(target) {
                Ok(led_to) if led_to.is_file() => Some(new & bits(&led_to)),
                _ => Some(new),
            }
        }
        _ => new_file_mode(dir),
    }
}

/// What open() makes of 0666 in `dir`: the umask taken off, as for any new
/// file. Read off an empty probe file, because the umask can only be read by
/// setting it, and setting it changes it for every thread in the process.
#[cfg(unix)]
fn new_file_mode(dir: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    let probe = tempfile::Builder::new()
        .prefix(".remarkdown-tmp-")
        .permissions(std::fs::Permissions::from_mode(0o666))
        .tempfile_in(dir)
        .ok()?;
    let mode = probe.as_file().metadata().ok()?.permissions().mode();
    Some(mode & 0o777)
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

    #[test]
    fn atomic_write_user_file_creates_and_replaces() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("a.md");
        atomic_write_user_file(&target, b"first").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "first");
        atomic_write_user_file(&target, b"second").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "second");
        // The probe file and the temp file are both gone.
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
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
    fn the_temp_file_is_private_while_it_is_written() {
        // Unix checks permissions at open(), so a temp file that was ever
        // readable by others could be read later through a kept descriptor.
        let dir = tempdir().unwrap();
        let tmp = write_temp(dir.path(), b"secret").unwrap();
        assert_eq!(mode_of(tmp.path()), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_new_app_state_private() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("recent.json");
        atomic_write(&target, b"[]").unwrap();
        assert_eq!(mode_of(&target), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_user_file_keeps_a_readable_files_mode() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("shared.md");
        fs::write(&target, b"old").unwrap();
        set_mode(&target, 0o644);
        atomic_write_user_file(&target, b"new").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        assert_eq!(mode_of(&target), 0o644);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_user_file_keeps_a_group_writable_files_mode() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("team.md");
        fs::write(&target, b"old").unwrap();
        set_mode(&target, 0o664);
        atomic_write_user_file(&target, b"new").unwrap();
        assert_eq!(mode_of(&target), 0o664);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_user_file_keeps_a_private_files_mode() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("private.md");
        fs::write(&target, b"old").unwrap();
        set_mode(&target, 0o600);
        atomic_write_user_file(&target, b"new").unwrap();
        assert_eq!(mode_of(&target), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_user_file_drops_setuid_and_friends() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("odd.md");
        fs::write(&target, b"old").unwrap();
        set_mode(&target, 0o4755);
        atomic_write_user_file(&target, b"new").unwrap();
        assert_eq!(mode_of(&target), 0o755);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_user_file_gives_a_new_file_the_usual_mode() {
        // Whatever the umask is, a new file should come out exactly as one
        // made by any other program in the same folder.
        let dir = tempdir().unwrap();
        let reference = dir.path().join("reference.md");
        fs::File::create(&reference).unwrap();
        let target = dir.path().join("new.md");
        atomic_write_user_file(&target, b"hello").unwrap();
        assert_eq!(mode_of(&target), mode_of(&reference));
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_user_file_does_not_copy_the_mode_through_a_symlink() {
        // /dev/null is 0666; a sidecar linked to it is replaced by an
        // ordinary file with a new file's mode, not a world-writable one.
        let dir = tempdir().unwrap();
        let reference = dir.path().join("reference.json");
        fs::File::create(&reference).unwrap();
        let target = dir.path().join("a.md.remarkdown.json");
        std::os::unix::fs::symlink("/dev/null", &target).unwrap();
        atomic_write_user_file(&target, b"{}").unwrap();
        assert!(fs::symlink_metadata(&target).unwrap().is_file());
        assert_eq!(mode_of(&target), mode_of(&reference));
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_user_file_keeps_a_linked_private_file_private() {
        // A journal linked into Documents from a private folder (dotfiles,
        // stow, a vault): the save replaces the link with an ordinary file,
        // which must not be readable by anyone the original wasn't.
        let vault = tempdir().unwrap();
        let original = vault.path().join("journal.md");
        fs::write(&original, b"old").unwrap();
        set_mode(&original, 0o600);
        let dir = tempdir().unwrap();
        let target = dir.path().join("journal.md");
        std::os::unix::fs::symlink(&original, &target).unwrap();
        atomic_write_user_file(&target, b"new").unwrap();
        assert!(fs::symlink_metadata(&target).unwrap().is_file());
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        assert_eq!(mode_of(&target), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_user_file_gives_a_link_no_more_than_a_new_files_mode() {
        // The file a link led to may be open to everyone; the ordinary file
        // that replaces the link here is no more open than a new one.
        let elsewhere = tempdir().unwrap();
        let original = elsewhere.path().join("open.md");
        fs::write(&original, b"old").unwrap();
        set_mode(&original, 0o666);
        let dir = tempdir().unwrap();
        let reference = dir.path().join("reference.md");
        fs::File::create(&reference).unwrap();
        let target = dir.path().join("open.md");
        std::os::unix::fs::symlink(&original, &target).unwrap();
        atomic_write_user_file(&target, b"new").unwrap();
        assert_eq!(mode_of(&target), mode_of(&reference));
    }
}
