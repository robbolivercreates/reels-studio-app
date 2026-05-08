/**
 * Builds a zip package for CapCut/Premiere/DaVinci import:
 *   - <projeto>.fcpxml          → timeline file
 *   - audio.mp3                  → Minimax narration
 *   - clip-avatar-NN.mp4         → HeyGen renders, one per Avatar block (in order)
 *   - broll-take.mp4 (optional)  → active screen-recording take
 *   - README.txt                 → import instructions in pt-BR
 */

import JSZip from 'jszip';
import {
  loadAudioBlob,
  loadAllClipBlobs,
  loadTakeBlob,
} from './persistence';
import {
  buildFcpxml,
  buildFilenames,
  buildReadme,
  type FcpxmlMediaRef,
} from './fcpxmlExporter';
import type { ReelsState } from './types';

export interface PackageProgress {
  phase: 'loading' | 'building' | 'zipping' | 'done';
  message: string;
}

export interface PackageResult {
  blob: Blob;
  filename: string; // suggested zip filename
  size: number;
}

export const buildCapcutPackage = async (
  state: ReelsState,
  onProgress: (p: PackageProgress) => void = () => {},
): Promise<PackageResult> => {
  onProgress({ phase: 'loading', message: 'Lendo mídias salvas...' });

  // 1. Load all media from IndexedDB.
  const audioBlob = await loadAudioBlob();
  if (!audioBlob) throw new Error('Áudio não encontrado. Gere o áudio antes de exportar.');

  const allClips = await loadAllClipBlobs();
  const avatarBlocks = state.blocks.filter(b => b.kind === 'avatar');

  const takeBlob = state.activeTakeId ? await loadTakeBlob(state.activeTakeId) : null;

  onProgress({ phase: 'building', message: 'Montando timeline FCPXML...' });

  // 2. Build the file list with stable, predictable filenames.
  const names = buildFilenames(state);
  const audioRef: FcpxmlMediaRef = { filename: names.audioName, blob: audioBlob };

  const clipFiles: { blockId: string; file: FcpxmlMediaRef }[] = [];
  let avatarIdx = 0;
  for (const b of state.blocks) {
    if (b.kind !== 'avatar') continue;
    const clipBlob = allClips[b.id];
    if (clipBlob) {
      clipFiles.push({
        blockId: b.id,
        file: { filename: names.clipName(b.id, avatarIdx), blob: clipBlob },
      });
    }
    avatarIdx++;
  }

  let takeRef: FcpxmlMediaRef | null = null;
  if (takeBlob) {
    // Use the take's mime type to pick an extension.
    const mime = takeBlob.type || 'video/webm';
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : 'mp4';
    takeRef = {
      filename: `broll-take.${ext}`,
      blob: takeBlob,
    };
  }

  // 3. Generate the FCPXML.
  const xml = buildFcpxml(state, audioRef, clipFiles, takeRef);
  const readme = buildReadme(state);

  onProgress({ phase: 'zipping', message: 'Compactando arquivos...' });

  // 4. Bundle everything into a zip.
  const zip = new JSZip();
  zip.file(names.fcpxmlName, xml);
  zip.file(names.readmeName, readme);
  zip.file(audioRef.filename, audioRef.blob);
  for (const cf of clipFiles) {
    zip.file(cf.file.filename, cf.file.blob);
  }
  if (takeRef) zip.file(takeRef.filename, takeRef.blob);

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' }, // STORE — videos already compressed; deflate would be slow + useless
    (meta) => onProgress({ phase: 'zipping', message: `Compactando... ${Math.round(meta.percent)}%` }),
  );

  onProgress({ phase: 'done', message: 'Pacote pronto!' });

  return {
    blob,
    filename: `${names.projectStem}-capcut.zip`,
    size: blob.size,
  };
};

