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
