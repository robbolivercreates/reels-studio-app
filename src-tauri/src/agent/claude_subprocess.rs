// Spawns `claude -p "<prompt>" --output-format stream-json …` as a child
// process and pipes the line-delimited JSON stream back to the front-end as
// Tauri events. The user's Claude subscription is used (via ~/.claude
// credentials inherited through HOME) — we never see API keys.
//
// Events emitted (all globally on the AppHandle):
//   - "agent://message"        full assistant/user/system message envelope
//   - "agent://stream-delta"   partial text delta (from --include-partial-messages)
//   - "agent://result"         final envelope with cost + duration
//   - "agent://error"          parse failure or non-zero exit
//   - "agent://run-started"    { run_id } once the subprocess is alive
//   - "agent://run-ended"      { run_id, exit_code }
//
// The front-end subscribes via @tauri-apps/api/event and renders messages
// in <AgentPanel>. Only one run can be active at a time; agent_cancel kills
// the current subprocess group.
//
// Cancel semantics: `tokio::Child::kill().await` only signals the PID
// leader. The `claude` CLI spawns subshells / MCP clients, and at least one
// known Anthropic bug (claude-code#51860) can leave it tight-looping past
// SIGTERM. We therefore put the child in its own process group at spawn time
// and signal the whole group (SIGTERM → 1.5s grace → SIGKILL). We also emit
// run-ended *immediately* from agent_cancel so the UI never depends on
// reaper progress to leave the busy state.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::auth::find_claude_binary;

/// Tools the Claude session is allowed to call without prompting the user.
/// Read-only tools are auto-approved here so the agent feels responsive;
/// write tools are intentionally NOT in this list — they go through the
/// `request_user_approval` flow.
const AUTO_ALLOWED_TOOLS: &str = concat!(
    // Built-in Claude tools. `Skill` lets the agent consult local skills
    // (`~/.claude/skills/`) — reels-virais-ai, hooks-brasil, voz-rob, etc.
    "Skill,",
    // Read-only — always safe.
    "mcp__reels__list_blocks,",
    "mcp__reels__read_block,",
    "mcp__reels__get_project_status,",
    "mcp__reels__list_style_presets,",
    "mcp__reels__list_avatar_photos,",
    "mcp__reels__pick_avatar_photo,",
    "mcp__reels__list_voices,",
    "mcp__reels__pick_voice,",
    "mcp__reels__list_assets,",
    "mcp__reels__list_references,",
    // Reversible edits — auto-approved so the chat feels conversational.
    // User can always undo from the timeline. Destructive ops (remove_block,
    // recreate_full_script, delete_reference) stay behind explicit approval.
    "mcp__reels__set_block_avatar_photo,",
    "mcp__reels__edit_block_text,",
    "mcp__reels__set_block_kind,",
    "mcp__reels__set_block_layout,",
    "mcp__reels__add_block,",
    "mcp__reels__regenerate_block,",
    "mcp__reels__regenerate_draft_block,",
    "mcp__reels__replace_draft_block,",
    "mcp__reels__set_emotion,",
    "mcp__reels__set_voice_speed,",
    "mcp__reels__set_voice,",
    "mcp__reels__set_app_theme,",
    "mcp__reels__set_project_name,",
    "mcp__reels__apply_style_preset,",
    "mcp__reels__apply_style_preset_cascade,",
    "mcp__reels__split_long_blocks",
);

/// The MCP tool we register via `--permission-prompt-tool`. When Claude
/// tries to call a tool not in `--allowedTools`, the runtime calls this
/// tool with the requested name + arguments; our handler bridges that to
/// the React approval card and returns the user's decision.
const PERMISSION_PROMPT_TOOL: &str = "mcp__reels__request_user_approval";

#[derive(Debug, Default)]
pub struct ActiveRun {
    pub child: Option<Child>,
    pub run_id: Option<String>,
    /// Stored at spawn time so kill() can signal the process group even
    /// after we've `take()`d the Child for `wait()`.
    pub pid: Option<i32>,
}

#[derive(Debug, Default, Clone)]
pub struct RunHandle {
    pub(crate) inner: Arc<Mutex<ActiveRun>>,
}

impl RunHandle {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn set(&self, run_id: String, child: Child, pid: i32) {
        let mut guard = self.inner.lock().await;
        guard.run_id = Some(run_id);
        guard.child = Some(child);
        guard.pid = Some(pid);
    }

    #[allow(dead_code)] // PR3 uses this on window-close
    pub async fn clear(&self) {
        let mut guard = self.inner.lock().await;
        guard.run_id = None;
        guard.child = None;
        guard.pid = None;
    }

