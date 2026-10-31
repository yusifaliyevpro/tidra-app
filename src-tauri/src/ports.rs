use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Listener {
    port: u16,
    pid: u32,
    process: String,
    address: String,
}

/// One row per port and pid, lowest port first, since dual-stack sockets report the same port twice.
pub fn dedupe(raw: Vec<Listener>) -> Vec<Listener> {
    let mut map: BTreeMap<(u16, u32), Listener> = BTreeMap::new();
    for listener in raw {
        map.entry((listener.port, listener.pid)).or_insert(listener);
    }
    map.into_values().collect()
}

#[tauri::command]
pub fn ports_list() -> Result<Vec<Listener>, String> {
    let all = listeners::get_all().map_err(|err| err.to_string())?;
    let raw = all
        .into_iter()
        .filter(|l| l.protocol == listeners::Protocol::TCP)
        .map(|l| Listener {
            port: l.socket.port(),
            pid: l.process.pid,
            process: l.process.name,
            address: l.socket.ip().to_string(),
        })
        .collect();
    Ok(dedupe(raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listener(port: u16, pid: u32, address: &str) -> Listener {
        Listener { port, pid, process: "node".into(), address: address.into() }
    }

    #[test]
    fn dedupes_dual_stack_sockets_and_sorts() {
        let rows = dedupe(vec![listener(5173, 7, "::"), listener(3000, 9, "0.0.0.0"), listener(5173, 7, "0.0.0.0")]);
        assert_eq!(rows, vec![listener(3000, 9, "0.0.0.0"), listener(5173, 7, "::")]);
    }
}
