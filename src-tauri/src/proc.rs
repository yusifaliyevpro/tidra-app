use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::State;
use tauri::ipc::Channel;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::oneshot;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProcEvent {
    Stdout { data: String },
    Stderr { data: String },
    Exit { code: Option<i32> },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnRequest {
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
}

#[derive(Default)]
pub struct Processes {
    next_id: AtomicU32,
    kills: Mutex<HashMap<u32, oneshot::Sender<()>>>,
}

/// Resolves a bare program name through PATH (and PATHEXT on Windows) so `.cmd` shims like `pnpm.cmd` run.
pub fn resolve_program(program: &str) -> Result<PathBuf, String> {
    which::which(program).map_err(|_| format!("`{program}` was not found on PATH"))
}

/// Length of the longest prefix of `buf` that ends on a UTF-8 character boundary.
pub fn utf8_boundary(buf: &[u8]) -> usize {
    match std::str::from_utf8(buf) {
        Ok(_) => buf.len(),
        Err(err) if err.error_len().is_none() => err.valid_up_to(),
        Err(_) => buf.len(),
    }
}

async fn pump<R: AsyncRead + Unpin>(mut reader: R, channel: Channel<ProcEvent>, stderr: bool) {
    let mut buf = vec![0u8; 16 * 1024];
    let mut carry: Vec<u8> = Vec::new();
    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        carry.extend_from_slice(&buf[..n]);
        let cut = utf8_boundary(&carry);
        if cut == 0 {
            continue;
        }
        let data = String::from_utf8_lossy(&carry[..cut]).into_owned();
        carry.drain(..cut);
        let event = if stderr { ProcEvent::Stderr { data } } else { ProcEvent::Stdout { data } };
        if channel.send(event).is_err() {
            break;
        }
    }
    if !carry.is_empty() {
        let data = String::from_utf8_lossy(&carry).into_owned();
        let _ = channel.send(if stderr { ProcEvent::Stderr { data } } else { ProcEvent::Stdout { data } });
    }
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill").args(["-TERM", &format!("-{pid}")]).status();
    }
}

#[tauri::command]
pub async fn proc_spawn(
    request: SpawnRequest,
    on_event: Channel<ProcEvent>,
    state: State<'_, Processes>,
) -> Result<u32, String> {
    let program = resolve_program(&request.program)?;
    let mut command = Command::new(program);
    command.args(&request.args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    if let Some(cwd) = &request.cwd {
        command.current_dir(cwd);
    }
    if let Some(env) = &request.env {
        command.envs(env);
    }
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    #[cfg(unix)]
    command.process_group(0);

    let mut child = command.spawn().map_err(|err| err.to_string())?;
    let pid = child.id().unwrap_or_default();
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let (kill_tx, kill_rx) = oneshot::channel();
    state.kills.lock().map_err(|err| err.to_string())?.insert(id, kill_tx);

    let stdout = child.stdout.take().map(|out| tokio::spawn(pump(out, on_event.clone(), false)));
    let stderr = child.stderr.take().map(|err| tokio::spawn(pump(err, on_event.clone(), true)));

    tauri::async_runtime::spawn(async move {
        let status = tokio::select! {
            status = child.wait() => status.ok(),
            _ = kill_rx => {
                kill_tree(pid);
                child.wait().await.ok()
            }
        };
        for task in [stdout, stderr].into_iter().flatten() {
            let _ = task.await;
        }
        let _ = on_event.send(ProcEvent::Exit { code: status.and_then(|s| s.code()) });
    });

    Ok(id)
}

#[tauri::command]
pub fn proc_kill(id: u32, state: State<'_, Processes>) -> Result<(), String> {
    if let Some(tx) = state.kills.lock().map_err(|err| err.to_string())?.remove(&id) {
        let _ = tx.send(());
    }
    Ok(())
}

/// Kills any process by pid, used to free a port held by a process Tidra did not start.
#[tauri::command]
pub fn process_kill(pid: u32) {
    kill_tree(pid);
}

#[tauri::command]
pub fn proc_which(program: String) -> Option<String> {
    resolve_program(&program).ok().map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundary_keeps_complete_text() {
        assert_eq!(utf8_boundary("héllo".as_bytes()), "héllo".len());
    }

    #[test]
    fn boundary_holds_back_split_character() {
        let bytes = "ok ✓".as_bytes();
        assert_eq!(utf8_boundary(&bytes[..bytes.len() - 1]), 3);
    }

    #[test]
    fn boundary_passes_invalid_bytes_through() {
        assert_eq!(utf8_boundary(&[b'a', 0xff, b'b']), 3);
    }

    #[test]
    fn resolves_known_program() {
        let program = if cfg!(windows) { "cmd" } else { "sh" };
        assert!(resolve_program(program).is_ok());
    }

    #[test]
    fn reports_missing_program() {
        let err = resolve_program("tidra-definitely-missing-binary").unwrap_err();
        assert!(err.contains("not found"));
    }
}
