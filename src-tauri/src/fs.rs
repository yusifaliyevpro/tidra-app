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
    let target = PathBuf::from(&path);
    let tmp = temp_sibling(&target);
    tokio::fs::write(&tmp, contents).await.map_err(|err| format!("{path}: {err}"))?;
    tokio::fs::rename(&tmp, &target).await.map_err(|err| format!("{path}: {err}"))
}

#[tauri::command]
pub async fn fs_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut dir = match tokio::fs::read_dir(&path).await {
        Ok(dir) => dir,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
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
    AppEnv { home_dir, platform: std::env::consts::OS, vars: std::env::vars().collect() }
}

pub fn temp_sibling(target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    target.with_file_name(format!(".{name}.tidra-tmp"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_sibling_stays_in_same_directory() {
        let tmp = temp_sibling(Path::new("/repo/package.json"));
        assert_eq!(tmp, Path::new("/repo/.package.json.tidra-tmp"));
    }
}
