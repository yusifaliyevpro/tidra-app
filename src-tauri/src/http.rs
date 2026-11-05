use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Deserialize)]
pub struct HttpRequest {
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    /// An npm package document: pass on only the fields Tidra reads (`trimPackument` in src/engine/registry.ts).
    #[serde(default)]
    packument: bool,
}

#[derive(Serialize)]
pub struct HttpResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

/// One pooled client: connections and TLS sessions are reused, which made GitHub calls about 3x faster than the
/// HTTP plugin's per-request client.
fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    // GitHub's API rejects requests without a User-Agent.
    CLIENT.get_or_init(|| {
        reqwest::Client::builder().user_agent("Tidra").timeout(Duration::from_secs(60)).build().unwrap_or_default()
    })
}

/// https everywhere; plain http only to this machine, for Ollama, LM Studio, Verdaccio and a local sqld.
fn allowed_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    match parsed.scheme() {
        "https" => true,
        "http" => match parsed.host_str() {
            Some(host) => {
                host == "localhost"
                    || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
                    || host == "[::1]"
            }
            None => false,
        },
        _ => false,
    }
}

/// The webview's network calls, one IPC round trip each. Responses arrive decompressed; npm package documents
/// (tens of MB for popular packages) are trimmed here, since passing them whole took seconds each.
#[tauri::command]
pub async fn http_fetch(request: HttpRequest) -> Result<HttpResponse, String> {
    if !allowed_url(&request.url) {
        return Err(format!("Only https URLs are allowed, or http to this machine: {}", request.url));
    }
    let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|err| err.to_string())?;
    let mut builder = client().request(method, &request.url);
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let response = builder.send().await.map_err(|err| err.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
        .collect();
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    let trimmed = if request.packument && status == 200 { trim(&bytes) } else { None };
    Ok(HttpResponse { status, headers, body: trimmed.unwrap_or_else(|| String::from_utf8_lossy(&bytes).into_owned()) })
}

fn trim(bytes: &[u8]) -> Option<String> {
    let Value::Object(mut doc) = serde_json::from_slice::<Value>(bytes).ok()? else {
        return None;
    };
    // Other registry answers (dist-tags) pass through untouched.
    if !doc.contains_key("versions") {
        return None;
    }
    let mut out = Map::new();
    for key in ["name", "dist-tags", "time", "repository"] {
        if let Some(value) = doc.remove(key) {
            out.insert(key.into(), value);
        }
    }
    let mut versions = Map::new();
    if let Some(Value::Object(all)) = doc.remove("versions") {
        for (version, meta) in all {
            let mut kept = Map::new();
            if let Value::Object(mut meta) = meta {
                for key in ["deprecated", "engines", "peerDependencies", "repository"] {
                    if let Some(value) = meta.remove(key) {
                        kept.insert(key.into(), value);
                    }
                }
            }
            versions.insert(version, Value::Object(kept));
        }
    }
    out.insert("versions".into(), Value::Object(versions));
    serde_json::to_string(&out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_https_anywhere_and_http_only_to_this_machine() {
        for url in [
            "https://registry.npmjs.org/a",
            "http://localhost:11434/v1",
            "http://127.0.0.1:4873/a",
            "http://[::1]:8080/",
        ] {
            assert!(allowed_url(url), "{url}");
        }
        for url in [
            "http://registry.npmjs.org/a",
            "http://localhost.evil.com/",
            "http://10.0.0.1/",
            "file:///etc/passwd",
            "ftp://x",
            "nope",
        ] {
            assert!(!allowed_url(url), "{url}");
        }
    }

    /// Answers one request with a fixed response on a local port and returns the raw request it got.
    async fn serve_once(response: String) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/doc", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let n = socket.read(&mut buf).await.unwrap();
            socket.write_all(response.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (url, task)
    }

    fn http(status: &str, extra: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n{extra}\r\n{body}", body.len())
    }

    fn get(url: String, packument: bool) -> HttpRequest {
        HttpRequest { method: "GET".into(), url, headers: HashMap::new(), body: None, packument }
    }

    const DOC: &str = r#"{"name":"a","readme":"long","versions":{"1.0.0":{"dist":{"tarball":"x"}}}}"#;

    #[tokio::test]
    async fn fetch_returns_status_headers_and_body() {
        let (url, server) = serve_once(http("200 OK", "etag: \"e1\"\r\n", "hello")).await;
        let mut request = get(url, false);
        request.method = "POST".into();
        request.body = Some("payload".into());
        request.headers.insert("x-test".into(), "yes".into());
        let response = http_fetch(request).await.unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, "hello");
        assert!(response.headers.iter().any(|(k, v)| k == "etag" && v == "\"e1\""));
        let raw = server.await.unwrap().to_lowercase();
        assert!(raw.starts_with("post /doc"));
        assert!(raw.contains("x-test: yes"));
        assert!(raw.contains("user-agent: tidra"));
        assert!(raw.contains("accept-encoding") && raw.contains("gzip"));
        assert!(raw.ends_with("payload"));
    }

    #[tokio::test]
    async fn fetch_trims_package_documents_only_when_asked() {
        let (url, _server) = serve_once(http("200 OK", "", DOC)).await;
        let trimmed = http_fetch(get(url, true)).await.unwrap();
        assert!(!trimmed.body.contains("tarball") && !trimmed.body.contains("readme"));
        let (url, _server) = serve_once(http("200 OK", "", DOC)).await;
        assert_eq!(http_fetch(get(url, false)).await.unwrap().body, DOC);
    }

    #[tokio::test]
    async fn fetch_passes_errors_and_empty_answers_through() {
        let (url, _server) = serve_once(http("404 Not Found", "", "nope")).await;
        let missing = http_fetch(get(url, true)).await.unwrap();
        assert_eq!((missing.status, missing.body.as_str()), (404, "nope"));
        let (url, _server) = serve_once(http("304 Not Modified", "", "")).await;
        let same = http_fetch(get(url, true)).await.unwrap();
        assert_eq!((same.status, same.body.as_str()), (304, ""));
    }

    #[tokio::test]
    async fn fetch_refuses_plain_http_elsewhere() {
        let err = http_fetch(get("http://example.com/".into(), false)).await.err().unwrap();
        assert!(err.contains("Only https"));
    }

    #[tokio::test]
    async fn fetch_reports_a_refused_connection() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        drop(listener);
        assert!(http_fetch(get(url, false)).await.is_err());
    }

    #[test]
    fn keeps_only_the_fields_tidra_reads() {
        let doc = br#"{"name":"react","readme":"long","dist-tags":{"latest":"19.3.1"},
            "versions":{"19.3.1":{"dist":{"tarball":"x"},"dependencies":{"a":"1"},"peerDependencies":{"b":"^1"},"deprecated":"no"}}}"#;
        let trimmed: Value = serde_json::from_str(&trim(doc).unwrap()).unwrap();
        assert_eq!(
            trimmed,
            serde_json::json!({
                "name": "react",
                "dist-tags": { "latest": "19.3.1" },
                "versions": { "19.3.1": { "peerDependencies": { "b": "^1" }, "deprecated": "no" } }
            })
        );
    }

    #[test]
    fn leaves_documents_that_are_not_objects_alone() {
        assert_eq!(trim(b"[1]"), None);
        assert_eq!(trim(br#"{"latest":"19.3.1"}"#), None);
        assert_eq!(trim(b"not json"), None);
    }
}