    /// Best-effort process-group kill. Sends SIGTERM, waits briefly for the
    /// child to exit cleanly, escalates to SIGKILL if it doesn't. Returns
    /// the PID we killed so the caller can log / emit run-ended manually.
    pub async fn kill(&self) -> Option<i32> {
        let pid = {
            let guard = self.inner.lock().await;
            guard.pid
        };

        let Some(pid) = pid else {
            return None;
        };

        // Best-effort SIGTERM → grace period → SIGKILL on the *group*.
        #[cfg(unix)]
        {
            use nix::sys::signal::{killpg, Signal};
            use nix::unistd::Pid;
            let pgid = Pid::from_raw(pid);
            // Ignore errors — the process may have already exited.
            let _ = killpg(pgid, Signal::SIGTERM);
            tokio::time::sleep(Duration::from_millis(1500)).await;
            let _ = killpg(pgid, Signal::SIGKILL);
        }

        #[cfg(not(unix))]
        {
            // On Windows tokio Child::kill works on the job object; fall
            // back to the standard API.
            let mut guard = self.inner.lock().await;
            if let Some(child) = guard.child.as_mut() {
                let _ = child.start_kill();
            }
        }

        Some(pid)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    Pt,
    En,
}

impl Default for Locale {
    fn default() -> Self {
        Locale::Pt
    }
}

/// Send a prompt to a fresh `claude` subprocess and stream events back to
/// the front-end. Returns the run id; events flow asynchronously.
// `text_provider` / `motion_provider`: effective providers for THIS run,
// forwarded from `resolveTextProvider()` / `resolveMotionProvider()` on
// the React side. Each is "gemini" or "claude" independently.
//
// `voice_prompt`: pre-built voice profile prompt section built by
// `buildVoicePromptSection` on the React side. Appended to the system
// prompt ONLY when text_provider === 'claude' (Gemini path receives the
// voice profile via the regenerateBlock service directly).
//
// When `motion_provider == "claude"` we append the HyperFrames reference
// pack so Claude can author motion HTML directly; otherwise we keep the
// prompt slim and let Gemini handle motion via the bridge's default branch.
#[tauri::command]
pub async fn agent_send(
    prompt: String,
    session_id: Option<String>,
    resume_session: Option<bool>,
    model: Option<String>,
    locale: Option<String>,
    text_provider: Option<String>,
    motion_provider: Option<String>,
    voice_prompt: Option<String>,
    app: AppHandle,
    run: State<'_, RunHandle>,
    agent_state: State<'_, crate::agent::state::AgentState>,
) -> Result<String, String> {
    {
        let guard = run.inner.lock().await;
        if guard.child.is_some() {
            return Err("Já existe uma conversa em andamento. Cancele antes.".into());
        }
    }

    let bin = find_claude_binary().ok_or_else(|| {
        "Claude Code CLI não encontrado. Configure em Settings → Agents.".to_string()
    })?;

    let run_id = uuid_v4_simple();

    let loc = match locale.as_deref() {
        Some("en") => Locale::En,
        _ => Locale::Pt,
    };
    let claude_motion_mode = matches!(motion_provider.as_deref(), Some("claude"));
    let claude_text_mode = matches!(text_provider.as_deref(), Some("claude"));
    // Voice profile only useful when Claude is authoring text. In Gemini
    // mode the regenerateBlock service injects the profile directly into
    // the per-call prompt — no need to bloat the system prompt with it.
    let voice_for_prompt = if claude_text_mode { voice_prompt.as_deref() } else { None };
    let system_prompt_path = write_system_prompt_file(&app, &loc, claude_motion_mode, voice_for_prompt)
        .map_err(|e| format!("Falha ao preparar o system prompt do agente: {e}"))?;

    // Flag notes (see plan file for full rationale):
    //   -p / --print                       non-interactive
    //   --output-format stream-json        line-delimited JSON events
    //   --verbose                          required combo with stream-json
    //   --include-partial-messages         token-by-token streaming
    //   --system-prompt-file               replace default persona with our editor partner
    //   --allowedTools                     auto-approve read-only tools
    //   --permission-prompt-tool           route write-tool approvals through our MCP card
    //
    // NOTE: we deliberately do NOT pass `--bare` here. Bare mode skips OAuth /
    // keychain reads and requires ANTHROPIC_API_KEY, which breaks the "use
    // your Claude subscription" UX (user sees "Not logged in · Please run
    // /login"). The system-prompt-file replacement alone is enough to own
    // the persona without disabling auth.
    // Build an inline MCP config that points exclusively at our local server.
    // Combined with `--strict-mcp-config`, this isolates the Reels agent from
    // any other MCP servers the user has registered globally (Canva, Gmail,
    // GitHub, etc.). Without this isolation the CLI loads 150+ unrelated tools
    // into the agent's context, which:
    //   1. wastes ~80k cache tokens per turn,
    //   2. forces deferred-tools mode (the agent has to `ToolSearch` before
    //      every MCP call, polluting the chat UI), and
    //   3. occasionally causes write tools to silently fail because the model
    //      runs out of attention budget mid-search.
    let mcp_port = agent_state
        .mcp_port()
        .ok_or_else(|| "MCP server ainda não foi iniciado. Reabra o app.".to_string())?;
    let mcp_config = format!(
        r#"{{"mcpServers":{{"reels":{{"type":"http","url":"http://127.0.0.1:{port}/mcp"}}}}}}"#,
        port = mcp_port
    );

    let mut cmd = Command::new(&bin);
    cmd.arg("-p")
        .arg(&prompt)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--include-partial-messages")
        .arg("--system-prompt-file")
        .arg(&system_prompt_path)
        .arg("--strict-mcp-config")
        .arg("--mcp-config")
        .arg(&mcp_config)
        .arg("--allowedTools")
        .arg(AUTO_ALLOWED_TOOLS)
        .arg("--permission-prompt-tool")
        .arg(PERMISSION_PROMPT_TOOL);

    // `--session-id` creates a new session and fails with "Session ID ... is
    // already in use" if reused. To continue a previous conversation, use
    // `--resume <id>` instead. The frontend tracks which case applies.
    if let Some(sid) = session_id.as_deref() {
        if resume_session.unwrap_or(false) {
            cmd.arg("--resume").arg(sid);
        } else {
            cmd.arg("--session-id").arg(sid);
        }
    }

    if let Some(m) = model.as_deref() {
        if !m.is_empty() {
            cmd.arg("--model").arg(m);
        }
    }

    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // Put the child in its own process group so we can killpg the whole
    // tree later. Without this, SIGKILL on the parent leaves zombies behind
    // (CLI subshells, MCP clients).
    #[cfg(unix)]
    {
        cmd.process_group(0);
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {e}"))?;
    let pid = child.id().ok_or_else(|| "child has no pid".to_string())? as i32;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "subprocess has no stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "subprocess has no stderr".to_string())?;

    run.set(run_id.clone(), child, pid).await;

    let _ = app.emit(
        "agent://run-started",
        serde_json::json!({ "run_id": run_id }),
    );

    // stdout drain — JSONL parser
    let app_for_out = app.clone();
    let run_id_for_out = run_id.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    handle_stdout_line(&app_for_out, &run_id_for_out, trimmed);
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = app_for_out.emit(
                        "agent://error",
                        serde_json::json!({
                            "run_id": run_id_for_out,
                            "message": format!("stdout read: {e}"),
                        }),
                    );
                    break;
                }
            }
        }
    });

    // stderr drain
    let app_for_err = app.clone();
    let run_id_for_err = run_id.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut buf = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            buf.push_str(&line);
            buf.push('\n');
        }
        if !buf.trim().is_empty() {
            let _ = app_for_err.emit(
                "agent://error",
                serde_json::json!({
                    "run_id": run_id_for_err,
                    "message": buf.trim().to_string(),
                    "source": "stderr",
                }),
            );
        }
    });

    // Reaper. We wrap `wait()` in a tokio::timeout so a hung child can't
    // hold the mutex (and therefore agent_send) hostage on the next request.
    // If wait() blocks longer than 30s we abandon the handle — kill should
    // have already cleared the OS-level state by then.
    let app_for_reap = app.clone();
    let run_id_for_reap = run_id.clone();
    let run_handle_for_reap = run.inner.clone();
    tokio::spawn(async move {
        let exit_code = {
            // Briefly take ownership of the child out of the mutex so the
            // wait() doesn't block other state inspection.
            let child_opt = {
                let mut guard = run_handle_for_reap.lock().await;
                guard.child.take()
            };
            if let Some(mut child) = child_opt {
                // 10-minute ceiling. Long replies + many tool calls can easily
                // run past 30s — the previous limit was killing healthy
                // conversations mid-stream. If anything legitimately needs
                // more than 10min, the user can cancel manually.
                match tokio::time::timeout(Duration::from_secs(600), child.wait()).await {
                    Ok(Ok(status)) => status.code(),
                    Ok(Err(_)) => None,
                    Err(_) => {
                        // Timeout — surface an error so the UI doesn't sit
                        // silently with the spinner. Force-kill as last resort.
                        let _ = app_for_reap.emit(
                            "agent://error",
                            serde_json::json!({
                                "run_id": run_id_for_reap,
                                "message": "Timeout (10min). A resposta do agente foi interrompida. Tenta de novo ou limpa a conversa.",
                                "source": "timeout",
                            }),
                        );
                        let _ = child.start_kill();
                        None
                    }
                }
            } else {
                None
            }
        };
        {
            let mut guard = run_handle_for_reap.lock().await;
            guard.child = None;
            guard.run_id = None;
            guard.pid = None;
        }
        let _ = app_for_reap.emit(
            "agent://run-ended",
            serde_json::json!({
                "run_id": run_id_for_reap,
                "exit_code": exit_code,
            }),
        );
    });

    Ok(run_id)
}

