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

/// The webview's network calls, one IPC round trip each. Responses arrive decompressed; npm package documents
/// (tens of MB for popular packages) are trimmed here, since passing them whole took seconds each.
#[tauri::command]
pub async fn http_fetch(request: HttpRequest) -> Result<HttpResponse, String> {
    if !request.url.starts_with("https://") {
        return Err(format!("Only https URLs are allowed: {}", request.url));
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
