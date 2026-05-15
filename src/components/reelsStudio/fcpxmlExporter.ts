/**
 * Generates an FCPXML 1.10 document describing the Reels Studio timeline.
 * The XML references media files by relative path — bundled together in a zip.
 *
 * Track layout exported:
 *   - Spine (primary video track): one clip per script block, in order.
 *   - Connected B-roll clips (only when present): float over the spine.
 *   - Connected audio clip: the full Minimax narration over the whole project.
 *
 * Avatar block audio is muted via `audioRole="dialogue.disabled"` and
 * `<audio-channel-source ... active="0"/>` so the user doesn't hear duplicate audio.
 */

import type { ReelsState, ScriptBlock, ScreenTake, AvatarClipState } from './types';
import { computeLayout } from './timeline';
import { getLayoutSlots } from './layouts';

export interface FcpxmlMediaRef {
  /** filename used inside the zip (no folders). */
  filename: string;
  /** original Blob */
  blob: Blob;
}

export interface FcpxmlExportResult {
  xml: string;
  /** Files that should be bundled alongside the .fcpxml in the zip. */
  files: FcpxmlMediaRef[];
}

const FRAMERATE = 30;
const TIMESCALE = 30000; // 30000/30000s units → 1 frame at 30fps = 1000/timescale

const formatTime = (sec: number): string => {
  // FCPXML uses rational time: e.g. "150150/30000s" for 5.005s.
  const ticks = Math.round(sec * TIMESCALE);
  return `${ticks}/${TIMESCALE}s`;
};

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;')
   .replace(/</g, '&lt;')
   .replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;')
   .replace(/'/g, '&apos;');

const sanitizeFilenameStem = (s: string): string =>
  s.normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 40) || 'reel';

const dimensionsForAspect = (aspect: ReelsState['aspect']): { width: number; height: number } => {
  if (aspect === '16:9') return { width: 1920, height: 1080 };
  if (aspect === '1:1')  return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
};

interface ResourceMaps {
  formatId: string;
  audioAssetId: string | null;
  clipAssetIds: Map<string, string>; // blockId → assetId
  takeAssetId: string | null;
  /** blockId → assetId of the rendered motion MP4. Present only for
   *  blocks whose motion is ready (status === 'ready' + videoPath). */
  motionAssetIds: Map<string, string>;
}

/** Build the <resources> section. */
const buildResources = (
  state: ReelsState,
  audioFile: FcpxmlMediaRef | null,
  clipFiles: { blockId: string; file: FcpxmlMediaRef }[],
  takeFile: FcpxmlMediaRef | null,
  motionFiles: { blockId: string; file: FcpxmlMediaRef; durationSec: number }[],
): { xml: string; maps: ResourceMaps } => {
  const { width, height } = dimensionsForAspect(state.aspect);
  const formatId = 'r1';
  const lines: string[] = [];
  lines.push(`<format id="${formatId}" name="FFVideoFormat${width}x${height}p${FRAMERATE}" frameDuration="1000/${TIMESCALE}s" width="${width}" height="${height}"/>`);

  const maps: ResourceMaps = {
    formatId,
    audioAssetId: null,
    clipAssetIds: new Map(),
    takeAssetId: null,
    motionAssetIds: new Map(),
  };

  let assetCounter = 2;

  if (audioFile) {
    const id = `r${assetCounter++}`;
    maps.audioAssetId = id;
    lines.push(`<asset id="${id}" name="${xmlEscape(audioFile.filename)}" src="./${xmlEscape(audioFile.filename)}" hasAudio="1" duration="${formatTime(state.audio.duration)}"/>`);
  }

  for (const cf of clipFiles) {
    const id = `r${assetCounter++}`;
    maps.clipAssetIds.set(cf.blockId, id);
    const block = state.blocks.find(b => b.id === cf.blockId);
    const dur = block ? Math.max(0.1, block.end - block.start) : 1;
    lines.push(`<asset id="${id}" name="${xmlEscape(cf.file.filename)}" src="./${xmlEscape(cf.file.filename)}" hasVideo="1" hasAudio="1" duration="${formatTime(dur)}" format="${formatId}"/>`);
  }

  if (takeFile) {
    const id = `r${assetCounter++}`;
    maps.takeAssetId = id;
    const take = state.takes.find(t => t.id === state.activeTakeId);
    const takeDur = take ? Math.max(0.1, take.durationMs / 1000) : 10;
    lines.push(`<asset id="${id}" name="${xmlEscape(takeFile.filename)}" src="./${xmlEscape(takeFile.filename)}" hasVideo="1" hasAudio="1" duration="${formatTime(takeDur)}" format="${formatId}"/>`);
  }

  // Motion graphics MP4s — one asset per block with a ready motion.
  // No audio (motions are silent by design), so hasAudio="0".
  for (const mf of motionFiles) {
    const id = `r${assetCounter++}`;
    maps.motionAssetIds.set(mf.blockId, id);
    lines.push(`<asset id="${id}" name="${xmlEscape(mf.file.filename)}" src="./${xmlEscape(mf.file.filename)}" hasVideo="1" hasAudio="0" duration="${formatTime(mf.durationSec)}" format="${formatId}"/>`);
  }

  return { xml: lines.map(l => '    ' + l).join('\n'), maps };
};