/// Kill the currently running Claude subprocess (if any). No-op if nothing
/// is in flight.
///
/// We also emit `agent://run-ended` synchronously here so the UI flips out
/// of busy state immediately — without relying on the reaper, which on a
/// hung process can take seconds to react.
#[tauri::command]
pub async fn agent_cancel(app: AppHandle, run: State<'_, RunHandle>) -> Result<(), String> {
    let run_id = {
        let guard = run.inner.lock().await;
        guard.run_id.clone()
    };
    let _killed_pid = run.kill().await;

    if let Some(rid) = run_id {
        let _ = app.emit(
            "agent://run-ended",
            serde_json::json!({
                "run_id": rid,
                "exit_code": null,
                "cancelled": true,
            }),
        );
    }

    Ok(())
}

fn handle_stdout_line(app: &AppHandle, run_id: &str, line: &str) {
    let value: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            let _ = app.emit(
                "agent://error",
                serde_json::json!({
                    "run_id": run_id,
                    "message": format!("parse stdout: {e}"),
                    "raw": line,
                }),
            );
            return;
        }
    };

    let kind = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

    let envelope = serde_json::json!({
        "run_id": run_id,
        "payload": value,
    });

    match kind {
        "stream_event" => {
            let _ = app.emit("agent://stream-delta", envelope);
        }
        "result" => {
            let _ = app.emit("agent://result", envelope);
        }
        _ => {
            let _ = app.emit("agent://message", envelope);
        }
    }
}

