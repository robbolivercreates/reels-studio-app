// Human-in-the-loop approval bridge.
//
// Claude Code is launched with `--permission-prompt-tool mcp__reels__request_user_approval`.
// When the model attempts a tool that isn't in the auto-allowed list (i.e.
// any write tool), the runtime calls *this* tool instead of executing the
// target tool directly. We surface the request to the React UI via a Tauri
// event, the user clicks Allow/Reject in <ApprovalCard>, and we hand the
// answer back through a oneshot channel.
//
// Contract expected by Claude Code (from cli-reference docs):
//   - The tool MUST return a structured response describing the decision.
//   - Approved → return JSON {"behavior":"allow","updatedInput":<args>} so
//     the original tool is invoked with (possibly edited) inputs.
//   - Rejected → return {"behavior":"deny","message":"<reason>"} so the
//     model sees why and can adapt.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

/// Default approval timeout. If the user ignores the card for this long we
/// auto-reject so the model doesn't sit forever.
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Serialize)]
pub struct ApprovalRequest {
    pub approval_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApprovalDecision {
    pub allow: bool,
    #[serde(default)]
    pub reason: Option<String>,
    /// Optional edits the user wants to apply to the tool input before
    /// approving. PR2 doesn't surface this in the UI yet — wired for PR3.
    #[serde(default)]
    pub updated_input: Option<serde_json::Value>,
}

#[derive(Debug, Default)]
pub struct PendingApprovals {
    inner: Arc<StdMutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>>,
}

impl Clone for PendingApprovals {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl PendingApprovals {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a fresh approval request. Returns the receiver the caller
    /// will await for the user's decision.
    pub fn register(&self, id: String) -> oneshot::Receiver<ApprovalDecision> {
        let (tx, rx) = oneshot::channel();
        let mut guard = self
            .inner
            .lock()
            .expect("pending approvals mutex poisoned");
        guard.insert(id, tx);
        rx
    }

    /// Resolve a pending approval. Returns true if a matching request was
    /// waiting; false (and the decision is dropped) otherwise.
    pub fn resolve(&self, id: &str, decision: ApprovalDecision) -> bool {
        let sender_opt = {
            let mut guard = self
                .inner
                .lock()
                .expect("pending approvals mutex poisoned");
            guard.remove(id)
        };
        match sender_opt {
            Some(tx) => tx.send(decision).is_ok(),
            None => false,
        }
    }
}

/// Request approval from the user. Emits an event so the React UI can
/// render <ApprovalCard>; blocks (awaits) until the user clicks Allow/Reject
/// (or the timeout fires).
pub async fn request_approval(
    app: &AppHandle,
    pending: &PendingApprovals,
    tool_name: String,
    tool_input: serde_json::Value,
) -> ApprovalDecision {
    let approval_id = super::claude_subprocess::uuid_v4_simple();
    let rx = pending.register(approval_id.clone());

    let _ = app.emit(
        "agent://approval-request",
        ApprovalRequest {
            approval_id: approval_id.clone(),
            tool_name: tool_name.clone(),
            tool_input,
        },
    );

    match tokio::time::timeout(APPROVAL_TIMEOUT, rx).await {
        Ok(Ok(decision)) => decision,
        Ok(Err(_)) => ApprovalDecision {
            allow: false,
            reason: Some("Sender dropped (app shutdown?)".to_string()),
            updated_input: None,
        },
        Err(_) => {
            // Timeout. Clean up the registry entry.
            let _ = pending.resolve(
                &approval_id,
                ApprovalDecision {
                    allow: false,
                    reason: Some("Timeout (5 min sem resposta).".to_string()),
                    updated_input: None,
                },
            );
            ApprovalDecision {
                allow: false,
                reason: Some("Timeout (5 min sem resposta).".to_string()),
                updated_input: None,
            }
        }
    }
}

/// Tauri command called from React when the user clicks Allow/Reject in the
/// approval card.
#[tauri::command]
pub fn agent_approve(
    approval_id: String,
    allow: bool,
    reason: Option<String>,
    pending: State<'_, PendingApprovals>,
) -> Result<bool, String> {
    let decision = ApprovalDecision {
        allow,
        reason,
        updated_input: None,
    };
    Ok(pending.resolve(&approval_id, decision))
}