/**
 * Build clip elements for the project spine (video track 1).
 * Each script block becomes one spine entry. Avatar blocks reference their HeyGen clip;
 * B-roll blocks reference the active take (or a gap if none).
 *
 * `avatarVisibleSec` and split layouts are flattened conservatively:
 *   - We export each block as a single spine clip using its primary video.
 *   - For Avatar blocks where avatarVisibleSec < blockLen, we still export the avatar clip
 *     (the user can trim or replace it in CapCut). The B-roll cover is added separately
 *     as a connected clip.
 */
const buildSpine = (state: ReelsState, maps: ResourceMaps): string => {
  const layout = computeLayout(state.blocks);
  const lines: string[] = [];

  for (const slot of layout.slots) {
    const block = state.blocks.find(b => b.id === slot.blockId);
    if (!block) continue;
    const blockDur = slot.projectEnd - slot.projectStart;

    if (block.kind === 'avatar') {
      const assetId = maps.clipAssetIds.get(block.id);
      if (assetId) {
        // Avatar clip on the spine. Mute its audio (we have a separate Minimax track).
        lines.push(
          `        <asset-clip name="${xmlEscape(block.text.slice(0, 40) || 'Avatar')}" ref="${assetId}" offset="${formatTime(slot.projectStart)}" start="0/${TIMESCALE}s" duration="${formatTime(blockDur)}" tcFormat="NDF" audioRole="dialogue">\n` +
          `          <adjust-volume amount="-96dB"/>\n` +
          `        </asset-clip>`
        );
      } else {
        // No clip generated yet — drop a gap with the block text as a marker.
        lines.push(
          `        <gap name="${xmlEscape(block.text.slice(0, 40) || 'Avatar (no clip)')}" offset="${formatTime(slot.projectStart)}" start="0/${TIMESCALE}s" duration="${formatTime(blockDur)}"/>`
        );
      }
    } else {
      // B-roll: try to use the active take, otherwise a gap.
      if (maps.takeAssetId) {
        const take = state.takes.find(t => t.id === state.activeTakeId);
        const takeStart = take?.trimStart ?? 0;
        lines.push(
          `        <asset-clip name="${xmlEscape('B-roll')}" ref="${maps.takeAssetId}" offset="${formatTime(slot.projectStart)}" start="${formatTime(takeStart)}" duration="${formatTime(blockDur)}" tcFormat="NDF" audioRole="dialogue">\n` +
          `          <adjust-volume amount="-96dB"/>\n` +
          `        </asset-clip>`
        );
      } else {
        lines.push(
          `        <gap name="${xmlEscape('B-roll (no take)')}" offset="${formatTime(slot.projectStart)}" start="0/${TIMESCALE}s" duration="${formatTime(blockDur)}"/>`
        );
      }
    }
  }
  return lines.join('\n');
};

/**
 * Build connected clips (overlays). Used for:
 *   - The Minimax audio track over the full project.
 *   - B-roll covers when Avatar blocks have avatarVisibleSec < blockLen.
 *   - Layout splits (avatar-top / media-top): we add the second video as a connected clip
 *     with a transform that anchors it to the top/bottom half.
 */
