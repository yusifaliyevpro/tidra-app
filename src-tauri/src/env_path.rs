use std::ffi::OsString;
use std::sync::OnceLock;

/// PATH as a new terminal would see it. The inherited one can be stale (Explorer started before a tool was
/// installed) or trimmed (launched from MSYS2 bash, or from a Linux/macOS desktop launcher that never ran the
/// shell's rc files), which hides tools like `%LOCALAPPDATA%\pnpm\bin` or `~/.local/share/pnpm`.
pub fn path() -> &'static OsString {
    static PATH: OnceLock<OsString> = OnceLock::new();
    PATH.get_or_init(|| {
        let inherited = std::env::var_os("PATH").unwrap_or_default();
        let mut entries: Vec<String> = system_entries();
        entries.extend(std::env::split_paths(&inherited).map(|p| p.to_string_lossy().into_owned()));
        std::env::join_paths(dedupe(entries, cfg!(windows))).unwrap_or(inherited)
    })
}

/// First occurrence wins; only Windows paths are case-insensitive.
fn dedupe(mut entries: Vec<String>, ignore_case: bool) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    entries.retain(|entry| {
        let key = entry.trim_end_matches(['\\', '/']);
        !entry.is_empty() && seen.insert(if ignore_case { key.to_lowercase() } else { key.to_string() })
    });
    entries
}

#[cfg(windows)]
fn system_entries() -> Vec<String> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let read =
        |root, key: &str| -> Option<String> { RegKey::predef(root).open_subkey(key).ok()?.get_value("Path").ok() };
    [
        read(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        read(HKEY_CURRENT_USER, "Environment"),
    ]
    .into_iter()
    .flatten()
    .flat_map(|value| value.split(';').map(expand).collect::<Vec<_>>())
    .collect()
}

/// The login shell's PATH (nvm, fnm, PNPM_HOME are set up in rc files), then common tool folders as a fallback.
#[cfg(not(windows))]
fn system_entries() -> Vec<String> {
    let mut entries: Vec<String> =
        shell_path().map(|path| path.split(':').map(String::from).collect()).unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) {
        let pnpm = std::env::var_os("PNPM_HOME").map(std::path::PathBuf::from);
        let folders = [".local/share/pnpm", "Library/pnpm", ".local/bin", ".bun/bin", ".volta/bin", ".cargo/bin"];
        entries.extend(
            pnpm.into_iter()
                .chain(folders.iter().map(|folder| home.join(folder)))
                .chain(["/opt/homebrew/bin", "/usr/local/bin"].map(std::path::PathBuf::from))
                .filter(|dir| dir.is_dir())
                .map(|dir| dir.to_string_lossy().into_owned()),
        );
    }
    entries
}

/// Runs `$SHELL -ilc` once, with a time limit so an rc file waiting for input can't hang the app.
#[cfg(not(windows))]
fn shell_path() -> Option<String> {
    use std::process::{Command, Stdio};
    const MARK: &str = "__TIDRA_PATH__";
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let child = Command::new(shell)
        .args(["-ilc", &format!("printf '{MARK}%s{MARK}' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let pid = child.id();
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || send.send(child.wait_with_output()));
    let Ok(Ok(output)) = receive.recv_timeout(std::time::Duration::from_secs(5)) else {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
        return None;
    };
    between_marks(&String::from_utf8_lossy(&output.stdout), MARK)
}

/// Markers skip anything the rc files print (banners, `fortune`).
#[cfg(any(test, not(windows)))]
fn between_marks(text: &str, mark: &str) -> Option<String> {
    let start = text.find(mark)? + mark.len();
    let end = start + text[start..].find(mark)?;
    Some(text[start..end].to_string())
}

/// Expands `%NAME%` from the current environment; unknown names stay as they are.
#[cfg(windows)]
fn expand(value: &str) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(found) if !name.is_empty() => out.push_str(&found),
                    _ => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn expands_known_variables_and_keeps_unknown() {
        let home = std::env::var("PATH").unwrap_or_default();
        assert_eq!(expand("%PATH%"), home);
        assert_eq!(expand(r"%TIDRA_SURELY_UNSET%\bin"), r"%TIDRA_SURELY_UNSET%\bin");
        assert_eq!(expand("plain;100%"), "plain;100%");
    }

    #[test]
    fn dedupes_case_insensitively_only_on_windows() {
        let entries = || {
            vec![
                r"C:\Tools".to_string(),
                r"c:\tools\".to_string(),
                String::new(),
                "/opt/Foo".to_string(),
                "/opt/foo".to_string(),
            ]
        };
        assert_eq!(dedupe(entries(), true), [r"C:\Tools", "/opt/Foo"]);
        assert_eq!(dedupe(entries(), false), [r"C:\Tools", r"c:\tools\", "/opt/Foo", "/opt/foo"]);
        assert_eq!(dedupe(vec!["/a/".into(), "/a".into()], false), ["/a/"]);
    }

    #[test]
    fn finds_the_path_between_marks_whatever_rc_files_print() {
        assert_eq!(between_marks("Welcome!\n__M__/usr/bin:/bin__M__bye", "__M__").as_deref(), Some("/usr/bin:/bin"));
        assert_eq!(between_marks("no marks here", "__M__"), None);
        assert_eq!(between_marks("__M__only one", "__M__"), None);
    }

    #[test]
    fn keeps_inherited_entries() {
        let inherited = std::env::var_os("PATH").unwrap_or_default();
        let merged: Vec<_> = std::env::split_paths(path()).collect();
        for entry in std::env::split_paths(&inherited).filter(|p| !p.as_os_str().is_empty()) {
            let key = entry.to_string_lossy().trim_end_matches('\\').to_lowercase();
            assert!(merged.iter().any(|m| m.to_string_lossy().trim_end_matches('\\').to_lowercase() == key));
        }
    }
}
