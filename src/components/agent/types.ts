// Public types for the agent subsystem. Shared between the React UI and the
// Tauri command wrappers in agentBridge.ts.

export interface ClaudeHealth {
  installed: boolean;
  authed: boolean;
  binary_path: string | null;
  registered: boolean;
  mcp_port: number | null;
}

/// Subset of ReelsState we publish to the Rust MCP server.
export interface ReelsSnapshot {
  project_id?: string | null;
  project_name?: string | null;
  aspect?: string | null;
  voice_id?: string | null;
  blocks: BlockSnapshot[];
  audio?: AudioSnapshot | null;
  analyses: AnalysisSnapshot[];
  version?: number;
}

export interface BlockSnapshot {
  id: string;
  kind: string;
  text: string;
  layout?: string | null;
  duration_sec?: number | null;
  start_sec?: number | null;
  end_sec?: number | null;
  asset_count?: number;
  has_motion?: boolean;
}

export interface AudioSnapshot {
  status: string;
  duration_sec?: number | null;
  silence_cut_on?: boolean;
  silence_preset?: string | null;
}

export interface AnalysisSnapshot {
  created_at: number;
  source_file?: string | null;
  source_url?: string | null;
  language?: string | null;
  tone?: string | null;
}