/// Persist the locale-specific system prompt to disk and return its path.
/// We always rewrite the file so a code update is picked up immediately.
///
/// `with_motion_pack`: append the HyperFrames reference pack (~3-4k tokens)
/// so Claude can author motion HTML in passthrough mode.
///
/// `voice_section`: pre-built voice profile prompt (PT/EN text from
/// buildVoicePromptSection). Appended so Claude regenerates blocks in the
/// user's voice. Only passed when text provider is Claude — Gemini service
/// injects the same profile via its own per-call prompt.
fn write_system_prompt_file(
    app: &AppHandle,
    locale: &Locale,
    with_motion_pack: bool,
    voice_section: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&base).map_err(|e| format!("mkdir {base:?}: {e}"))?;
    // Single file name — content changes per turn based on flags. We
    // always rewrite, so caching the path itself is fine.
    let file_name = match locale {
        Locale::Pt => "agent_system_prompt_pt.md",
        Locale::En => "agent_system_prompt_en.md",
    };
    let path = base.join(file_name);

    let mut body = String::from(system_prompt_text(locale));
    if let Some(voice) = voice_section {
        let trimmed = voice.trim();
        if !trimmed.is_empty() {
            body.push_str("\n\n");
            body.push_str(VOICE_PACK_HEADER);
            body.push_str("\n\n");
            body.push_str(trimmed);
        }
    }
    if with_motion_pack {
        body.push_str("\n\n");
        body.push_str(MOTION_PACK_HEADER);
        body.push_str("\n\n");
        body.push_str(HYPERFRAMES_REFERENCE);
    }
    std::fs::write(&path, body).map_err(|e| format!("write system prompt: {e}"))?;
    Ok(path)
}

/// The replacement persona Claude Code receives via --system-prompt-file.
/// Keep this SHORT (≤40 lines): Claude reads it every turn and longer
/// prompts crowd out the user's actual request.
fn system_prompt_text(locale: &Locale) -> &'static str {
    match locale {
        Locale::Pt => PROMPT_PT,
        Locale::En => PROMPT_EN,
    }
}

const PROMPT_PT: &str = r#"Você é o agente do Reels Studio. Converse com o usuário como ChatGPT ou Claude conversariam — natural, proativo, opinativo. Você ajuda a criar e editar reels curtos.

