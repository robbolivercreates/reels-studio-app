// Shared state for the embedded MCP server + agent runtime.
//
// The React side owns the canonical ReelsState reducer. For tools that need
// to *read* state (list_blocks, read_block, etc.) we don't want to round-trip
// every call back to JS — that adds 50-200ms per tool call and would make
// "liste os blocos" feel sluggish. Instead, React publishes a serialized
// snapshot to Rust via `agent_publish_state` every time relevant state
// changes (debounced), and read-only tools answer from this snapshot.
//
// Tools that *mutate* state still RPC back to React via Tauri events — the
// reducer can't run on the Rust side.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

/// Snapshot of the parts of ReelsState the agent needs to reason about.
/// Mirrors the JSON shape published by the React side; fields that the
/// agent doesn't care about are omitted to keep the payload small.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReelsSnapshot {
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub aspect: Option<String>,
    pub voice_id: Option<String>,
    pub blocks: Vec<BlockSnapshot>,
    pub audio: Option<AudioSnapshot>,
    pub analyses: Vec<AnalysisSnapshot>,
    /// Monotonic version so write-tools can detect stale snapshots.
    #[serde(default)]
    pub version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockSnapshot {
    pub id: String,
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub layout: Option<String>,
    #[serde(default)]
    pub duration_sec: Option<f64>,
    #[serde(default)]
    pub start_sec: Option<f64>,
    #[serde(default)]
    pub end_sec: Option<f64>,
    #[serde(default)]
    pub asset_count: u32,
    #[serde(default)]
    pub has_motion: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioSnapshot {
    pub status: String,
    #[serde(default)]
    pub duration_sec: Option<f64>,
    #[serde(default)]
    pub silence_cut_on: bool,
    #[serde(default)]
    pub silence_preset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisSnapshot {
    pub created_at: i64,
    #[serde(default)]
    pub source_file: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub tone: Option<String>,
}

/// AgentState is the Tauri-managed singleton holding everything the agent
/// subsystem needs. Wrapped in a std::sync::Mutex (not tokio) because most
/// access is short-lived field reads; we never hold the lock across awaits.
#[derive(Debug, Default)]
pub struct AgentStateInner {
    pub mcp_port: Option<u16>,
    pub snapshot: ReelsSnapshot,
}

#[derive(Debug, Default, Clone)]
pub struct AgentState {
    inner: Arc<Mutex<AgentStateInner>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_mcp_port(&self, port: u16) {
        let mut guard = self.inner.lock().expect("agent state poisoned");
        guard.mcp_port = Some(port);
    }

    pub fn mcp_port(&self) -> Option<u16> {
        self.inner.lock().expect("agent state poisoned").mcp_port
    }

    pub fn replace_snapshot(&self, mut snapshot: ReelsSnapshot) {
        let mut guard = self.inner.lock().expect("agent state poisoned");
        // Bump version on every replace so future "stale snapshot" checks
        // can compare; React side may also set its own version, we honor
        // whichever is larger to avoid going backwards.
        let next = guard.snapshot.version.saturating_add(1);
        if snapshot.version < next {
            snapshot.version = next;
        }
        guard.snapshot = snapshot;
    }

    pub fn snapshot(&self) -> ReelsSnapshot {
        self.inner.lock().expect("agent state poisoned").snapshot.clone()
    }
}
