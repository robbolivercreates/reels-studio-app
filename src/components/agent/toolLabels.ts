// Maps MCP tool names to i18n keys for "doing X" / "done X" pills.
//
// Why: the raw event stream from Claude Code is `tool_use` JSON. Showing
// that to the user feels like a debug console. Instead, we render a colored
// pill with a present-continuous phrase ("Lendo os blocos…") while the tool
// is running, then swap to a past-tense check ("✓ Listou 6 blocos") on the
// matching `tool_result`.

export interface ToolLabel {
  doingKey: string;
  doneKey: string;
  /** Optional: extracts a variable (e.g. block count) from the tool result
   *  payload to render in the "done" string. */
  extractVars?: (result: unknown) => Record<string, string | number> | undefined;
}

function tryParseJson<T = unknown>(v: unknown): T | undefined {
  if (typeof v !== 'string') return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

// Reads `content[0].text` from a CallToolResult — that's where our MCP
// tools write a JSON string payload.
function readContentText(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as { content?: Array<{ text?: string }> };
  return r.content?.[0]?.text;
}

export const TOOL_LABELS: Record<string, ToolLabel> = {
  'mcp__reels__list_blocks': {
    doingKey: 'tool.listBlocks.doing',
    doneKey: 'tool.listBlocks.done',
    extractVars: (result) => {
      const text = readContentText(result);
      const parsed = tryParseJson<{ block_count?: number }>(text);
      return parsed?.block_count != null ? { n: parsed.block_count } : undefined;
    },
  },
  'mcp__reels__read_block': {
    doingKey: 'tool.readBlock.doing',
    doneKey: 'tool.readBlock.done',
  },
  'mcp__reels__get_project_status': {
    doingKey: 'tool.getStatus.doing',
    doneKey: 'tool.getStatus.done',
  },
  'mcp__reels__edit_block_text': {
    doingKey: 'tool.editText.doing',
    doneKey: 'tool.editText.done',
  },
  'mcp__reels__regenerate_block': {
    doingKey: 'tool.regenBlock.doing',
    doneKey: 'tool.regenBlock.done',
  },
  'mcp__reels__add_block': {
    doingKey: 'tool.addBlock.doing',
    doneKey: 'tool.addBlock.done',
  },
  'mcp__reels__remove_block': {
    doingKey: 'tool.removeBlock.doing',
    doneKey: 'tool.removeBlock.done',
  },
  'mcp__reels__set_block_layout': {
    doingKey: 'tool.setLayout.doing',
    doneKey: 'tool.setLayout.done',
  },
  'mcp__reels__set_block_kind': {
    doingKey: 'tool.setKind.doing',
    doneKey: 'tool.setKind.done',
  },
  'mcp__reels__regenerate_draft_block': {
    doingKey: 'tool.regenDraftBlock.doing',
    doneKey: 'tool.regenDraftBlock.done',
  },
  'mcp__reels__replace_draft_block': {
    doingKey: 'tool.replaceDraftBlock.doing',
    doneKey: 'tool.replaceDraftBlock.done',
  },
  'mcp__reels__set_block_motion_html': {
    doingKey: 'tool.setMotion.doing',
    doneKey: 'tool.setMotion.done',
  },
  'mcp__reels__generate_audio': {
    doingKey: 'tool.genAudio.doing',
    doneKey: 'tool.genAudio.done',
  },
  'mcp__reels__add_broll_to_block': {
    doingKey: 'tool.addBroll.doing',
    doneKey: 'tool.addBroll.done',
  },
  'mcp__reels__remove_silences': {
    doingKey: 'tool.silences.doing',
    doneKey: 'tool.silences.done',
  },
  'mcp__reels__set_voice': {
    doingKey: 'tool.setVoice.doing',
    doneKey: 'tool.setVoice.done',
  },
  'mcp__reels__request_user_approval': {
    doingKey: 'tool.approvalPrompt.doing',
    doneKey: 'tool.approvalPrompt.done',
  },
  // Wave 1 — imports
  'mcp__reels__import_from_video_url': {
    doingKey: 'tool.importVideoUrl.doing',
    doneKey: 'tool.importVideoUrl.done',
    extractVars: (result) => {
      const text = readContentText(result);
      const parsed = tryParseJson<{ blocks?: number }>(text);
      return parsed?.blocks != null ? { n: parsed.blocks } : undefined;
    },
  },
  'mcp__reels__import_from_article': {
    doingKey: 'tool.importArticle.doing',
    doneKey: 'tool.importArticle.done',
    extractVars: (result) => {
      const text = readContentText(result);
      const parsed = tryParseJson<{ blocks?: number }>(text);
      return parsed?.blocks != null ? { n: parsed.blocks } : undefined;
    },
  },
  'mcp__reels__import_from_script': {
    doingKey: 'tool.importScript.doing',
    doneKey: 'tool.importScript.done',
    extractVars: (result) => {
      const text = readContentText(result);
      const parsed = tryParseJson<{ blocks?: number }>(text);
      return parsed?.blocks != null ? { n: parsed.blocks } : undefined;
    },
  },
  'mcp__reels__recreate_full_script': {
    doingKey: 'tool.recreateScript.doing',
    doneKey: 'tool.recreateScript.done',
  },
  'mcp__reels__generate_carousel': {
    doingKey: 'tool.genCarousel.doing',
    doneKey: 'tool.genCarousel.done',
    extractVars: (result) => {
      const text = readContentText(result);
      const parsed = tryParseJson<{ slides?: number }>(text);
      return parsed?.slides != null ? { n: parsed.slides } : undefined;
    },
  },
  // Wave 2 — visual tools
  'mcp__reels__list_style_presets': {
    doingKey: 'tool.listPresets.doing',
    doneKey: 'tool.listPresets.done',
  },
  'mcp__reels__apply_style_preset': {
    doingKey: 'tool.applyPreset.doing',
    doneKey: 'tool.applyPreset.done',
  },
  'mcp__reels__apply_style_preset_cascade': {
    doingKey: 'tool.applyPresetCascade.doing',
    doneKey: 'tool.applyPresetCascade.done',
  },
  'mcp__reels__generate_motion_for_block': {
    doingKey: 'tool.genMotion.doing',
    doneKey: 'tool.genMotion.done',
  },
  'mcp__reels__generate_motion_for_blocks': {
    doingKey: 'tool.genMotionBatch.doing',
    doneKey: 'tool.genMotionBatch.done',
    extractVars: (result) => {
      const text = readContentText(result);
      const parsed = tryParseJson<{ ok?: number; failed?: number; count?: number }>(text);
      if (parsed?.ok == null) return undefined;
      return {
        n: parsed.ok,
        // i18n template can use {failed} too if you want "7 ok, 1 falhou"
        failed: parsed.failed ?? 0,
      };
    },
  },
  'mcp__reels__render_motions': {
    doingKey: 'tool.renderMotions.doing',
    doneKey: 'tool.renderMotions.done',
  },
  'mcp__reels__generate_avatar_clips': {
    doingKey: 'tool.genAvatarClips.doing',
    doneKey: 'tool.genAvatarClips.done',
  },
  'mcp__reels__list_avatar_photos': {
    doingKey: 'tool.listPhotos.doing',
    doneKey: 'tool.listPhotos.done',
  },
  'mcp__reels__pick_avatar_photo': {
    doingKey: 'tool.pickPhoto.doing',
    doneKey: 'tool.pickPhoto.done',
  },
  'mcp__reels__set_avatar_photo': {
    doingKey: 'tool.setPhoto.doing',
    doneKey: 'tool.setPhoto.done',
  },
  'mcp__reels__upload_avatar_photo': {
    doingKey: 'tool.uploadPhoto.doing',
    doneKey: 'tool.uploadPhoto.done',
  },
  'mcp__reels__set_avatar_model': {
    doingKey: 'tool.setAvatarModel.doing',
    doneKey: 'tool.setAvatarModel.done',
  },
  // Wave 3 — caption + config + motion edit
  'mcp__reels__generate_caption_instagram': {
    doingKey: 'tool.genCaption.doing',
    doneKey: 'tool.genCaption.done',
  },
  'mcp__reels__set_emotion': {
    doingKey: 'tool.setEmotion.doing',
    doneKey: 'tool.setEmotion.done',
  },
  'mcp__reels__set_app_theme': {
    doingKey: 'tool.setAppTheme.doing',
    doneKey: 'tool.setAppTheme.done',
  },
  'mcp__reels__set_project_name': {
    doingKey: 'tool.setProjectName.doing',
    doneKey: 'tool.setProjectName.done',
  },
  'mcp__reels__edit_motion_html': {
    doingKey: 'tool.editMotionHtml.doing',
    doneKey: 'tool.editMotionHtml.done',
  },
  // Wave 3 — voice
  'mcp__reels__list_voices': {
    doingKey: 'tool.listVoices.doing',
    doneKey: 'tool.listVoices.done',
  },
  'mcp__reels__pick_voice': {
    doingKey: 'tool.pickVoice.doing',
    doneKey: 'tool.pickVoice.done',
  },
  'mcp__reels__set_voice_speed': {
    doingKey: 'tool.setVoiceSpeed.doing',
    doneKey: 'tool.setVoiceSpeed.done',
  },
  'mcp__reels__clone_voice_from_audio': {
    doingKey: 'tool.cloneVoice.doing',
    doneKey: 'tool.cloneVoice.done',
  },
  // Wave 3 — assets + references
  'mcp__reels__list_assets': {
    doingKey: 'tool.listAssets.doing',
    doneKey: 'tool.listAssets.done',
  },
  'mcp__reels__attach_asset_from_path': {
    doingKey: 'tool.attachAsset.doing',
    doneKey: 'tool.attachAsset.done',
  },
  'mcp__reels__list_references': {
    doingKey: 'tool.listRefs.doing',
    doneKey: 'tool.listRefs.done',
  },
  'mcp__reels__delete_reference': {
    doingKey: 'tool.deleteRef.doing',
    doneKey: 'tool.deleteRef.done',
  },
  'mcp__reels__reanalyse_reference': {
    doingKey: 'tool.reanalyse.doing',
    doneKey: 'tool.reanalyse.done',
  },
};

export function labelFor(toolName: string): ToolLabel {
  return TOOL_LABELS[toolName] ?? unknownLabelFor(toolName);
}

// Fallback for tools we haven't mapped to a friendly i18n string yet
// (e.g. a newly added MCP tool, or built-in CLI tools the agent ends up
// using). Strips the `mcp__<server>__` prefix and humanises the snake_case
// name so the pill says "Editing audio…" instead of an opaque "Working…".
function unknownLabelFor(toolName: string): ToolLabel {
  const friendly = humanise(toolName);
  return {
    doingKey: `__raw__:${friendly}…`,
    doneKey: `__raw__:✓ ${friendly}`,
  };
}

function humanise(toolName: string): string {
  const tail = toolName.replace(/^mcp__[^_]+__/, '');
  if (!tail) return toolName;
  const words = tail.split('_').filter(Boolean);
  if (words.length === 0) return tail;
  const first = words[0];
  const rest = words.slice(1).join(' ');
  return rest ? `${capitalise(first)} ${rest}` : capitalise(first);
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