const buildConnectedClips = (state: ReelsState, maps: ResourceMaps): string => {
  const layout = computeLayout(state.blocks);
  const lines: string[] = [];

  // Connected audio: Minimax narration over the entire project.
  if (maps.audioAssetId) {
    lines.push(
      `        <asset-clip name="Narração" ref="${maps.audioAssetId}" lane="-1" offset="0/${TIMESCALE}s" start="0/${TIMESCALE}s" duration="${formatTime(state.audio.duration)}" audioRole="dialogue"/>`
    );
  }

  // B-roll covers for avatar blocks with limited visibility.
  if (maps.takeAssetId) {
    const take = state.takes.find(t => t.id === state.activeTakeId);
    const takeStart = take?.trimStart ?? 0;

    for (const slot of layout.slots) {
      const block = state.blocks.find(b => b.id === slot.blockId);
      if (!block || block.kind !== 'avatar') continue;
      const blockLen = slot.projectEnd - slot.projectStart;
      const blockLayout = block.layout ?? 'avatar-only';

      // Case 1: avatar visibility limited → cover with B-roll after cutoff.
      if (block.avatarVisibleSec !== undefined && block.avatarVisibleSec < blockLen) {
        const coverStart = slot.projectStart + block.avatarVisibleSec;
        const coverDur = blockLen - block.avatarVisibleSec;
        lines.push(
          `        <asset-clip name="B-roll cover" ref="${maps.takeAssetId}" lane="1" offset="${formatTime(coverStart)}" start="${formatTime(takeStart)}" duration="${formatTime(coverDur)}" audioRole="dialogue">\n` +
          `          <adjust-volume amount="-96dB"/>\n` +
          `        </asset-clip>`
        );
      }

      // Case 2: split layout → second source goes in a connected clip with transform.
      if (blockLayout !== 'avatar-only' && blockLayout !== 'media-only') {
        // For avatar-top: media goes in lane 1, lower half. For media-top: media goes in lane 1, upper half.
        const slots = getLayoutSlots(blockLayout);
        const mediaBox = slots.media;
        if (mediaBox) {
          // Translate normalized 0..1 box into a transform. CapCut/FCP expects scale + position
          // relative to the canvas center.
          const dims = dimensionsForAspect(state.aspect);
          // Box center in canvas pixels (origin = top-left), then convert to FCP center-origin.
          const cxPx = (mediaBox.x + mediaBox.w / 2) * dims.width;
          const cyPx = (mediaBox.y + mediaBox.h / 2) * dims.height;
          const offsetX = cxPx - dims.width / 2;
          const offsetY = cyPx - dims.height / 2;
          // Scale so the media fills the box height (cover). Roughly the box height ratio.
          const scaleY = mediaBox.h;
          const scaleX = mediaBox.h * (dims.width / dims.height) / (dims.width / dims.height); // = mediaBox.h
          lines.push(
            `        <asset-clip name="B-roll split" ref="${maps.takeAssetId}" lane="1" offset="${formatTime(slot.projectStart)}" start="${formatTime(takeStart)}" duration="${formatTime(blockLen)}" audioRole="dialogue">\n` +
            `          <adjust-volume amount="-96dB"/>\n` +
            `          <adjust-transform position="${offsetX.toFixed(1)} ${offsetY.toFixed(1)}" scale="${scaleX.toFixed(3)} ${scaleY.toFixed(3)}"/>\n` +
            `        </asset-clip>`
          );
        }
      }
    }
  }

  // Motion graphics — one connected clip per block whose motion is
  // ready. Placed on lane 2 (above the b-roll covers on lane 1) so
  // editors see the motion on top in CapCut's timeline. For split
  // layouts (avatar-top / media-top) the motion is positioned in
  // the media half of the canvas via adjust-transform.
  for (const slot of layout.slots) {
    const block = state.blocks.find(b => b.id === slot.blockId);
    if (!block) continue;
    const motionAssetId = maps.motionAssetIds.get(block.id);
    if (!motionAssetId) continue;
    const blockLen = slot.projectEnd - slot.projectStart;
    const motionDur = Math.min(blockLen, block.motion?.durationSec ?? blockLen);
    const blockLayout = block.layout ?? (block.kind === 'avatar' ? 'avatar-only' : 'media-only');

    // Decide where on the canvas the motion sits.
    // - broll block (media-only) → full frame
    // - avatar-only with motion → overlay full frame
    // - avatar-top → motion in bottom half
    // - media-top → motion in top half
    let transformXml = '';
    if (blockLayout === 'avatar-top' || blockLayout === 'media-top') {
      const slots = getLayoutSlots(blockLayout);
      const mediaBox = slots.media;
      if (mediaBox) {
        const dims = dimensionsForAspect(state.aspect);
        const cxPx = (mediaBox.x + mediaBox.w / 2) * dims.width;
        const cyPx = (mediaBox.y + mediaBox.h / 2) * dims.height;
        const offsetX = cxPx - dims.width / 2;
        const offsetY = cyPx - dims.height / 2;
        const scale = mediaBox.h;
        transformXml = `          <adjust-transform position="${offsetX.toFixed(1)} ${offsetY.toFixed(1)}" scale="${scale.toFixed(3)} ${scale.toFixed(3)}"/>\n`;
      }
    }

    lines.push(
      `        <asset-clip name="Motion" ref="${motionAssetId}" lane="2" offset="${formatTime(slot.projectStart)}" start="0/${TIMESCALE}s" duration="${formatTime(motionDur)}">\n` +
      transformXml +
      `        </asset-clip>`
    );
  }

  return lines.join('\n');
};

