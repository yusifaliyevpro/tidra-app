use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::State;
use tauri::ipc::Channel;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

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
    kills: Arc<Mutex<HashMap<u32, oneshot::Sender<()>>>>,
}

impl Processes {
    fn register(&self) -> Result<(u32, oneshot::Receiver<()>), String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (kill_tx, kill_rx) = oneshot::channel();
        self.kills.lock().map_err(|err| err.to_string())?.insert(id, kill_tx);
        Ok((id, kill_rx))
    }

    fn kill(&self, id: u32) -> Result<(), String> {
        if let Some(tx) = self.kills.lock().map_err(|err| err.to_string())?.remove(&id) {
            let _ = tx.send(());
        }
        Ok(())
    }
}

/// Every spawn registers a kill switch; without this the map grows by one per git call for the whole session.
fn forget(kills: &Mutex<HashMap<u32, oneshot::Sender<()>>>, id: u32) {
    if let Ok(mut kills) = kills.lock() {
        kills.remove(&id);
    }
}

/// Resolves a bare program name through PATH (and PATHEXT on Windows) so `.cmd` shims like `pnpm.cmd` run.
/// The answer is kept while the file exists: searching PATH costs about as much as a quick git command itself.
pub fn resolve_program(program: &str) -> Result<PathBuf, String> {
    static RESOLVED: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
    let resolved = RESOLVED.get_or_init(Mutex::default);
    if let Some(path) = resolved.lock().map_err(|err| err.to_string())?.get(program).filter(|path| path.is_file()) {
        return Ok(path.clone());
    }
    let cwd = std::env::current_dir().map_err(|err| err.to_string())?;
    let path = which::which_in(program, Some(crate::env_path::path()), cwd)
        .map_err(|_| format!("`{program}` was not found on PATH"))?;
    resolved.lock().map_err(|err| err.to_string())?.insert(program.to_string(), path.clone());
    Ok(path)
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

/// A helper the child started (git's credential manager, background maintenance) can inherit its pipes and hold them
/// open long after it exits, so output gets a short grace period instead of holding back the exit event forever.
const PIPE_GRACE: Duration = Duration::from_secs(2);

async fn drain_pipes(tasks: Vec<JoinHandle<()>>, grace: Duration) {
    let aborts: Vec<_> = tasks.iter().map(JoinHandle::abort_handle).collect();
    if tokio::time::timeout(grace, join_all(tasks)).await.is_err() {
        aborts.iter().for_each(|abort| abort.abort());
    }
}

async fn join_all(tasks: Vec<JoinHandle<()>>) {
    for task in tasks {
        let _ = task.await;
    }
}

/// How long a stopped process gets to exit on its own before it is killed outright.
const STOP_GRACE: Duration = Duration::from_secs(5);

fn kill_tree(pid: u32, force: bool) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = force;
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(unix)]
    {
        let signal = if force { "-KILL" } else { "-TERM" };
        let _ = std::process::Command::new("kill").args([signal, &format!("-{pid}")]).status();
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
    command.env("PATH", crate::env_path::path());
    if let Some(env) = &request.env {
        command.envs(env);
    }
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    #[cfg(unix)]
    command.process_group(0);

    let mut child = command.spawn().map_err(|err| err.to_string())?;
    let pid = child.id().unwrap_or_default();
    let (id, kill_rx) = state.register()?;
    let kills = state.kills.clone();

    let stdout = child.stdout.take().map(|out| tokio::spawn(pump(out, on_event.clone(), false)));
    let stderr = child.stderr.take().map(|err| tokio::spawn(pump(err, on_event.clone(), true)));

    tauri::async_runtime::spawn(async move {
        let status = tokio::select! {
            status = child.wait() => status.ok(),
            _ = kill_rx => {
                kill_tree(pid, false);
                match tokio::time::timeout(STOP_GRACE, child.wait()).await {
                    Ok(status) => status.ok(),
                    Err(_) => {
                        kill_tree(pid, true);
                        child.wait().await.ok()
                    }
                }
            }
        };
        forget(&kills, id);
        drain_pipes([stdout, stderr].into_iter().flatten().collect(), PIPE_GRACE).await;
        let _ = on_event.send(ProcEvent::Exit { code: status.and_then(|s| s.code()) });
    });

    Ok(id)
}

