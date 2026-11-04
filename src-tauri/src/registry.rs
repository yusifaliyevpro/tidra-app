use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Serialize)]
pub struct RegistryResponse {
    status: u16,
    etag: Option<String>,
    body: String,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| reqwest::Client::builder().timeout(Duration::from_secs(60)).build().unwrap_or_default())
}

/// Downloads an npm package document, compressed, and passes only the fields Tidra reads to the webview
/// (`trimPackument` in src/engine/registry.ts). Whole documents run to tens of MB and took seconds each over IPC.
#[tauri::command]
pub async fn registry_fetch(url: String, headers: HashMap<String, String>) -> Result<RegistryResponse, String> {
    let mut request = client().get(&url);
    for (name, value) in &headers {
        request = request.header(name, value);
    }
    let response = request.send().await.map_err(|err| err.to_string())?;
    let status = response.status().as_u16();
    let etag = response.headers().get("etag").and_then(|value| value.to_str().ok()).map(String::from);
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    let body = if status == 200 { trim(&bytes) } else { None };
    Ok(RegistryResponse { status, etag, body: body.unwrap_or_else(|| String::from_utf8_lossy(&bytes).into_owned()) })
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