/** Trigger the browser download of a built package. */
export const downloadPackage = (pkg: PackageResult): void => {
  const url = URL.createObjectURL(pkg.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = pkg.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ─── Tauri-only: 1-click open in CapCut Desktop ────────────────────────
// Saves the FCPXML + media files into ~/Movies/Reels Studio/<projeto>/ and
// asks CapCut to open the FCPXML. CapCut imports the timeline and creates a
// new project with everything wired up — single click for the user.

export interface OpenCapcutResult {
  fcpxmlPath: string;
  folderPath: string;
}

const blobToBytes = async (blob: Blob): Promise<number[]> => {
  const buffer = await blob.arrayBuffer();
  // Tauri's invoke serializes Vec<u8> as a number array — converting via
  // Array.from is straightforward and avoids edge-case issues with typed-array
  // bridging on older Tauri versions.
  return Array.from(new Uint8Array(buffer));
};

export const openCapcutProject = async (
  state: ReelsState,
  onProgress: (p: PackageProgress) => void = () => {},
): Promise<OpenCapcutResult> => {
  onProgress({ phase: 'loading', message: 'Lendo mídias salvas...' });

  const audioBlob = await loadAudioBlob();
  if (!audioBlob) throw new Error('Áudio não encontrado. Gere o áudio antes de exportar.');

  const allClips = await loadAllClipBlobs();
  const takeBlob = state.activeTakeId ? await loadTakeBlob(state.activeTakeId) : null;

  onProgress({ phase: 'building', message: 'Montando timeline FCPXML...' });

  const names = buildFilenames(state);
  const audioRef: FcpxmlMediaRef = { filename: names.audioName, blob: audioBlob };

  const clipFiles: { blockId: string; file: FcpxmlMediaRef }[] = [];
  let avatarIdx = 0;
  for (const b of state.blocks) {
    if (b.kind !== 'avatar') continue;
    const clipBlob = allClips[b.id];
    if (clipBlob) {
      clipFiles.push({
        blockId: b.id,
        file: { filename: names.clipName(b.id, avatarIdx), blob: clipBlob },
      });
    }
    avatarIdx++;
  }

  let takeRef: FcpxmlMediaRef | null = null;
  if (takeBlob) {
    const mime = takeBlob.type || 'video/webm';
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : 'mp4';
    takeRef = { filename: `broll-take.${ext}`, blob: takeBlob };
  }

  const xml = buildFcpxml(state, audioRef, clipFiles, takeRef);

  onProgress({ phase: 'zipping', message: 'Salvando arquivos...' });

  const mediaFiles: { name: string; bytes: number[] }[] = [];
  mediaFiles.push({ name: audioRef.filename, bytes: await blobToBytes(audioRef.blob) });
  for (const cf of clipFiles) {
    mediaFiles.push({ name: cf.file.filename, bytes: await blobToBytes(cf.file.blob) });
  }
  if (takeRef) {
    mediaFiles.push({ name: takeRef.filename, bytes: await blobToBytes(takeRef.blob) });
  }

  // Tauri command lives in src-tauri/src/capcut.rs.
  const { invoke } = await import('@tauri-apps/api/core');
  const saved = await invoke<{ fcpxml_path: string; folder_path: string }>(
    'save_capcut_project',
    {
      projectName: state.projectName || 'Reel sem título',
      fcpxmlName: names.fcpxmlName,
      fcpxmlContent: xml,
      media: mediaFiles,
    },
  );

  onProgress({ phase: 'done', message: 'Abrindo CapCut...' });

  // If CapCut isn't installed this throws — caller should surface a helpful
  // fallback (reveal folder so user can drag the file into CapCut manually).
  await invoke('open_in_capcut', { fcpxmlPath: saved.fcpxml_path });

  return {
    fcpxmlPath: saved.fcpxml_path,
    folderPath: saved.folder_path,
  };
};

export const revealCapcutFolder = async (folderPath: string): Promise<void> => {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('reveal_capcut_folder', { folderPath });
};

// ─── Tauri-only: native CapCut draft (.draft format) ────────────────────
// This is the preferred path. Writes the project directly into CapCut's
// Projects folder so it shows up under "Recent" with the timeline already
// assembled — no FCPXML import dialog. The FCPXML zip path remains as a
// fallback for users without CapCut Desktop.

export interface OpenCapcutDraftResult {
  draftPath: string;
  mediaPath: string;
}

const probeVideoBlob = (blob: Blob): Promise<{ width: number; height: number; duration: number }> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadedmetadata = () => {
      const result = {
        width: video.videoWidth || 1920,
        height: video.videoHeight || 1080,
        duration: video.duration && isFinite(video.duration) ? video.duration : 0,
      };
      cleanup();
      resolve(result);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('Falha ao ler metadados do vídeo'));
    };
    video.src = url;
  });
};

const probeAudioBlob = (blob: Blob): Promise<number> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const cleanup = () => URL.revokeObjectURL(url);
    audio.onloadedmetadata = () => {
      const dur = audio.duration && isFinite(audio.duration) ? audio.duration : 0;
      cleanup();
      resolve(dur);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('Falha ao ler metadados do áudio'));
    };
    audio.src = url;
  });
};