#[tauri::command]
pub fn proc_kill(id: u32, state: State<'_, Processes>) -> Result<(), String> {
    state.kill(id)
}

/// Kills any process by pid, used to free a port held by a process Tidra did not start.
#[tauri::command(async)]
pub fn process_kill(pid: u32) {
    #[cfg(windows)]
    kill_tree(pid, true);
    // Not one of ours, so it doesn't lead a process group the way kill_tree expects.
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
}

#[tauri::command(async)]
pub fn proc_which(program: String) -> Option<String> {
    resolve_program(&program).ok().map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn exit_is_not_held_back_by_a_pipe_that_never_closes() {
        let stuck = tokio::spawn(std::future::pending::<()>());
        let done = tokio::spawn(async {});
        let drained =
            tokio::time::timeout(Duration::from_secs(1), drain_pipes(vec![stuck, done], Duration::from_millis(50)))
                .await;
        assert!(drained.is_ok());
    }

    use tauri::ipc::InvokeResponseBody;
    use tokio::io::AsyncWriteExt;

    type Events = Arc<Mutex<Vec<String>>>;

    fn recording_channel() -> (Channel<ProcEvent>, Events) {
        let events: Events = Arc::default();
        let sink = events.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(json);
            }
            Ok(())
        });
        (channel, events)
    }

    #[tokio::test]
    async fn pump_never_splits_a_character_across_events() {
        let (channel, events) = recording_channel();
        let (mut writer, reader) = tokio::io::duplex(64);
        let task = tokio::spawn(pump(reader, channel, false));
        let bytes = "ok ✓".as_bytes();
        writer.write_all(&bytes[..4]).await.unwrap();
        writer.flush().await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        writer.write_all(&bytes[4..]).await.unwrap();
        drop(writer);
        task.await.unwrap();
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert!(events[0].contains(r#""kind":"stdout""#) && events[0].contains(r#""data":"ok ""#));
        assert!(events[1].contains('✓'));
    }

    #[tokio::test]
    async fn pump_flushes_a_cut_off_character_at_the_end_and_tags_stderr() {
        let (channel, events) = recording_channel();
        let (mut writer, reader) = tokio::io::duplex(64);
        let task = tokio::spawn(pump(reader, channel, true));
        writer.write_all(&"✓".as_bytes()[..2]).await.unwrap();
        drop(writer);
        task.await.unwrap();
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert!(events[0].contains(r#""kind":"stderr""#));
    }

    #[tokio::test]
    async fn kill_reaches_the_process_and_forget_clears_its_switch() {
        let processes = Processes::default();
        let (first, kill_rx) = processes.register().unwrap();
        let (second, _keep) = processes.register().unwrap();
        assert_ne!(first, second);
        processes.kill(first).unwrap();
        assert!(kill_rx.await.is_ok());
        processes.kill(first).unwrap();
        assert_eq!(processes.kills.lock().unwrap().len(), 1);
        forget(&processes.kills, second);
        assert!(processes.kills.lock().unwrap().is_empty());
    }

    #[test]
    fn events_serialize_the_way_the_webview_reads_them() {
        let exit = serde_json::to_string(&ProcEvent::Exit { code: Some(3) }).unwrap();
        assert_eq!(exit, r#"{"kind":"exit","code":3}"#);
        let out = serde_json::to_string(&ProcEvent::Stdout { data: "x".into() }).unwrap();
        assert_eq!(out, r#"{"kind":"stdout","data":"x"}"#);
    }

    #[test]
    fn spawn_requests_read_camel_case_and_optional_fields() {
        let request: SpawnRequest = serde_json::from_str(r#"{"program":"git","args":["status"]}"#).unwrap();
        assert_eq!(request.program, "git");
        assert_eq!(request.args, ["status"]);
        assert!(request.cwd.is_none() && request.env.is_none());
    }

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
    fn resolving_again_gives_the_same_program() {
        let program = if cfg!(windows) { "cmd" } else { "sh" };
        assert_eq!(resolve_program(program), resolve_program(program));
    }

    #[test]
    fn reports_missing_program() {
        let err = resolve_program("tidra-definitely-missing-binary").unwrap_err();
        assert!(err.contains("not found"));
    }
}
