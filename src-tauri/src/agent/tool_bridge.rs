// Bridge that lets MCP tool handlers running in Rust dispatch ReelsState
// actions (which live in React) and await the result. Same shape as the
// approval bridge in approval.rs — one HashMap of oneshot senders keyed by
// call id, plus a Tauri command that the front-end calls to deliver the
// answer.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

const TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize)]
pub struct ToolCallRequest {
    pub call_id: String,
    /// Reducer action type — must match a `case` in reelsStudio/reducer.ts.
    pub action_type: String,
    /// Full action payload as JSON. Front-end merges `type: action_type`
    /// with these fields before dispatching.
    pub payload: serde_json::Value,
}

pub type ToolCallResult = Result<serde_json::Value, String>;

#[derive(Debug, Default)]
pub struct PendingToolCalls {
    inner: Arc<StdMutex<HashMap<String, oneshot::Sender<ToolCallResult>>>>,
}

impl Clone for PendingToolCalls {
    fn clone(&self) -> Self {
        Self { inner: Arc::clone(&self.inner) }
    }
}

impl PendingToolCalls {
    pub fn new() -> Self {
        Self::default()
    }

    fn register(&self, id: String) -> oneshot::Receiver<ToolCallResult> {
        let (tx, rx) = oneshot::channel();
        let mut guard = self.inner.lock().expect("pending tool calls poisoned");
        guard.insert(id, tx);
        rx
    }

    fn resolve(&self, id: &str, result: ToolCallResult) -> bool {
        let sender_opt = {
            let mut guard = self.inner.lock().expect("pending tool calls poisoned");
            guard.remove(id)
        };
        match sender_opt {
            Some(tx) => tx.send(result).is_ok(),
            None => false,
        }
    }
}

/// Ask the React side to dispatch a reducer action and return whatever the
/// front-end considers the result (typically the new block or a summary
/// object). Blocks until the front-end calls `agent_tool_result`.
pub async fn dispatch_to_react(
    app: &AppHandle,
    pending: &PendingToolCalls,
    action_type: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let call_id = super::claude_subprocess::uuid_v4_simple();
    let rx = pending.register(call_id.clone());

    let _ = app.emit(
        "reels://tool-call",
        ToolCallRequest {
            call_id: call_id.clone(),
            action_type: action_type.to_string(),
            payload,
        },
    );

    match tokio::time::timeout(TOOL_CALL_TIMEOUT, rx).await {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(_)) => Err("Tool call sender dropped (app shutdown?)".into()),
        Err(_) => {
            let _ = pending.resolve(
                &call_id,
                Err("Timeout (front-end não respondeu em 2 min)".into()),
            );
            Err("Timeout (front-end não respondeu em 2 min)".into())
        }
    }
}

/// Tauri command: React calls this after dispatching the reducer action to
/// hand the result back to the awaiting MCP tool handler.
#[tauri::command]
pub fn agent_tool_result(
    call_id: String,
    ok: bool,
    value: Option<serde_json::Value>,
    error: Option<String>,
    pending: State<'_, PendingToolCalls>,
) -> Result<bool, String> {
    let result: ToolCallResult = if ok {
        Ok(value.unwrap_or(serde_json::Value::Null))
    } else {
        Err(error.unwrap_or_else(|| "Erro desconhecido".into()))
    };
    Ok(pending.resolve(&call_id, result))
}
