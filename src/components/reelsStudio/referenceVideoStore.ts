/**
 * Reference video store — Tauri-native implementation.
 *
 * - Folder is fixed: ~/Reels Studio/References/  (auto-created on first call).
 * - All file I/O goes through Rust commands (see src-tauri/src/references.rs).
 * - Frontend only handles UI + Gemini analysis.
 *
 * Uses @tauri-apps/api/core::invoke and ::event::listen.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ReferenceMeta {
  id: string;
  fileName: string;
  absolutePath: string;
  sizeBytes: number;
  source: 'url' | 'upload';
  sourceUrl?: string;
  createdAt: number;
}

interface RustReferenceMeta {
  id: string;
  file_name: string;
  absolute_path: string;
  size_bytes: number;
  source: string;
  source_url?: string | null;
  created_at: number;
}

const fromRust = (m: RustReferenceMeta): ReferenceMeta => ({
  id: m.id,
  fileName: m.file_name,
  absolutePath: m.absolute_path,
  sizeBytes: m.size_bytes,
  source: m.source === 'url' ? 'url' : 'upload',
  sourceUrl: m.source_url ?? undefined,
  createdAt: m.created_at,
});

export const referencesDir = (): Promise<string> => invoke<string>('references_dir');

export const listReferences = async (): Promise<ReferenceMeta[]> => {
  const rows = await invoke<RustReferenceMeta[]>('list_references');
  return rows.map(fromRust);
};

export const deleteReference = (fileName: string): Promise<void> =>
  invoke('delete_reference', { fileName });

export const readReferenceBytes = async (fileName: string): Promise<Uint8Array> => {
  const arr = await invoke<number[]>('read_reference_bytes', { fileName });
  return new Uint8Array(arr);
};

export const saveImportedVideo = async (file: File | Blob, originalName: string): Promise<ReferenceMeta> => {
  const buffer = await file.arrayBuffer();
  const bytes = Array.from(new Uint8Array(buffer));
  const rust = await invoke<RustReferenceMeta>('save_imported_video', {
    bytes,
    originalName,
  });
  return fromRust(rust);
};

export const downloadVideo = async (url: string): Promise<ReferenceMeta> => {
  const rust = await invoke<RustReferenceMeta>('download_video', { url });
  return fromRust(rust);
};

export const revealReferencesDir = (): Promise<void> => invoke('reveal_references_dir');

export interface DownloadProgress {
  stage: 'starting' | 'downloading' | 'info' | 'done' | 'error';
  message: string;
  percent: number | null;
}

interface RustProgress {
  stage: string;
  message: string;
  percent: number | null;
}

export const onDownloadProgress = (
  cb: (p: DownloadProgress) => void,
): Promise<UnlistenFn> =>
  listen<RustProgress>('reference://download-progress', (e) => {
    const stage = (['starting', 'downloading', 'info', 'done', 'error'] as const).includes(
      e.payload.stage as DownloadProgress['stage'],
    )
      ? (e.payload.stage as DownloadProgress['stage'])
      : 'info';
    cb({ stage, message: e.payload.message, percent: e.payload.percent });
  });