export interface FcpxmlMotionFile {
  blockId: string;
  file: FcpxmlMediaRef;
  durationSec: number;
}

export const buildFcpxml = (
  state: ReelsState,
  audioFile: FcpxmlMediaRef | null,
  clipFiles: { blockId: string; file: FcpxmlMediaRef }[],
  takeFile: FcpxmlMediaRef | null,
  motionFiles: FcpxmlMotionFile[] = [],
): string => {
  const projectName = sanitizeFilenameStem(state.projectName);
  const totalDuration = computeLayout(state.blocks).totalDuration || state.audio.duration;
  const { xml: resourcesXml, maps } = buildResources(state, audioFile, clipFiles, takeFile, motionFiles);
  const spine = buildSpine(state, maps);
  const connected = buildConnectedClips(state, maps);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
${resourcesXml}
  </resources>
  <library>
    <event name="${xmlEscape(projectName)}">
      <project name="${xmlEscape(projectName)}">
        <sequence format="${maps.formatId}" duration="${formatTime(totalDuration)}" tcStart="0/${TIMESCALE}s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spine}
${connected}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
};

/** Filename stems used inside the package. */
export const buildFilenames = (state: ReelsState): {
  projectStem: string;
  fcpxmlName: string;
  audioName: string;
  clipName: (blockId: string, index: number) => string;
  takeName: string;
  readmeName: string;
} => {
  const stem = sanitizeFilenameStem(state.projectName);
  return {
    projectStem: stem,
    fcpxmlName: `${stem}.fcpxml`,
    audioName: 'audio.mp3',
    clipName: (_id, idx) => `clip-avatar-${String(idx + 1).padStart(2, '0')}.mp4`,
    takeName: 'broll-take.mp4',
    readmeName: 'README.txt',
  };
};

export const buildReadme = (state: ReelsState): string => {
  const layout = computeLayout(state.blocks);
  const lines: string[] = [
    `Reels Studio export — ${state.projectName}`,
    `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    `Duração: ${(layout.totalDuration || state.audio.duration).toFixed(1)}s · Aspect: ${state.aspect}`,
    ``,
    `📂 Arquivos no pacote:`,
    `  - <projeto>.fcpxml ........ Timeline pra importar no CapCut/Premiere/DaVinci/Final Cut`,
    `  - audio.mp3 ............... Narração Minimax (faixa principal de áudio)`,
    `  - clip-avatar-NN.mp4 ...... Clipes de avatar HeyGen, um por bloco`,
    `  - broll-take.mp4 .......... Screen recording / B-roll (se houver take ativo)`,
    ``,
    `🎬 Como importar no CapCut Desktop:`,
    `  1. Descompacte este zip em uma pasta`,
    `  2. Abra o CapCut`,
    `  3. Arquivo > Importar > Selecione o .fcpxml`,
    `  4. Os clipes vão aparecer já posicionados na timeline`,
    `  5. O áudio dos clipes Avatar já vem MUTADO (a narração vem do audio.mp3)`,
    ``,
    `⚠️ Limitações conhecidas em CapCut Desktop:`,
    `  - Layouts split (Avatar+Mídia divididos) podem chegar como clipes simples;`,
    `    aplique o efeito "split screen" do CapCut nos blocos marcados como split.`,
    `  - Cortes de silêncio (silence cut) NÃO são exportados — re-aplique se quiser.`,
    ``,
    `📋 Estrutura do reel (ordem dos blocos):`,
  ];

  state.blocks.forEach((b, i) => {
    const slot = layout.slots[i];
    const range = slot ? `${slot.projectStart.toFixed(1)}s → ${slot.projectEnd.toFixed(1)}s` : '?';
    const layoutLabel = b.kind === 'avatar' ? `[${b.layout ?? 'avatar-only'}]` : '[B-roll]';
    const visTag = b.kind === 'avatar' && b.avatarVisibleSec !== undefined ? ` (avatar visível ${b.avatarVisibleSec.toFixed(1)}s)` : '';
    lines.push(`  ${String(i + 1).padStart(2, '0')}. ${range}  ${layoutLabel}${visTag}  "${b.text.slice(0, 60)}${b.text.length > 60 ? '…' : ''}"`);
  });

  lines.push(``, `Bom corte! 🎬`);
  return lines.join('\n');
};