/**
 * Optional ref-backed cut data the caller can pass in. Used so the export
 * path is independent of React state quirks (HMR remounts, reducer races):
 * if the caller has the cut audio blob/blocks/duration in refs, we use them
 * directly and skip the state-based detection.
 */
export interface CutOverride {
  audioBlob: Blob;
  blocks: ReelsState['blocks'];
  duration: number;
}

export const openCapcutDraft = async (
  state: ReelsState,
  onProgress: (p: PackageProgress) => void = () => {},
  cutOverride?: CutOverride,
): Promise<OpenCapcutDraftResult> => {
  onProgress({ phase: 'loading', message: 'Lendo mídias salvas...' });

  // Audio source priority:
  //   1. Explicit override from refs (set by ReelsStudio when cuts were
  //      applied this session — bypasses any state stalled across HMR)
  //   2. state.audio.url when cutsApplied is true
  //   3. IndexedDB original
  let audioBlob: Blob | null = null;
  let audioSource = '';
  if (cutOverride) {
    audioBlob = cutOverride.audioBlob;
    audioSource = 'cut audio (ref override)';
  } else if (state.audio.cutsApplied && state.audio.url) {
    try {
      const resp = await fetch(state.audio.url);
      audioBlob = await resp.blob();
      audioSource = 'cut audio (in-memory)';
    } catch (err) {
      console.warn('[reels/capcut-draft] failed to read cut audio from URL, falling back to IDB', err);
    }
  }
  if (!audioBlob) {
    audioBlob = await loadAudioBlob();
    audioSource = 'IndexedDB original';
  }
  if (!audioBlob) throw new Error('Áudio não encontrado. Gere o áudio antes de exportar.');
  console.log('[reels/capcut-draft] audio source:', audioSource, '· size=', audioBlob.size, '· cutsApplied=', state.audio.cutsApplied, '· state.audio.duration=', state.audio.duration);

  // If the caller passed a cut override, use the cut blocks/duration too —
  // otherwise fall back to whatever's in state. Both stay in sync because
  // the override is set in the same effect that dispatches apply-done.
  const effectiveBlocks = cutOverride ? cutOverride.blocks : state.blocks;
  const effectiveDuration = cutOverride ? cutOverride.duration : state.audio.duration;
  const stateForBuild: ReelsState = cutOverride
    ? { ...state, blocks: effectiveBlocks, audio: { ...state.audio, duration: effectiveDuration, cutsApplied: true } }
    : state;
  const allClips = await loadAllClipBlobs();
  console.log('[reels/capcut-draft] avatar clips loaded from IDB:', Object.keys(allClips).length, '· blockIds with clip:', Object.keys(allClips));
  const motionBlocks = effectiveBlocks.filter(b => b.motion?.status === 'ready' && b.motion?.videoPath);
  console.log('[reels/capcut-draft] blocks with ready motions:', motionBlocks.length);
  for (const b of effectiveBlocks) {
    console.log('  - block', b.id, '·', b.kind, '· motion:', b.motion ? `${b.motion.status} hasPath=${!!b.motion.videoPath}` : 'none');
  }

  const projectName = state.projectName || 'Reel sem título';

  // Resolve target paths via Rust so the JSON we write contains absolute
  // paths matching the actual disk locations.
  const { invoke } = await import('@tauri-apps/api/core');
  const mediaPath = await invoke<string>('capcut_media_dir_for', { projectName });
  const draftPath = await invoke<string>('capcut_draft_dir_for', { projectName });

  onProgress({ phase: 'building', message: 'Lendo metadados...' });

  // Audio duration: prefer the effective (override-aware) value, fall back to probing.
  const audioDurationSec = effectiveDuration > 0
    ? effectiveDuration
    : await probeAudioBlob(audioBlob);

  // Probe each avatar clip blob for width/height/duration.
  // IMPORTANT: iterate over `effectiveBlocks` (= cut-remapped blocks when
  // override is active) so the start/end timestamps used in the FCPXML / draft
  // match the cut audio duration. Iterating over `state.blocks` here would
  // emit the un-remapped timings and CapCut would drift past the cut audio.
  const clipsByBlockId: Record<string, { path: string; filename: string; durationSec: number; width: number; height: number; hasAudio: boolean }> = {};
  let avatarIdx = 0;
  for (const b of effectiveBlocks) {
    if (b.kind !== 'avatar') continue;
    const clipBlob = allClips[b.id];
    if (clipBlob) {
      try {
        const meta = await probeVideoBlob(clipBlob);
        const filename = `clip-avatar-${String(avatarIdx + 1).padStart(2, '0')}.mp4`;
        clipsByBlockId[b.id] = {
          path: `${mediaPath}/${filename}`,
          filename,
          durationSec: meta.duration || (b.end - b.start),
          width: meta.width,
          height: meta.height,
          hasAudio: true,
        };
      } catch (err) {
        console.warn('[reels/capcut-draft] probe failed for', b.id, err);
      }
    }
    avatarIdx++;
  }

  // Collect rendered motions and COPY them into the project media folder.
  // CapCut Desktop is sandboxed and only reads media from inside ~/Movies —
  // pointing at ~/Reels Studio/Motions/<id>/output.mp4 directly causes
  // "Arquivo não acessível" because that path is outside CapCut's sandbox.
  // We read each motion's bytes via convertFileSrc + fetch and add them to
  // the media payload that Rust writes into ~/Movies/Reels Studio/<project>/.
  const motionsByBlockId: Record<string, { path: string; filename: string; durationSec: number; width: number; height: number; hasAudio: boolean }> = {};
  const motionMedia: { name: string; bytes: number[] }[] = [];
  let motionIdx = 0;
  for (const b of effectiveBlocks) {
    const m = b.motion;
    if (!m || m.status !== 'ready' || !m.videoPath) {
      console.log('[reels/capcut-draft] skip motion for block', b.id, '·', m ? `status=${m.status} hasPath=${!!m.videoPath}` : 'no motion');
      continue;
    }
    try {
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const url = convertFileSrc(m.videoPath);
      console.log('[reels/capcut-draft] fetching motion', b.id, 'from', url);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
      const blob = await resp.blob();
      console.log('[reels/capcut-draft] motion fetched, size=', blob.size);
      const meta = await probeVideoBlob(blob);
      motionIdx++;
      const filename = `motion-${String(motionIdx).padStart(2, '0')}.mp4`;
      motionsByBlockId[b.id] = {
        // Path that CapCut will read — inside ~/Movies/Reels Studio/<project>/
        path: `${mediaPath}/${filename}`,
        filename,
        durationSec: meta.duration || m.durationSec,
        width: meta.width,
        height: meta.height,
        hasAudio: false,
      };
      motionMedia.push({ name: filename, bytes: await blobToBytes(blob) });
    } catch (err) {
      console.warn('[reels/capcut-draft] motion probe/copy failed for', b.id, err);
    }
  }

  const audioFilename = 'audio.mp3';
  const audioInfo = {
    path: `${mediaPath}/${audioFilename}`,
    filename: audioFilename,
    durationSec: audioDurationSec,
  };

  onProgress({ phase: 'building', message: 'Montando timeline do CapCut...' });

  const { buildCapcutDraft } = await import('./capcutDraftBuilder');
  const draft = buildCapcutDraft({
    state: stateForBuild,
    mediaDir: mediaPath,
    draftDir: draftPath,
    audio: audioInfo,
    clipsByBlockId,
    motionsByBlockId,
  });

  onProgress({ phase: 'zipping', message: 'Salvando arquivos...' });

  // Collect media bytes
  const media: { name: string; bytes: number[] }[] = [];
  media.push({ name: audioFilename, bytes: await blobToBytes(audioBlob) });
  for (const blockId of Object.keys(clipsByBlockId)) {
    const blob = allClips[blockId];
    const info = clipsByBlockId[blockId];
    if (blob && info) {
      media.push({ name: info.filename, bytes: await blobToBytes(blob) });
    }
  }
  // Motions were already read into bytes above (we needed to probe metadata).
  for (const m of motionMedia) media.push(m);

  const result = await invoke<{ draft_path: string; media_path: string }>(
    'save_capcut_draft',
    {
      projectName,
      files: {
        draft_info: draft.draftInfo,
        draft_meta: draft.draftMeta,
        draft_settings: draft.draftSettings,
        draft_agency_config: draft.draftAgencyConfig,
        draft_biz_config: draft.draftBizConfig,
      },
      media,
    },
  );

  onProgress({ phase: 'done', message: 'Abrindo CapCut...' });

  await invoke('open_capcut_app');

  return {
    draftPath: result.draft_path,
    mediaPath: result.media_path,
  };
};