JEITO DE CONVERSAR
1. Português brasileiro, sempre.
2. Tom de colega criativo. Direto, prático, com opinião quando faz sentido.
3. Frases curtas. Frases médias quando o conteúdo precisa. Evite walls of text. NUNCA use asteriscos pra negrito (`**texto**`) — escreva texto puro. Sem headers (#), sem listas com bullets, sem markdown nenhum no chat. Se precisar destacar algo, use ASPAS ou separe em parágrafo curto.
4. Quando o pedido é vago ("melhora isso", "deixa mais viral", "ajusta o tom"), PERGUNTE o que o usuário tem em mente — ofereça 2-3 direções concretas e deixa ele escolher. Não chuta uma ação sozinho.
5. Quando o pedido é claro ("regenera o bloco 2 mais agressivo"), execute direto.
6. Depois de aplicar uma mudança, diga em 1 frase o que mudou. Quando houver um próximo passo natural óbvio, sugira UM ("quer que eu gere o áudio agora?"). Não bombardeie com 5 opções.
7. Tem opinião. Se o usuário tá indo num caminho que não vai funcionar bem (CTA múltipla num reel, hook fraco, bloco gigante), fale. Não em tom de palestra — em tom de amigo que sabe do assunto.

EXEMPLOS DE BOA RESPOSTA

Usuário: "oi"
Você: "Oi. O que tá rolando? Quer criar um reel novo, mexer no que já tem, ou ver o estado do projeto?"

Usuário: "melhora o bloco 2"
Você: "Posso ir em 3 direções: deixar mais provocativo, mais curto e direto, ou trocar o tom pra história pessoal. Qual prefere — ou tem outra ideia?"

Usuário: "regenera o bloco 2 mais agressivo"
Você: (chama regenerate_block) "Feito. Agora ele começa com 'Para de fazer X' em vez da abertura suave. Quer que eu olhe os vizinhos pra ver se ficaram coerentes?"

Usuário: "como tá o projeto?"
Você: "6 blocos, ~38s, áudio pronto, voz Marina. O bloco 5 ainda tá marcado dirty desde a última edição — quer que eu regere o áudio?"

Usuário: "deixa mais viral"
Você: "'Viral' pode ir por caminhos diferentes. Quer hook mais provocativo nos 3 primeiros segundos, ritmo mais cortado (blocos curtos), CTA-isca tipo 'comenta CANVA que eu te mando no DM', ou os 3 juntos?"

FERRAMENTAS
Tools MCP `mcp__reels__*`. Sempre leia estado antes de mudar (`list_blocks`, `get_project_status`). Refira blocos por número ("bloco 2"), não por id. Nunca mostre JSON pro usuário.

SKILLS LOCAIS
Você tem acesso à tool `Skill` pra consultar skills instaladas em `~/.claude/skills/`. Use SEM PEDIR antes de escrever roteiro, hook, ou CTA — especialmente: `reels-virais-ai` (frameworks de Reel + hooks), `hooks-brasil` (1000+ templates PT-BR), `creative-scripts` (Hook-Story-Deliver + gatilhos psicológicos). Se o usuário tem `voz-rob` ou similar, use também pra alinhar tom. Você não precisa anunciar "vou consultar a skill" — apenas consulte e aplique. Skills são contexto extra, não anúncio.

AÇÕES DESTRUTIVAS — confirme antes
Antes de apagar bloco (`remove_block`), refazer o roteiro inteiro (`recreate_full_script`), apagar referência, regerar áudio inteiro, ou qualquer coisa que destrua trabalho — pergunte "Pode aplicar?" e espera ok. Pra edições reversíveis (texto, kind, layout, motion, adicionar bloco), execute direto.

REGRA ANTI-DUPLICAÇÃO (CRÍTICA)
- Uma URL na mensagem do usuário = UMA chamada de tool. Nunca chame import_from_video_url, import_from_article, ou qualquer tool de import mais de uma vez no mesmo turno.
- Se o usuário escreve "baixa esse reel e me mostra o roteiro pra eu aprovar", isso é UMA ação. Chame UMA tool, espere UMA resposta.
- Se a primeira chamada já retornou com sucesso, NÃO chame de novo — o resultado vai aparecer como draft card no chat.

MOTION (importantíssimo)
- UM bloco: chame `generate_motion_for_block` uma vez. Se você está em Claude-mode (HYPERFRAMES PACK presente no fim deste prompt), VOCÊ escreve o HTML e passa em `html`. Se NÃO recebeu o pack, chame sem `html` — Gemini gera.
- MÚLTIPLOS blocos ("gera motion em todos", "anima todos os blocos sem avatar", "faz motion no roteiro inteiro"): SEMPRE use `generate_motion_for_blocks` (plural) — UMA chamada só. NUNCA dispare `generate_motion_for_block` em paralelo, NUNCA chame ele várias vezes seguidas. O batch tool gerencia fila de Chromium internamente.
- No batch, filtros: 'broll' (só blocos B-roll, é o caso comum quando o usuário diz "sem avatar"), 'avatar', 'all', 'missing' (default). Use 'broll' quando o usuário diz "sem avatar".
- No batch em Claude-mode: passe `html_by_id` como string JSON `{"block_id": "<html>"}` com SEU HTML pra cada bloco. Blocos que você não incluir caem no Gemini automaticamente.
- Após o batch, diga em 1 frase ("Pronto — 8 motions gerados" ou "7 ok, 1 falhou no bloco 4 — quer que eu tente de novo?"). Não anuncie "vou fazer em paralelo" — apenas execute.

DRAFTS (importantíssimo)
Quando você chama uma tool de import e o resultado vem com `status: 'pending-user-approval'` + `draft_id`:
- A UI já está mostrando um card de preview com botões "Aplicar / Descartar". O usuário decide.
- NÃO substitua o projeto. NÃO repita o resumo (o card já mostra os blocos).
- Resposta curta: "Pronto, dá uma olhada e aplica quando estiver bom" — e, se você notou algo (tom estranho, bloco fraco, hook morno), comenta UMA observação útil. Não invente crítica só pra comentar.
- LEMBRE-SE do `draft_id` na sua memória da conversa. Se o usuário pedir uma edição depois ("o bloco 3 tá mole, deixa mais agressivo", "encurta o 1"), use regenerate_draft_block ou replace_draft_block com aquele draft_id. NÃO use regenerate_block (esse mexe no Script, que ainda está vazio).
- Quando o usuário aplicar (ou descartar) o draft, esqueça o draft_id. Próximas edições aí sim vão pra regenerate_block normal.

TÓPICOS PENDENTES
Se o usuário trocar de assunto sem responder uma pergunta que você fez, anote mentalmente. Ao terminar o assunto novo (draft aplicado, motion gerado, etc), retome UMA vez: "antes de continuar, queria voltar no [X] que você mencionou — ainda quer fazer aquilo?". Não force. Se ele disser "depois" ou ignorar, esquece. Não vire chato lembrando toda hora.
"#;

const PROMPT_EN: &str = r#"You are the Reels Studio agent. Talk to the user the way ChatGPT or Claude would — natural, proactive, opinionated. You help create and edit short reels.

HOW TO TALK
1. English, always.
2. Peer-to-peer tone — direct, practical, opinionated when it matters.
3. Keep replies tight. Medium when the content needs it. Avoid walls of text. NEVER use asterisks for bold (`**text**`) — write plain text. No headers (#), no bullet lists, no markdown at all in chat. If you need to highlight something, use QUOTES or a short separate paragraph.
4. When the request is vague ("make this better", "more viral", "fix the tone"), ASK what they have in mind — offer 2-3 concrete directions and let them pick. Don't guess an action solo.
5. When the request is clear ("regenerate block 2 with a more aggressive tone"), just do it.
6. After an edit, say in one sentence what changed. If there's an obvious next step, suggest ONE ("want me to regen the audio now?"). Don't dump 5 options.
7. Have an opinion. If the user's heading toward something that won't work (multiple CTAs in one reel, weak hook, huge block), say so. Not in lecture tone — like a friend who knows the craft.

GOOD-REPLY EXAMPLES

User: "hi"
You: "Hey. What's up — new reel, tweak what you have, or check the state?"

User: "improve block 2"
You: "Three ways I can take it: more provocative, shorter and sharper, or pivot to a personal-story angle. Which feels right — or got something else in mind?"

User: "regenerate block 2 more aggressive"
You: (calls regenerate_block) "Done. It now opens with 'Stop doing X' instead of the soft lead-in. Want me to check the neighbors for flow?"

User: "what's the state?"
You: "6 blocks, ~38s, audio ready, voice Marina. Block 5 is still dirty since the last edit — want me to regen the audio?"

User: "make it more viral"
You: "'Viral' can go a few ways. Want a punchier hook in the first 3 seconds, sharper rhythm (shorter blocks), a comment-to-DM CTA like 'comment CANVA, I'll DM you the guide', or all three?"

TOOLS
MCP tools `mcp__reels__*`. Always read state before changing (`list_blocks`, `get_project_status`). Refer to blocks by number ("block 2"), not by id. Never show JSON to the user.

LOCAL SKILLS
You have access to the `Skill` tool to consult skills installed in `~/.claude/skills/`. Use it WITHOUT ASKING before writing scripts, hooks, or CTAs — especially `reels-virais-ai` (Reel frameworks + hooks), `hooks-brasil` (1000+ PT-BR templates), `creative-scripts` (Hook-Story-Deliver + psychological triggers). If the user has `voz-rob` or similar, use it too to align tone. Don't announce "I'll consult the skill" — just consult and apply. Skills are extra context, not an announcement.

DESTRUCTIVE ACTIONS — confirm first
Before deleting a block (`remove_block`), recreating the full script (`recreate_full_script`), deleting a reference, regenerating the whole audio, or anything that destroys work — ask "Want me to apply?" and wait. For reversible edits (text, kind, layout, motion, adding a block), just execute.

ANTI-DUPLICATION RULE (CRITICAL)
- One URL in the user's message = ONE tool call. Never call import_from_video_url, import_from_article, or any import tool more than once in the same turn.
- If the user writes "download this reel and show me the script for me to approve", that is ONE action. Make ONE tool call, wait for ONE response.
- If the first call succeeded, DO NOT call again — the result will surface as a draft card.

MOTION (very important)
- ONE block: call `generate_motion_for_block` once. If you're in Claude-mode (HYPERFRAMES PACK appears at the end of this prompt), YOU author the HTML and pass it as `html`. If you did NOT receive the pack, call without `html` — Gemini handles it.
- MULTIPLE blocks ("generate motion for all blocks", "animate every B-roll", "motion the whole reel"): ALWAYS use `generate_motion_for_blocks` (plural) — ONE call only. NEVER fan out parallel `generate_motion_for_block` calls. The batch tool serializes Chromium rendering internally.
- Batch filters: 'broll' (only B-roll blocks — common case when user says "no avatar"), 'avatar', 'all', 'missing' (default). Use 'broll' when user says "without avatar".
- Batch in Claude-mode: pass `html_by_id` as JSON string `{"block_id": "<html>"}` with YOUR HTML for each block. Blocks not in the map fall through to Gemini.
- After the batch, say in one sentence ("Done — 8 motions ready" or "7 ok, 1 failed on block 4 — want me to retry?"). Don't announce "I'll run them in parallel" — just execute.

DRAFTS (very important)
When you call an import tool and the result has `status: 'pending-user-approval'` + `draft_id`:
- The UI is already showing a preview card with Apply/Discard buttons. The user decides.
- Do NOT overwrite the project. Do NOT repeat the block list (the card shows them).
- Short reply: "Done — take a look and tap Apply when it's right" — and if you noticed something (off tone, weak block, lukewarm hook), drop ONE useful observation. Don't invent critique just to talk.
- REMEMBER the `draft_id` in your conversation memory. If the user asks for an edit ("block 3 is soft, make it punchier", "shorten block 1"), use regenerate_draft_block or replace_draft_block with that draft_id. Do NOT use regenerate_block (that operates on the Script, which is still empty).
- Once the user applies (or discards) the draft, forget the draft_id. Subsequent edits go through regenerate_block as usual.

PENDING TOPICS
If the user changes subject without answering a question you asked, hold the original topic in mind. When the new subject wraps up (draft applied, motion done, etc.), gently come back ONCE: "before we move on, I wanted to circle back on [X] you mentioned — still want to do that?". Don't push. If they say "later" or ignore, drop it. Don't nag.
"#;

// ─── Motion pack — appended only when text_provider = 'claude' ─────────
// Adds ~3.5k tokens to the per-turn system prompt. We pay this only when
// the user opted into Claude-mode text generation, since that's the only
// time the agent should hand-author motion HTML (instead of delegating to
// Gemini Pro via generate_motion_for_block default mode).

const VOICE_PACK_HEADER: &str = r#"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VOICE PROFILE (active because text provider = Claude)

When you regenerate or write blocks of script (regenerate_block, add_block, recreate_full_script, generate_carousel, draft edits, captions), HONOR the user's voice profile below. This is the same profile the Gemini path receives via its service call — your output should sound like it came from the same writer.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"#;

const MOTION_PACK_HEADER: &str = r#"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HYPERFRAMES MOTION PACK (active because motion provider = Claude)

When the user asks you to generate or edit a motion (and they're in Claude-mode), YOU author the full HTML directly — do not delegate. Use the `generate_motion_for_block` tool with the `html` field set to your authored HTML. The tool's default Gemini path is bypassed.

Output a complete `<body>`-level HTML (no `<html>`/`<head>` wrapper — the host page provides those). The fonts Inter, Anton, and Space Grotesk are preloaded — use those only. GSAP 3.14 is loaded globally as `gsap`.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"#;

const HYPERFRAMES_REFERENCE: &str = r##"## HYPERFRAMES STRUCTURE

Every timed element is a `<div class="clip" id="…" data-start="0" data-duration="N" data-track-index="K">` (or `<video>` / `<canvas>` / `<img>` with `class="clip"` and the same data-attrs). HyperFrames reads `data-start` / `data-duration` to know when to show/hide, and `data-track-index` to layer it.

CORE RULES (lint codes shown — these break the renderer):

1. `class="clip"` is a TIMING SHELL — never animate it directly. Wrap content in an inner `<div>` with its own id and animate that.

   ```html
   <div id="hero-shell" class="clip" data-start="0" data-duration="3" data-track-index="3">
     <div id="hero-anim">…visible content…</div>
   </div>
   ```
   `gsap.from("#hero-anim", { … })` ✓
   `gsap.from(".clip", { … })` ✗ (lint: animating_timing_shell)

2. Every `class="clip"` element MUST have an `id="…"` attribute (human-readable, stable). Lint code: `studio_missing_editable_id`.

3. Every element with `data-start` MUST also have `class="clip"`. Lint code: `timed_element_missing_clip_class`.

4. NESTED timed elements are forbidden. If a `<video data-start>` lives inside a `<div class="clip" data-start>`, the OUTER must drop its timing (be a plain `<div>` with no `class="clip"` and no `data-start`). Lint code: `video_nested_in_timed_element`.

5. On `data-track-index=0` only ONE element (the background/vignette). Anything else collides. Tracks 1..9 are cheap — use them for foreground content.

6. NEVER `repeat: -1`. HyperFrames captures fixed frames — infinite loops freeze the render. For looping effects:
   `repeat: Math.floor(DURATION_SEC / CYCLE_SEC) - 1`
   `yoyo: true` requires a finite repeat.

7. Build a single GSAP timeline, PAUSED, registered on `window.__timelines[compositionId]`. Pattern:
   ```js
   window.__timelines = window.__timelines || {};
   const tl = gsap.timeline({ paused: true });
   tl.from("#hero-anim", { opacity: 0, y: 30, duration: 0.6, ease: "power3.out" }, 0);
   window.__timelines["{COMPOSITION_ID}"] = tl;
   ```
   Replace `{COMPOSITION_ID}` with the actual id provided in the tool input.

FORBIDDEN (will fail render):
- `Date.now()`, `Math.random()`, `performance.now()` (must be deterministic)
- `fetch()`, `setTimeout`, `setInterval`, `requestAnimationFrame` (use GSAP only)
- External font `@import` or `<link>` (use only Inter / Anton / Space Grotesk)
- `::before` / `::after` pseudo-elements you want to animate (GSAP can't target them — use real `<div>` children)
- Hover / click / scroll-dependent effects
- `console.log`, `alert`, `debugger`

## ANIMATION GRAMMAR (use freely)

- **Entry**: `gsap.from(".x", { opacity:0, y:30, duration:0.8, ease:"power3.out" })`
- **Word reveal**: wrap each word in `<span class="word">`; `gsap.from(".word", { opacity:0, y:24, stagger:0.05, duration:0.6 })`
- **Clip-path wipe**: `gsap.from(".h", { clipPath:"inset(0 100% 0 0)", duration:0.7, ease:"power4.out" })`
- **Scale punch**: `gsap.from(".accent", { scale:0, duration:0.5, ease:"back.out(2)" })`
- **Float**: `gsap.to(".bg", { y:20, duration:cycle, repeat: Math.floor(DUR/cycle)-1, yoyo:true, ease:"sine.inOut" })`
- **Stroke draw**: `gsap.from("path", { strokeDashoffset:pathLen, duration:1.2, ease:"power2.out" })`
- **Number count**: `gsap.to(obj, { value:target, duration:2, ease:"power2.out", onUpdate:() => el.textContent = Math.round(obj.value) })`

## PRESET PALETTES (start point — customize freely)

- `glass-tech` (dark, default): glassmorphism, blue-purple glow, neutral text. `--bg:#0a0e1a; --glass:rgba(255,255,255,0.06); --glow:#8b5cf6; --text:#fafafa`
- `editorial-clean` (light): serif headlines, generous whitespace, single accent. `--bg:#fafafa; --ink:#0a0a0a; --accent:#dc2626`
- `bold-pop` (light): saturated brand colors, big sans-serif. `--bg:#fff7ed; --primary:#dc2626; --ink:#0a0a0a`
- `kinetic-bold` (dark): huge type, fast movement, neon. `--bg:#000; --neon:#00ff88; --ink:#fafafa`
- `soft-pastel` (light): pale colors, slow eases. `--bg:#fef3f2; --primary:#ec4899; --ink:#1f2937`
- `cinematic-dark` (dark): high contrast, vignette, film grain. `--bg:#050505; --highlight:#fde68a; --ink:#e5e5e5`
- `apple-system` (light): premium minimal, SF-system feel. `--bg:#fff; --accent:#0066cc; --ink:#1d1d1f`
- `warm-editorial` (warm): cream/sepia, newspaper feel. `--bg:#fef3c7; --ink:#451a03; --accent:#92400e`

When the user mentions a brand by name (no Google Search grounding available in Claude-mode), ASK them for the brand's hex colors before generating — don't guess.

## DURATION + COMPOSITION ID

The tool input includes the block duration (`durationSec`) and a `compositionId` (e.g. `motion-abc123`). Use those literally in your output — see the pattern above for `window.__timelines[compositionId]`.

## OUTPUT FORMAT

When calling `generate_motion_for_block` with `html`, send a complete body-level HTML string. No fences, no `<html>`, no `<head>`. Start with `<style>` (scoped to your motion's elements) and end with `<script>` (your GSAP timeline). Example skeleton:

```
<style>
  #bg-shell { position: absolute; inset:0; background:#0a0e1a; }
  #hero-anim { color:#fafafa; font-family: "Inter", system-ui, sans-serif; }
</style>
<div id="bg-shell" class="clip" data-start="0" data-duration="4" data-track-index="0"></div>
<div id="hero-shell" class="clip" data-start="0.2" data-duration="3.6" data-track-index="1">
  <div id="hero-anim">
    <h1 class="title">Your headline</h1>
  </div>
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
tl.from("#bg-shell", { opacity: 0, duration: 0.4, ease: "power2.out" }, 0);
tl.from("#hero-anim", { opacity: 0, y: 30, duration: 0.7, ease: "power3.out" }, 0.2);
window.__timelines["{COMPOSITION_ID}"] = tl;
</script>
```
"##;

/// Tiny RFC4122-ish v4 generator so we don't pull a full uuid crate just
/// for this. Not cryptographic — only used as a session/run identifier.
pub fn uuid_v4_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let rand = std::process::id() as u128;
    let mixed = now.wrapping_mul(0x9E3779B97F4A7C15).wrapping_add(rand);
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        (mixed & 0xFFFFFFFF) as u32,
        ((mixed >> 32) & 0xFFFF) as u16,
        ((mixed >> 48) & 0x0FFF) as u16 | 0x4000,
        ((mixed >> 64) & 0x3FFF) as u16 | 0x8000,
        (mixed >> 80) as u64 & 0xFFFFFFFFFFFF,
    )
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct RunStarted {
    pub run_id: String,
}
