// Thin wrappers around the Rust agent commands. Keeps `invoke()` strings out
// of UI components so renames stay safe.

import { invoke } from '@tauri-apps/api/core';
import type { ClaudeHealth, ReelsSnapshot } from './types';

export async function publishSnapshot(snapshot: ReelsSnapshot): Promise<number> {
  return invoke<number>('agent_publish_state', { snapshot });
}

export async function getMcpPort(): Promise<number | null> {
  const port = await invoke<number | null>('agent_mcp_port');
  return port ?? null;
}

export async function getHealth(): Promise<ClaudeHealth> {
  return invoke<ClaudeHealth>('agent_health');
}

export async function registerMcp(): Promise<void> {
  await invoke<void>('agent_register_mcp');
}
