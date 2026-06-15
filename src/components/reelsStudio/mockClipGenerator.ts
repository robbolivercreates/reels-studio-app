/**
 * Generates a synthetic test avatar clip for a given block.
 * Uses canvas + WebCodecs (same pipeline as mp4Renderer) to produce a real MP4
 * without requiring HeyGen. Useful for testing the full export pipeline.
 *
 * Visual: animated gradient background + block text + pulsing circle.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const FRAMERATE = 30;
const WIDTH = 720;
const HEIGHT = 1280; // 9:16

const COLORS = [
  ['#1e1b4b', '#4c1d95', '#3B82F6'],
  ['#0c4a6e', '#075985', '#06b6d4'],
  ['#064e3b', '#065f46', '#10b981'],
  ['#7f1d1d', '#991b1b', '#f87171'],
  ['#1c1917', '#292524', '#f59e0b'],
];

let colorIdx = 0;

export const generateMockClip = async (
  blockId: string,
  blockText: string,
  durationSec: number,
): Promise<{ url: string; blob: Blob }> => {
  const [bg1, bg2, accent] = COLORS[colorIdx % COLORS.length];
  colorIdx++;

  const totalFrames = Math.ceil(durationSec * FRAMERATE);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: WIDTH, height: HEIGHT, frameRate: FRAMERATE },
    fastStart: 'in-memory',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  encoder.configure({
    codec: 'avc1.640028',
    width: WIDTH,
    height: HEIGHT,
    bitrate: 1_500_000,
    framerate: FRAMERATE,
  });

  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const microsPerFrame = 1_000_000 / FRAMERATE;

  // Truncate text for display.
  const label = blockText.length > 60 ? blockText.slice(0, 57) + '…' : blockText;
  const shortId = blockId.slice(-6);

  for (let frame = 0; frame < totalFrames; frame++) {
    const t = frame / totalFrames; // 0..1 progress

    // Background gradient.
    const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    grad.addColorStop(0, bg1);
    grad.addColorStop(1, bg2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Pulsing circle (accent).
    const pulse = 0.85 + 0.15 * Math.sin(t * Math.PI * 2 * durationSec * 1.5);
    const radius = 120 * pulse;
    const circleGrad = ctx.createRadialGradient(WIDTH / 2, HEIGHT * 0.42, 0, WIDTH / 2, HEIGHT * 0.42, radius);
    circleGrad.addColorStop(0, accent + 'cc');
    circleGrad.addColorStop(1, accent + '00');
    ctx.fillStyle = circleGrad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // TEST CLIP label.
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'center';
    ctx.fillText('TEST CLIP · ' + shortId, WIDTH / 2, HEIGHT * 0.32);

    // Block text.
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    // Word-wrap: split into lines of ~20 chars.
    const words = label.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      if ((line + ' ' + word).trim().length > 22 && line.length > 0) {
        lines.push(line);
        line = word;
      } else {
        line = line ? line + ' ' + word : word;
      }
    }
    if (line) lines.push(line);
    const lineH = 62;
    const startY = HEIGHT * 0.48 - (lines.length * lineH) / 2;
    lines.forEach((l, i) => ctx.fillText(l, WIDTH / 2, startY + i * lineH));

    // Progress bar at bottom.
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(60, HEIGHT - 80, WIDTH - 120, 6);
    ctx.fillStyle = accent;
    ctx.fillRect(60, HEIGHT - 80, (WIDTH - 120) * t, 6);

    // Duration counter.
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'center';
    const elapsed = (frame / FRAMERATE).toFixed(1);
    ctx.fillText(`${elapsed}s / ${durationSec.toFixed(1)}s`, WIDTH / 2, HEIGHT - 40);

    const vf = new VideoFrame(canvas, {
      timestamp: Math.round(frame * microsPerFrame),
      duration: Math.round(microsPerFrame),
    });
    while (encoder.encodeQueueSize > 4) {
      await new Promise(r => setTimeout(r, 1));
    }
    encoder.encode(vf, { keyFrame: frame % (FRAMERATE * 2) === 0 });
    vf.close();
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const target = muxer.target as ArrayBufferTarget;
  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  return { url: URL.createObjectURL(blob), blob };
};
