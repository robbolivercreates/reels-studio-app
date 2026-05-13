// Generic in-chat picker bridge.
//
// Some MCP tools need a visual decision from the user — pick an avatar photo,
// choose a voice, select a style preset, etc. Pure text Q&A is awkward for
// these. This module is a sibling of `approval.rs`: a tool calls
// `request_picker`, we emit a `agent://picker-request` event with thumbnails
// + labels, the React side renders a `PickerCard` in the chat, the user
// clicks an option, and `agent_picker_result` resolves the awaiting tool.
//
// Pickers are intentionally fire-and-forget from the tool's POV — the tool
// awaits one `PickerOption.id` and continues from there.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

/// Default time we wait for the user to pick. Long enough for them to
/// switch apps and come back, short enough that a forgotten card doesn't
/// pin the agent forever.
const PICKER_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Serialize)]
pub struct PickerOption {
    /// Stable id returned to the tool when this option is chosen.
    pub id: String,
    /// Primary label shown on the card.
    pub label: String,
    /// Optional secondary line (e.g. "TalkingID", "23s preview").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Optional `data:` URL or absolute path used to render a thumbnail.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    /// Optional pill text (e.g. "novo", "padrão").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PickerRequest {
    pub picker_id: String,
    /// Drives the React renderer's layout. Today: 'photo' | 'voice' |
    /// 'preset' | 'generic'. Front-end falls back to 'generic' on unknown.
    pub kind: String,
    /// Short headline ("Qual photo usar?").
    pub title: String,
    /// Optional sub-headline / instruction.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub options: Vec<PickerOption>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PickerDecision {
    /// The `id` of the chosen option, or `null` when the user cancels.
    #[serde(default)]
    pub option_id: Option<String>,
}

#[derive(Debug, Default)]
pub struct PendingPickers {
    inner: Arc<StdMutex<HashMap<String, oneshot::Sender<PickerDecision>>>>,
}

impl Clone for PendingPickers {
    fn clone(&self) -> Self {
        Self { inner: Arc::clone(&self.inner) }
    }
}

impl PendingPickers {
    pub fn new() -> Self {
        Self::default()
    }

    fn register(&self, id: String) -> oneshot::Receiver<PickerDecision> {
        let (tx, rx) = oneshot::channel();
        let mut guard = self.inner.lock().expect("pickers mutex poisoned");
        guard.insert(id, tx);
        rx
    }

    fn resolve(&self, id: &str, decision: PickerDecision) -> bool {
        let sender = {
            let mut guard = self.inner.lock().expect("pickers mutex poisoned");
            guard.remove(id)
        };
        match sender {
            Some(tx) => tx.send(decision).is_ok(),
            None => false,
        }
    }
}

/// Request the user to pick one option visually. Returns the chosen option
/// id, or `None` on cancel/timeout. The caller decides what "None" means.
pub async fn request_picker(
    app: &AppHandle,
    pending: &PendingPickers,
    kind: &str,
    title: &str,
    subtitle: Option<&str>,
    options: Vec<PickerOption>,
) -> Option<String> {
    let picker_id = super::claude_subprocess::uuid_v4_simple();
    let rx = pending.register(picker_id.clone());

    let _ = app.emit(
        "agent://picker-request",
        PickerRequest {
            picker_id: picker_id.clone(),
            kind: kind.to_string(),
            title: title.to_string(),
            subtitle: subtitle.map(|s| s.to_string()),
            options,
        },
    );

    match tokio::time::timeout(PICKER_TIMEOUT, rx).await {
        Ok(Ok(decision)) => decision.option_id,
        Ok(Err(_)) => None,
        Err(_) => {
            // Cleanup so a late answer doesn't leak.
            let _ = pending.resolve(&picker_id, PickerDecision { option_id: None });
            None
        }
    }
}

/// Tauri command: React calls this when the user clicks an option.
#[tauri::command]
pub fn agent_picker_result(
    picker_id: String,
    option_id: Option<String>,
    pending: State<'_, PendingPickers>,
) -> Result<bool, String> {
    Ok(pending.resolve(&picker_id, PickerDecision { option_id }))
}
