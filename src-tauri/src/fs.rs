use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    is_dir: bool,
}

#[tauri::command]
pub async fn fs_read_text(path: String) -> Result<Option<String>, String> {
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("{path}: {err}")),
    }
}

/// Writes through a sibling temp file and renames it, so a crash never leaves a half-written manifest.
#[tauri::command]
pub async fn fs_write_text(path: String, contents: String) -> Result<(), String> {
    write_atomic(Path::new(&path), &contents).await.map_err(|err| format!("{path}: {err}"))
}

async fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    // Through a symlink, not over it; and the new file keeps the old one's permissions.
    let target = tokio::fs::canonicalize(path).await.unwrap_or_else(|_| path.to_path_buf());
    let permissions = tokio::fs::metadata(&target).await.ok().map(|meta| meta.permissions());
    let tmp = temp_sibling(&target);
    tokio::fs::write(&tmp, contents).await?;
    let moved = async {
        if let Some(permissions) = permissions {
            tokio::fs::set_permissions(&tmp, permissions).await?;
        }
        tokio::fs::rename(&tmp, &target).await
    }
    .await;
    if moved.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    moved
}

#[tauri::command]
pub async fn fs_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    use std::io::ErrorKind::{NotFound, PermissionDenied};
    let mut dir = match tokio::fs::read_dir(&path).await {
        Ok(dir) => dir,
        // A folder we may not read (System Volume Information) is just empty; it must not fail a whole scan.
        Err(err) if matches!(err.kind(), NotFound | PermissionDenied) => return Ok(Vec::new()),
        Err(err) => return Err(format!("{path}: {err}")),
    };
    let mut entries = Vec::new();
    while let Some(entry) = dir.next_entry().await.map_err(|err| err.to_string())? {
        let is_dir = entry.file_type().await.map(|kind| kind.is_dir()).unwrap_or(false);
        entries.push(DirEntry { name: entry.file_name().to_string_lossy().into_owned(), is_dir });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub async fn fs_exists(path: String) -> bool {
    tokio::fs::try_exists(&path).await.unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEnv {
    home_dir: String,
    platform: &'static str,
    vars: std::collections::HashMap<String, String>,
}

/// The engine needs HOME for the user .npmrc and env vars for `${TOKEN}` expansion inside it.
#[tauri::command]
pub fn app_env() -> AppEnv {
    let home_dir = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    // vars() panics on a variable that isn't valid Unicode, which would take the whole app down at launch.
    let vars =
        std::env::vars_os().filter_map(|(key, value)| Some((key.into_string().ok()?, value.into_string().ok()?)));
    AppEnv { home_dir, platform: std::env::consts::OS, vars: vars.collect() }
}

pub fn temp_sibling(target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    target.with_file_name(format!(".{name}.tidra-tmp"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tidra-fs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> =
            std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[tokio::test]
    async fn writes_new_and_existing_files_without_leaving_a_temp_file() {
        let dir = temp_dir("write");
        let file = dir.join("package.json");
        write_atomic(&file, "one").await.unwrap();
        write_atomic(&file, "two").await.unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "two");
        assert_eq!(names(&dir), ["package.json"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn cleans_up_its_temp_file_when_the_rename_fails() {
        let dir = temp_dir("rename");
        let target = dir.join("taken");
        std::fs::create_dir(&target).unwrap();
        assert!(write_atomic(&target, "x").await.is_err());
        assert_eq!(names(&dir), ["taken"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn keeps_the_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("mode");
        let file = dir.join("run.sh");
        std::fs::write(&file, "old").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        write_atomic(&file, "new").await.unwrap();
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o755);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn writes_through_a_symlink() {
        let dir = temp_dir("link");
        let real = dir.join("real.json");
        let link = dir.join("link.json");
        std::fs::write(&real, "old").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        write_atomic(&link, "new").await.unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "new");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn reads_text_and_reports_a_missing_file_as_none() {
        let dir = temp_dir("read");
        let file = dir.join("a.txt");
        std::fs::write(&file, "héllo").unwrap();
        assert_eq!(fs_read_text(file.display().to_string()).await.unwrap().as_deref(), Some("héllo"));
        assert_eq!(fs_read_text(dir.join("none").display().to_string()).await.unwrap(), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn reports_a_file_that_isnt_text() {
        let dir = temp_dir("binary");
        let file = dir.join("a.bin");
        std::fs::write(&file, [0xff, 0xfe, 0x00]).unwrap();
        let err = fs_read_text(file.display().to_string()).await.unwrap_err();
        assert!(err.contains("a.bin"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn lists_a_folder_sorted_with_kinds_and_treats_a_missing_one_as_empty() {
        let dir = temp_dir("list");
        std::fs::write(dir.join("b.txt"), "").unwrap();
        std::fs::create_dir(dir.join("a")).unwrap();
        let entries = fs_read_dir(dir.display().to_string()).await.unwrap();
        let listed: Vec<_> = entries.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();
        assert_eq!(listed, [("a", true), ("b.txt", false)]);
        assert!(fs_read_dir(dir.join("none").display().to_string()).await.unwrap().is_empty());
        assert!(fs_exists(dir.display().to_string()).await);
        assert!(!fs_exists(dir.join("none").display().to_string()).await);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn app_env_reports_the_platform_and_environment() {
        let env = app_env();
        assert_eq!(env.platform, std::env::consts::OS);
        assert!(env.vars.contains_key("PATH") || env.vars.contains_key("Path"));
    }

    #[test]
    fn temp_sibling_stays_in_same_directory() {
        let tmp = temp_sibling(Path::new("/repo/package.json"));
        assert_eq!(tmp, Path::new("/repo/.package.json.tidra-tmp"));
    }
}
