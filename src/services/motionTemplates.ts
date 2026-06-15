/**
 * Static motion-graphic templates converted from the IBRA motion-pack
 * (github.com/halicotampa-crypto/motion-pack) to HyperFrames format.
 *
 * Each builder receives the block context + Gemini-filled variable values
 * and returns a complete HyperFrames-compatible HTML string ready for render.
 *
 * Template variable extraction is done by Gemini with a SMALL focused prompt
 * (just JSON variable values, not full HTML generation) — faster and more
 * reliable than letting Gemini write the full HTML.
 */

import type { GenerateMotionInput } from './motionService';
import { fetchBrandLogoAsDataUri, fetchAppStoreIconAsDataUri, KNOWN_BRAND_DOMAINS } from './logoFetchService';

export interface MotionTemplateVars {
  [key: string]: string;
}

export interface GenerationOutput {
  htmlBody: string;
  intent: string;
  text: string;
  rationale: string;
  modelUsed: string;
}

/**
 * Fetch a brand logo as base64 data-URI.
 * Chain: Clearbit (by domain) → iTunes App Store (by app name) → colored placeholder.
 * The iTunes fallback covers mobile-first apps without an obvious web domain (CapCut etc).
 */
async function fetchLogoOrPlaceholder(
  brandName: string,
  fallbackColor = '#333',
): Promise<string> {
  const lower = brandName.toLowerCase().trim();
  const domain = KNOWN_BRAND_DOMAINS[lower] ?? `${lower.replace(/\s+/g, '')}.com`;
  const dataUri = await fetchBrandLogoAsDataUri(domain);
  if (dataUri) return dataUri;
  const appStoreUri = await fetchAppStoreIconAsDataUri(brandName);
  if (appStoreUri) return appStoreUri;
  // Colored square SVG as fallback
  const letter = brandName[0]?.toUpperCase() ?? '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" rx="40" fill="${fallbackColor}"/><text x="100" y="130" text-anchor="middle" font-family="system-ui" font-size="100" font-weight="900" fill="white">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// ─── Base HTML shell ─────────────────────────────────────────────────────────

const BASE_HEAD = `<meta charset="utf-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"><\/script>`;

/**
 * Wrap an HTML body + script in a full HyperFrames-compatible document.
 * `durationSec` adds a no-op anchor tween at t=0 spanning the whole block so
 * `timeline.duration() >= block duration` — without it, a 3s template inside
 * an 8s block freezes/fades at 3s ("timeline integrity" rule).
 */
function wrapDoc(compId: string, width: number, height: number, styles: string, body: string, script: string, durationSec?: number): string {
  const dur = durationSec && durationSec > 0 ? durationSec : 0;
  // Breathing cycle: 2.6s per yoyo round-trip; enough repeats to cover the block.
  const breathRepeats = dur > 0 ? Math.max(1, Math.ceil(dur / 2.6)) : 0;
  const anchor = dur > 0
    ? [
        `tl.to({},{duration:${dur.toFixed(2)}},0);`,
        `tl.to("#hf-root",{scale:1.012,transformOrigin:"50% 50%",duration:1.3,yoyo:true,repeat:${breathRepeats * 2},ease:"sine.inOut"},0);`,
      ].join('\n')
    : '';
  return `<!DOCTYPE html><html><head>${BASE_HEAD}
<style>
html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;}
${styles}
</style>
</head><body>
<div id="hf-root" data-composition-id="${compId}" data-width="${width}" data-height="${height}" data-start="0">
${body}
</div>
<script>
(function(){
${script}
${anchor}
window.__timelines=window.__timelines||{};
window.__timelines["${compId}"]=tl;
})();
<\/script>
</body></html>`;
}

// ─── 1. Stat Counter ─────────────────────────────────────────────────────────

export function buildStatCounter(input: GenerateMotionInput, vars: MotionTemplateVars): GenerationOutput {
  const eyebrow  = vars.EYEBROW  || 'Resultado';
  const statNum  = vars.STAT_NUMBER || '21';
  const statUnit = vars.STAT_UNIT   || 'GB';
  const subtitle = vars.SUBTITLE    || '';
  const target   = parseFloat(statNum.replace(/[^0-9.]/g, '')) || 21;

  const styles = `
body{background:#0A0808;font-family:-apple-system,"Inter",sans-serif;color:#EDD9BC;}
body::after{content:"";position:absolute;inset:0;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1080 1920'><g fill='none' stroke='%23362A22' stroke-width='1.2' opacity='0.4'><path d='M -100,200 C 380,150 720,300 1080,250'/><path d='M -100,500 C 380,450 720,600 1080,550'/><path d='M -100,800 C 380,750 720,900 1080,850'/></g></svg>");pointer-events:none;}
.center{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;}
.eyebrow{font-size:30px;color:#B68C5A;font-weight:700;letter-spacing:6px;text-transform:uppercase;margin-bottom:36px;opacity:0;}
.stat{font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:320px;font-weight:900;color:#FFF;line-height:1;letter-spacing:-8px;text-shadow:0 8px 28px rgba(217,119,87,0.35);opacity:0;}
.stat .unit{color:#D97757;font-size:140px;}
.sub{font-size:32px;color:#EDD9BC;opacity:0;margin-top:30px;font-weight:500;}
`;

  const body = `
<div class="center">
  <div class="eyebrow" id="eyebrow">${eyebrow}</div>
  <div class="stat" id="stat"><span id="num">0</span><span class="unit">${statUnit}</span></div>
  ${subtitle ? `<div class="sub" id="sub">${subtitle}</div>` : ''}
</div>`;

  const script = `
var state={n:0};
var tl=gsap.timeline({paused:true});
tl.to("#eyebrow",{opacity:1,y:0,duration:0.5,ease:"power2.out"},0.2);
tl.to("#stat",{opacity:1,duration:0.3,ease:"power2.out"},0.4);
tl.to(state,{n:${target},duration:1.8,ease:"power3.out",onUpdate:function(){document.getElementById("num").textContent=Math.round(state.n);}},0.4);
tl.to("#stat",{scale:1.08,duration:0.35,yoyo:true,repeat:1,ease:"sine.inOut"},2.2);
${subtitle ? `tl.to("#sub",{opacity:0.85,y:0,duration:0.5,ease:"power2.out"},2.0);` : ''}
tl.to({},{duration:0.5});
`;

  const html = wrapDoc(input.compositionId, 1080, 1920, styles, body, script, input.durationSec);
  return {
    htmlBody: html,
    intent: `Contador animado: ${statNum}${statUnit} — ${eyebrow}`,
    text: `${statNum}${statUnit}`,
    rationale: `Template stat-counter: número ${statNum}${statUnit} conta de 0 ao valor alvo com pulse final.`,
    modelUsed: 'template-stat-counter',
  };
}

// ─── 2. Typewriter Terminal ──────────────────────────────────────────────────

export function buildTypewriterTerminal(input: GenerateMotionInput, vars: MotionTemplateVars): GenerationOutput {
  const command  = vars.COMMAND  || 'claude analyze my project';
  const line1    = vars.LINE1    || '→ lendo arquivos...';
  const line2    = vars.LINE2    || '→ processando...';
  const success  = vars.SUCCESS  || 'Pronto. Resultado salvo.';

  const styles = `
body{background:#0A0808;font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;}
.terminal{position:absolute;left:60px;right:60px;top:50%;transform:translateY(-50%);background:#161313;border:2px solid rgba(237,217,188,0.12);border-radius:24px;box-shadow:0 32px 80px rgba(0,0,0,0.55);padding:28px 32px 28px;opacity:0;}
.titlebar{display:flex;gap:10px;padding-bottom:22px;border-bottom:1px solid rgba(237,217,188,0.08);margin-bottom:24px;}
.dot{width:16px;height:16px;border-radius:50%;}
.dot.red{background:#FF5F57;}.dot.yellow{background:#FEBC2E;}.dot.green{background:#28C840;}
.title{margin-left:14px;font-size:18px;color:#B6AFA6;}
.line{font-size:26px;line-height:1.5;margin-bottom:14px;color:#EDD9BC;opacity:0;}
.line.prompt::before{content:"▶ ";color:#D97757;font-weight:700;}
.line.out{color:#76706A;font-size:22px;}
.line.success{color:#4CD964;}
.line.success::before{content:"✓ ";}
`;

  const body = `
<div class="terminal" id="term">
  <div class="titlebar">
    <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
    <span class="title">claude — ~/project</span>
  </div>
  <div class="line prompt" id="l1"><span id="t1"></span></div>
  <div class="line out"    id="l2"><span id="t2"></span></div>
  <div class="line out"    id="l3"><span id="t3"></span></div>
  <div class="line success" id="l4"><span id="t4"></span></div>
</div>`;

  const script = `
function typed(id,str,dur){var el=document.getElementById(id);var s={n:0};return gsap.to(s,{n:str.length,duration:dur,ease:"none",onUpdate:function(){el.textContent=str.slice(0,Math.round(s.n));}});}
var tl=gsap.timeline({paused:true});
tl.to("#term",{opacity:1,duration:0.3,ease:"power2.out"},0.1);
tl.to("#l1",{opacity:1,duration:0.2},0.2);
tl.add(typed("t1",${JSON.stringify(command)},1.4),0.3);
tl.to("#l2",{opacity:1,duration:0.2},1.8);
tl.add(typed("t2",${JSON.stringify(line1)},0.7),1.9);
tl.to("#l3",{opacity:1,duration:0.2},2.8);
tl.add(typed("t3",${JSON.stringify(line2)},0.8),2.9);
tl.to("#l4",{opacity:1,duration:0.2},3.9);
tl.add(typed("t4",${JSON.stringify(success)},1.0),4.0);
tl.to({},{duration:0.8});
`;

  const html = wrapDoc(input.compositionId, 1080, 1920, styles, body, script, input.durationSec);
  return {
    htmlBody: html,
    intent: `Terminal digitando: ${command}`,
    text: command,
    rationale: 'Template typewriter-terminal: janela de terminal macOS com digitação progressiva.',
    modelUsed: 'template-typewriter-terminal',
  };
}

// ─── 3. iMessage Notification ────────────────────────────────────────────────

export function buildImessageNotification(input: GenerateMotionInput, vars: MotionTemplateVars): GenerationOutput {
  const sender1  = vars.SENDER_1  || 'Claude';
  const message1 = vars.MESSAGE_1 || 'Tarefa concluída! Tudo pronto.';
  const sender2  = vars.SENDER_2  || 'Claude Code';
  const message2 = vars.MESSAGE_2 || 'Resultado salvo com sucesso.';
  const timeStr  = vars.TIME      || '9:41';

  const styles = `
body{background:transparent;font-family:-apple-system,"SF Pro Display","SF Pro Text","Inter",sans-serif;}
body::before{content:"";position:absolute;inset:0;z-index:0;background:radial-gradient(ellipse at 25% 20%,rgba(255,200,140,0.18) 0%,transparent 45%),radial-gradient(ellipse at 80% 80%,rgba(140,180,255,0.15) 0%,transparent 50%),linear-gradient(180deg,#2A2520 0%,#0A0808 100%);}
.status-bar{position:absolute;top:36px;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:0 56px;color:#FFF;font-size:30px;font-weight:600;z-index:20;}
.status-icons{display:flex;gap:14px;align-items:center;}
.lock-time{position:absolute;top:130px;left:0;right:0;text-align:center;color:#FFF;z-index:5;}
.lock-time .date{font-size:30px;font-weight:500;margin-bottom:4px;color:rgba(255,255,255,0.9);}
.lock-time .time{font-size:200px;font-weight:200;letter-spacing:-8px;line-height:1;}
.notif-stack{position:absolute;top:720px;left:56px;right:56px;display:flex;flex-direction:column;gap:12px;z-index:10;}
.notification{background:rgba(45,40,38,0.55);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid rgba(255,255,255,0.08);border-radius:32px;padding:22px 26px;box-shadow:0 14px 44px rgba(0,0,0,0.45);opacity:0;transform:translateY(-40px) scale(0.92);}
.notif-row{display:flex;gap:18px;align-items:flex-start;}
.notif-icon{width:76px;height:76px;border-radius:17px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#5BF675 0%,#1FAB3D 100%);font-size:40px;font-weight:900;color:#fff;}
.notif-body{flex:1;min-width:0;}
.notif-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;}
.notif-app{font-size:24px;font-weight:600;color:rgba(255,255,255,0.95);}
.notif-time{font-size:22px;color:rgba(255,255,255,0.55);font-weight:500;}
.notif-title{font-size:30px;font-weight:700;color:#FFF;letter-spacing:-0.4px;margin:4px 0;}
.notif-msg{font-size:26px;color:rgba(255,255,255,0.92);line-height:1.3;}
`;

  const body = `
<div class="status-bar">
  <div>${timeStr}</div>
  <div class="status-icons"><span style="font-size:22px;font-weight:600;">5G ●●●</span></div>
</div>
<div class="lock-time">
  <div class="date">Hoje</div>
  <div class="time">${timeStr}</div>
</div>
<div class="notif-stack">
  <div class="notification" id="n1">
    <div class="notif-row">
      <div class="notif-icon">💬</div>
      <div class="notif-body">
        <div class="notif-top"><div class="notif-app">Mensagens</div><div class="notif-time">agora</div></div>
        <div class="notif-title">${sender1}</div>
        <div class="notif-msg">${message1}</div>
      </div>
    </div>
  </div>
  <div class="notification" id="n2">
    <div class="notif-row">
      <div class="notif-icon" style="background:#D97757;">⚡</div>
      <div class="notif-body">
        <div class="notif-top"><div class="notif-app">${sender2}</div><div class="notif-time">1m atrás</div></div>
        <div class="notif-title">Tarefa concluída ✓</div>
        <div class="notif-msg">${message2}</div>
      </div>
    </div>
  </div>
</div>`;

  const script = `
var tl=gsap.timeline({paused:true});
tl.fromTo("#n1",{opacity:0,y:-50,scale:0.94},{opacity:1,y:0,scale:1,duration:0.55,ease:"power3.out"},0.2);
tl.fromTo("#n2",{opacity:0,y:-40,scale:0.96},{opacity:1,y:0,scale:1,duration:0.5,ease:"power3.out"},1.3);
tl.to({},{duration:1.0});
`;

  const html = wrapDoc(input.compositionId, 1080, 1920, styles, body, script, input.durationSec);
  return {
    htmlBody: html,
    intent: `Notificação iMessage: ${sender1} — ${message1.slice(0, 40)}`,
    text: message1,
    rationale: 'Template imessage-notification: tela de bloqueio iOS com duas notificações em cascata.',
    modelUsed: 'template-imessage-notif',
  };
}

// ─── 4. Audio Waveform ───────────────────────────────────────────────────────

export function buildAudioWaveform(input: GenerateMotionInput, _vars: MotionTemplateVars): GenerationOutput {
  const styles = `
body{background:#0A0808;font-family:-apple-system,"Inter",sans-serif;}
body::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(217,119,87,0.10) 0%,transparent 60%);pointer-events:none;}
.waveform{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:540px;display:flex;align-items:center;justify-content:center;padding:0 80px;box-sizing:border-box;gap:6px;}
.bar{flex:1;background:linear-gradient(180deg,#F4A88A 0%,#D97757 50%,#B68C5A 100%);border-radius:6px;min-height:12px;box-shadow:0 0 24px rgba(217,119,87,0.4);}
.axis{position:absolute;left:80px;right:80px;top:50%;height:2px;background:linear-gradient(90deg,transparent 0%,rgba(237,217,188,0.15) 20%,rgba(237,217,188,0.15) 80%,transparent 100%);transform:translateY(-50%);}
`;

  const body = `
<div class="axis"></div>
<div class="waveform" id="waveform"></div>`;

  const dur = input.durationSec || 4;
  const script = `
var wf=document.getElementById("waveform");
var BAR_COUNT=56;
var bars=[];
for(var i=0;i<BAR_COUNT;i++){var b=document.createElement("div");b.className="bar";b.style.height="12px";b.style.opacity="0";wf.appendChild(b);bars.push(b);}
var tl=gsap.timeline({paused:true});
for(var i=0;i<BAR_COUNT;i++){
  var distFromCenter=Math.abs(i-BAR_COUNT/2);
  var delay=distFromCenter*0.025;
  (function(bar,d){tl.to(bar,{opacity:1,duration:0.35,ease:"power2.out"},d);})(bars[i],delay);
}
var wfState={t:0};
tl.to(wfState,{t:${dur},duration:${dur},ease:"none",onUpdate:function(){
  var t=wfState.t;
  for(var i=0;i<BAR_COUNT;i++){
    var phase=i/BAR_COUNT;
    var amp=0.25*Math.abs(Math.sin(t*5+phase*10))+0.35*Math.abs(Math.sin(t*9+phase*6+phase*2))+0.25*Math.abs(Math.sin(t*14+phase*3+i*0.4))+0.15*Math.abs(Math.sin(t*22+phase*18+i*0.7));
    var distFromCenter=Math.abs(i-BAR_COUNT/2)/(BAR_COUNT/2);
    var envelope=1.0-0.3*distFromCenter;
    bars[i].style.height=(12+amp*460*envelope)+"px";
  }
}},0);
`;

  const html = wrapDoc(input.compositionId, 1080, 1920, styles, body, script, input.durationSec);
  return {
    htmlBody: html,
    intent: 'Visualizador de áudio animado — barras reactivas',
    text: 'Waveform',
    rationale: 'Template audio-waveform: 56 barras reactivas simulando a onda de áudio com envelope central.',
    modelUsed: 'template-audio-waveform',
  };
}

// ─── 5. App Icon Launcher ────────────────────────────────────────────────────

export async function buildAppIconLauncher(input: GenerateMotionInput, vars: MotionTemplateVars): Promise<GenerationOutput> {
  // Each icon slot: either a URL (logo), emoji, or text symbol
  const rawIcons = [
    vars.ICON_1, vars.ICON_2, vars.ICON_3,
    vars.ICON_4, vars.ICON_5, vars.ICON_6,
    vars.ICON_7, vars.ICON_8, vars.ICON_9,
  ].map((v, i) => v || ['/', '{ }', '↗', '⌘', '∞', '→', '●', '⎈', '⌃'][i]);

  // Resolve logos: if value looks like a brand name (not URL/emoji/symbol), fetch logo
  const resolvedIcons = await Promise.all(rawIcons.map(async (v) => {
    if (!v) return { type: 'text' as const, value: '?' };
    if (v.startsWith('http') || v.startsWith('data:')) return { type: 'img' as const, value: v };
    // Check if it's a known brand name
    const lower = v.toLowerCase().trim();
    if (KNOWN_BRAND_DOMAINS[lower]) {
      const uri = await fetchBrandLogoAsDataUri(KNOWN_BRAND_DOMAINS[lower]);
      if (uri) return { type: 'img' as const, value: uri };
    }
    return { type: 'text' as const, value: v };
  }));

  const iconHtml = resolvedIcons.map((icon, i) => {
    const cls = i % 3 === 1 ? 'app-tile alt' : i % 3 === 2 ? 'app-tile accent' : 'app-tile';
    if (icon.type === 'img') {
      return `<div class="${cls}" style="padding:16px;"><img src="${icon.value}" style="width:100%;height:100%;object-fit:contain;border-radius:24px;"/></div>`;
    }
    return `<div class="${cls}">${icon.value}</div>`;
  }).join('\n');

  const styles = `
body{background:#0A0808;font-family:-apple-system,"SF Pro Display","Inter",sans-serif;}
body::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(217,119,87,0.10) 0%,transparent 60%);}
.icon-grid{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);display:grid;grid-template-columns:repeat(3,1fr);gap:60px;padding:0 100px;}
.app-tile{aspect-ratio:1;border-radius:56px;background:linear-gradient(135deg,#2C2825 0%,#1A1815 100%);border:2px solid rgba(237,217,188,0.12);box-shadow:0 16px 36px rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:ui-monospace,Menlo,monospace;font-size:110px;font-weight:900;color:#D97757;opacity:0;transform:scale(0.4) rotate(-12deg);}
.app-tile.alt{color:#EDD9BC;background:linear-gradient(135deg,#1F1A16 0%,#0A0808 100%);}
.app-tile.accent{color:#F4A88A;}
`;

  const body = `<div class="icon-grid" id="grid">${iconHtml}</div>`;

  const script = `
var tl=gsap.timeline({paused:true});
tl.to(".app-tile",{opacity:1,scale:1,rotation:0,duration:0.55,ease:"back.out(1.6)",stagger:{each:0.08,from:"random"}},0.1);
tl.to(".app-tile",{y:-8,duration:0.6,yoyo:true,repeat:${Math.max(4, Math.ceil((input.durationSec - 1) / 0.6))},ease:"sine.inOut",stagger:{each:0.05,from:"random"}},">-0.2");
tl.to({},{duration:0.5});
`;

  const html = wrapDoc(input.compositionId, 1080, 1920, styles, body, script, input.durationSec);
  const brandNames = rawIcons.filter(v => KNOWN_BRAND_DOMAINS[v?.toLowerCase()?.trim() ?? '']).join(', ');
  return {
    htmlBody: html,
    intent: `Grid de ícones de apps: ${rawIcons.filter(Boolean).slice(0, 4).join(', ')}`,
    text: vars.TITLE || rawIcons[0] || 'Apps',
    rationale: `Template app-icon-launcher: grid 3×3 de ícones com entrada escalonada.${brandNames ? ` Logos buscados automaticamente: ${brandNames}.` : ''}`,
    modelUsed: 'template-app-icon-launcher',
  };
}

// ─── 6. Wastebasket Trash ───────────────────────────────────────────────────

export async function buildWastebasketTrash(input: GenerateMotionInput, vars: MotionTemplateVars): Promise<GenerationOutput> {
  // Tools to trash — defaults to CapCut, After Effects, Premiere
  const tool1 = vars.TOOL_1 || 'CapCut';
  const tool2 = vars.TOOL_2 || 'After Effects';
  const tool3 = vars.TOOL_3 || 'Premiere';
  const winner = vars.WINNER || 'Claude Code';
  const step1  = vars.STEP_1 || 'HyperFrames';
  const step2  = vars.STEP_2 || 'Remotion';
  const step3  = vars.STEP_3 || 'Ship';

  // Fetch logos in parallel
  const [logo1, logo2, logo3] = await Promise.all([
    fetchLogoOrPlaceholder(tool1, '#333'),
    fetchLogoOrPlaceholder(tool2, '#9999ff'),
    fetchLogoOrPlaceholder(tool3, '#ff6699'),
  ]);

  const styles = `
body{background:transparent;overflow:hidden;font-family:-apple-system,"Inter","SF Pro Display",sans-serif;}
.basket{position:absolute;left:360px;top:1280px;width:360px;height:380px;z-index:4;opacity:0;transform:translateY(60px);}
.basket svg{width:100%;height:100%;display:block;filter:drop-shadow(0 24px 40px rgba(0,0,0,0.45));}
.logo{position:absolute;width:220px;height:220px;z-index:6;left:-260px;top:1000px;opacity:0;}
.logo img{width:100%;height:100%;display:block;object-fit:contain;border-radius:44px;filter:drop-shadow(0 18px 36px rgba(0,0,0,0.55));}
.winner-stage{position:absolute;left:0;right:0;top:1240px;height:420px;display:flex;flex-direction:column;align-items:center;z-index:10;}
.rays{position:absolute;width:340px;height:340px;top:-70px;left:50%;transform:translateX(-50%);border-radius:50%;background:radial-gradient(circle,rgba(217,119,87,0.65) 0%,rgba(217,119,87,0.2) 30%,transparent 65%);opacity:0;transform:translateX(-50%) scale(0.6);}
.winner-chip{background:#161313;border:3px solid #D97757;border-radius:24px;padding:18px 36px;font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:56px;font-weight:900;color:#FFF;letter-spacing:-1px;text-shadow:0 6px 24px rgba(0,0,0,0.7),0 0 30px rgba(217,119,87,0.45);opacity:0;}
.winner-chip .accent{color:#D97757;}
.steps{display:flex;gap:16px;margin-top:18px;opacity:0;}
.step-chip{background:rgba(22,19,19,0.92);border:2px solid #D97757;border-radius:14px;padding:10px 18px;font-family:ui-monospace,Menlo,monospace;font-size:26px;font-weight:900;color:#EDD9BC;opacity:0;transform:translateY(30px);}
.step-chip .num{color:#D97757;margin-right:8px;}
`;

  const winnerParts = winner.split(' ');
  const winnerHtml = winnerParts.length > 1
    ? `${winnerParts[0]} <span class="accent">${winnerParts.slice(1).join(' ')}</span>`
    : `<span class="accent">${winner}</span>`;

  const body = `
<div class="basket" id="basket">
  <svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg">
    <g id="lid"><rect x="20" y="34" width="160" height="18" rx="6" fill="#4A4640"/><rect x="78" y="20" width="44" height="18" rx="4" fill="#5A5650"/></g>
    <path d="M 32 60 L 168 60 L 158 210 L 42 210 Z" fill="#76706A"/>
    <path d="M 32 60 L 168 60 L 158 210 L 42 210 Z" fill="url(#bs)" opacity="0.6"/>
    <defs><linearGradient id="bs" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="rgba(255,255,255,0.18)"/><stop offset="50%" stop-color="rgba(255,255,255,0)"/><stop offset="100%" stop-color="rgba(0,0,0,0.25)"/></linearGradient></defs>
    <g stroke="#5A5650" stroke-width="3" opacity="0.55"><line x1="68" y1="68" x2="62" y2="200"/><line x1="100" y1="68" x2="100" y2="200"/><line x1="132" y1="68" x2="138" y2="200"/></g>
    <ellipse cx="100" cy="60" rx="68" ry="10" fill="#1A1815"/>
  </svg>
</div>
<div class="logo" id="logo1"><img src="${logo1}" alt="${tool1}"></div>
<div class="logo" id="logo2"><img src="${logo2}" alt="${tool2}"></div>
<div class="logo" id="logo3"><img src="${logo3}" alt="${tool3}"></div>
<div class="winner-stage">
  <div class="rays" id="rays"></div>
  <div class="winner-chip" id="winnerChip">${winnerHtml}</div>
  <div class="steps" id="steps">
    <div class="step-chip"><span class="num">01</span>${step1}</div>
    <div class="step-chip"><span class="num">02</span>${step2}</div>
    <div class="step-chip"><span class="num">03</span>${step3}</div>
  </div>
</div>`;

  const script = `
var tl=gsap.timeline({paused:true});
tl.to("#basket",{opacity:1,y:0,duration:0.7,ease:"back.out(1.4)"},0.6);
function trashLogo(id,startTime){
  tl.set(id,{left:-260,top:1000,opacity:0,rotation:0,scale:1});
  tl.to(id,{opacity:1,duration:0.1},startTime);
  tl.to(id,{left:200,top:850,rotation:360,duration:0.32,ease:"power2.out"},startTime);
  tl.to(id,{left:460,top:1240,rotation:720,scale:0.45,duration:0.34,ease:"power2.in"},startTime+0.32);
  tl.to(id,{opacity:0,scale:0.3,duration:0.12},startTime+0.62);
  tl.to("#basket",{scale:1.06,duration:0.08,ease:"power2.out",transformOrigin:"center bottom"},startTime+0.6);
  tl.to("#basket",{scale:1,duration:0.18,ease:"elastic.out(1,0.4)"},startTime+0.68);
}
trashLogo("#logo1",1.60);
trashLogo("#logo2",2.44);
trashLogo("#logo3",3.56);
tl.to("#basket",{rotation:-3,duration:0.4,yoyo:true,repeat:3,ease:"sine.inOut",transformOrigin:"center bottom"},4.7);
tl.to("#basket",{y:200,opacity:0,duration:0.6,ease:"power2.in"},6.7);
tl.fromTo("#rays",{opacity:0,scale:0.4},{opacity:1,scale:1.4,duration:0.6,ease:"power2.out"},7.85);
tl.fromTo("#winnerChip",{opacity:0,y:20},{opacity:1,y:0,duration:0.45,ease:"power3.out"},8.15);
tl.to("#rays",{scale:1.2,opacity:0.7,duration:0.7,yoyo:true,repeat:4,ease:"sine.inOut"},8.5);
tl.to("#steps",{opacity:1,duration:0.1},9.0);
tl.to(".step-chip",{opacity:1,y:0,duration:0.45,stagger:0.18,ease:"back.out(1.5)"},9.05);
tl.to({},{duration:0.9},10.0);
`;

  const html = wrapDoc(input.compositionId, 1080, 1920, styles, body, script, input.durationSec);
  return {
    htmlBody: html,
    intent: `Lixeira: ${tool1}, ${tool2}, ${tool3} → ${winner}`,
    text: `Sem ${tool1}`,
    rationale: `Template wastebasket-trash: logos de ${tool1}, ${tool2} e ${tool3} voam para a lixeira, revelando ${winner}. Logos buscados automaticamente via Clearbit.`,
    modelUsed: 'template-wastebasket-trash',
  };
}

// ─── 7. iOS Toggle Flip ─────────────────────────────────────────────────────

export function buildToggleFlip(input: GenerateMotionInput, vars: MotionTemplateVars): GenerationOutput {
  const label = vars.LABEL || 'Ativar recurso';
  const description = vars.DESCRIPTION || 'Ligue isso agora e veja a diferença.';

  const styles = `
body{background:#0A0808;font-family:-apple-system,"Inter",sans-serif;}
.card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#FAFAF7;border-radius:28px;box-shadow:0 32px 80px rgba(0,0,0,0.55);padding:60px 56px;width:800px;opacity:0;}
.row{display:flex;align-items:center;justify-content:space-between;gap:30px;}
.label-block{flex:1;}
.label{font-size:36px;font-weight:700;color:#1A1815;margin-bottom:10px;letter-spacing:-0.5px;}
.desc{font-size:22px;color:#76706A;line-height:1.45;}
.toggle{width:108px;height:60px;background:#C9C4BC;border-radius:30px;position:relative;flex-shrink:0;box-shadow:inset 0 2px 4px rgba(0,0,0,0.1);}
.knob{position:absolute;width:52px;height:52px;background:#fff;border-radius:50%;top:4px;left:4px;box-shadow:0 2px 6px rgba(0,0,0,0.25);}
.ring{position:absolute;width:160px;height:160px;border:5px solid #E0532E;border-radius:50%;transform:translate(-50%,-50%) scale(0.4);opacity:0;pointer-events:none;left:calc(50% + 296px);top:50%;}
`;

  const body = `
<div class="card" id="card">
  <div class="row">
    <div class="label-block">
      <div class="label">${label}</div>
      <div class="desc">${description}</div>
    </div>
    <div class="toggle" id="t"><div class="knob" id="knob"></div></div>
  </div>
</div>
<div class="ring" id="r"></div>`;

  const script = `
var tl=gsap.timeline({paused:true});
tl.to("#card",{opacity:1,duration:0.4,ease:"power2.out"},0.1);
tl.to("#r",{opacity:1,scale:1.0,duration:0.001},1.2);
tl.to("#r",{scale:1.6,opacity:0,duration:0.5,ease:"power2.out"},1.2);
tl.to("#t",{backgroundColor:"#4CD964",duration:0.25},1.2);
tl.to("#knob",{left:52,duration:0.25,ease:"power2.inOut"},1.2);
tl.to({},{duration:1.2});
`;

  const html = wrapDoc(input.compositionId, 1080, 1920, styles, body, script, input.durationSec);
  return {
    htmlBody: html,
    intent: `Toggle iOS ativando: ${label}`,
    text: label,
    rationale: 'Template toggle-flip: card iOS com toggle ativando (anel de destaque + slide do knob).',
    modelUsed: 'template-toggle-flip',
  };
}

// ─── 8. Progress Bar + Steps ────────────────────────────────────────────────

export function buildProgressBar(input: GenerateMotionInput, vars: MotionTemplateVars): GenerationOutput {
  const steps = [vars.STEP_1, vars.STEP_2, vars.STEP_3, vars.STEP_4].filter(Boolean) as string[];
  const finalSteps = steps.length >= 2 ? steps : ['Instalar', 'Configurar', 'Gerar', 'Publicar'];

  const stepsHtml = finalSteps.map((label, i) => `
  <div class="step" id="s${i + 1}">
    <div class="pill">0${i + 1}</div>
    <div class="label">${label}</div>
    <div class="check" id="c${i + 1}">✓</div>
  </div>`).join('\n');

  const styles = `
body{background:#0A0808;font-family:-apple-system,"Inter",sans-serif;color:#EDD9BC;}
.stage{position:absolute;left:60px;right:60px;top:50%;transform:translateY(-50%);}
.step{display:flex;align-items:center;gap:24px;margin-bottom:26px;opacity:0;transform:translateX(-20px);}
.step .pill{width:72px;height:72px;background:rgba(22,19,19,0.92);border:2px solid rgba(237,217,188,0.18);border-radius:22px;display:flex;align-items:center;justify-content:center;font-family:ui-monospace,Menlo,monospace;font-size:32px;font-weight:900;color:#D97757;flex-shrink:0;}
.step .label{font-size:36px;font-weight:600;color:#EDD9BC;letter-spacing:-0.3px;}
.step .check{margin-left:auto;width:56px;height:56px;border-radius:50%;background:#4CD964;color:#FFF;font-weight:900;font-size:32px;display:flex;align-items:center;justify-content:center;opacity:0;transform:scale(0.4);}
.bar-track{margin-top:60px;height:18px;background:rgba(237,217,188,0.12);border-radius:9px;overflow:hidden;}
.bar-fill{height:100%;width:0%;background:linear-gradient(90deg,#B68C5A 0%,#D97757 50%,#F4A88A 100%);border-radius:9px;box-shadow:0 0 20px rgba(217,119,87,0.5);}
.pct{text-align:right;margin-top:14px;font-family:ui-monospace,Menlo,monospace;font-size:30px;font-weight:700;color:#D97757;}
`;

  const body = `
<div class="stage">
${stepsHtml}
  <div class="bar-track"><div class="bar-fill" id="bar"></div></div>
  <div class="pct"><span id="pct">0</span>%</div>
</div>`;

  const stepAnims = finalSteps.map((_, i) =>
    `tl.to("#s${i + 1}",{opacity:1,x:0,duration:0.4,ease:"power3.out"},${(i * 0.5).toFixed(2)});\n` +
    `tl.to("#c${i + 1}",{opacity:1,scale:1,duration:0.3,ease:"back.out(2)"},${(i * 0.5 + 0.25).toFixed(2)});`
  ).join('\n');

  const script = `
var tl=gsap.timeline({paused:true});
${stepAnims}
var pctState={n:0};
tl.to(pctState,{n:100,duration:2.0,ease:"power2.inOut",onUpdate:function(){
  document.getElementById("pct").textContent=Math.round(pctState.n);
  document.getElementById("bar").style.width=pctState.n+"%";
}},0.2);
tl.to({},{duration:0.6});
`;

  const html = wrapDoc(input.compositionId, 1080, 1920, styles, body, script, input.durationSec);
  return {
    htmlBody: html,
    intent: `Processo em ${finalSteps.length} passos: ${finalSteps.join(' → ')}`,
    text: finalSteps[0],
    rationale: `Template progress-bar: ${finalSteps.length} passos com check verde + barra de progresso 0→100%.`,
    modelUsed: 'template-progress-bar',
  };
}

// ─── 9. Apple Maps Route ────────────────────────────────────────────────────

export function buildAppleMapsRoute(input: GenerateMotionInput, vars: MotionTemplateVars): GenerationOutput {
  const destination = vars.DESTINATION || 'Destino';
  const etaMin = vars.ETA_MIN || '12';
  const distance = vars.DISTANCE || '4.2 km';
  const arriveAt = vars.ARRIVE_AT || '';

  const styles = `
body{background:#F2EDE0;font-family:-apple-system,"SF Pro Display","SF Pro Text","Inter",sans-serif;}
.status-bar{position:absolute;top:36px;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:0 56px;color:#1A1815;font-size:30px;font-weight:600;z-index:20;}
.map{position:absolute;left:0;right:0;top:110px;bottom:0;background:#F2EDE0;overflow:hidden;}
.map-svg{position:absolute;inset:0;width:100%;height:100%;}
.top-card{position:absolute;left:36px;right:36px;top:150px;background:rgba(255,255,255,0.96);border-radius:22px;padding:22px 26px;display:flex;align-items:center;gap:18px;box-shadow:0 6px 22px rgba(0,0,0,0.12);z-index:15;opacity:0;}
.dir-icon{width:50px;height:50px;background:#4080F0;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.dir-icon svg{width:28px;height:28px;}
.label-block{flex:1;}
.from-to{font-size:24px;color:#76706A;font-weight:600;margin-bottom:2px;}
.destination{font-size:30px;color:#1A1815;font-weight:700;letter-spacing:-0.5px;}
.close-btn{width:40px;height:40px;border-radius:50%;background:#E5E5EA;color:#8E8E93;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;}
.pin{position:absolute;z-index:12;transform:translate(-50%,-100%);}
.pin.start{left:280px;top:760px;opacity:0;}
.pin.end{left:800px;top:1480px;opacity:0;}
.pin .marker{width:60px;height:60px;border-radius:50%;border:5px solid #FFF;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px rgba(0,0,0,0.35);font-size:28px;font-weight:700;color:#FFF;position:relative;top:-10px;}
.pin.start .marker{background:#4CD964;}
.pin.end .marker{background:#FF3B30;}
.pin .stem{width:8px;height:18px;background:rgba(0,0,0,0.15);margin:0 auto;border-radius:4px;}
.live-dot{position:absolute;left:280px;top:760px;width:30px;height:30px;background:#4080F0;border-radius:50%;border:5px solid #FFF;transform:translate(-50%,-50%);z-index:11;box-shadow:0 4px 14px rgba(64,128,240,0.5);opacity:0;}
.eta-card{position:absolute;left:0;right:0;bottom:0;background:#FFF;border-radius:30px 30px 0 0;padding:30px 40px 60px;box-shadow:0 -16px 40px rgba(0,0,0,0.15);z-index:18;transform:translateY(100%);}
.eta-handle{width:60px;height:6px;background:#D1D1D6;border-radius:3px;margin:0 auto 22px;}
.eta-time{font-size:78px;font-weight:700;color:#1A1815;line-height:1;letter-spacing:-2px;}
.eta-meta{font-size:24px;color:#8E8E93;font-weight:500;margin:10px 0 22px;}
.eta-meta strong{color:#4080F0;font-weight:600;}
.eta-buttons{display:flex;gap:14px;}
.eta-go{flex:1;background:#4080F0;color:#FFF;font-size:30px;font-weight:700;padding:22px 0;border-radius:999px;text-align:center;box-shadow:0 6px 18px rgba(64,128,240,0.4);}
.eta-cancel{background:#E5E5EA;color:#1A1815;font-size:28px;font-weight:600;padding:22px 36px;border-radius:999px;}
`;

  const body = `
<div class="status-bar"><div>9:41</div><div style="font-size:22px;font-weight:600;">5G ▮▮▮▯ ▣</div></div>
<div class="map">
  <svg class="map-svg" viewBox="0 0 1080 1810" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <path d="M -50 1450 Q 80 1480, 220 1500 T 480 1620 L 480 1900 L -50 1900 Z" fill="#B0DCF1"/>
    <ellipse cx="220" cy="1100" rx="180" ry="110" fill="#C6E6B0"/>
    <ellipse cx="900" cy="540" rx="160" ry="180" fill="#C6E6B0"/>
    <ellipse cx="660" cy="1280" rx="100" ry="80" fill="#C6E6B0"/>
    <g fill="#EAE2CE">
      <rect x="50" y="280" width="140" height="100" rx="4"/><rect x="220" y="280" width="180" height="100" rx="4"/><rect x="430" y="280" width="160" height="100" rx="4"/><rect x="620" y="280" width="100" height="100" rx="4"/>
      <rect x="50" y="420" width="160" height="120" rx="4"/><rect x="240" y="420" width="100" height="120" rx="4"/><rect x="370" y="420" width="140" height="120" rx="4"/><rect x="540" y="420" width="180" height="120" rx="4"/>
      <rect x="50" y="580" width="100" height="160" rx="4"/><rect x="180" y="580" width="160" height="160" rx="4"/><rect x="370" y="580" width="140" height="160" rx="4"/><rect x="540" y="580" width="100" height="160" rx="4"/><rect x="670" y="580" width="140" height="160" rx="4"/>
      <rect x="50" y="800" width="180" height="100" rx="4"/><rect x="260" y="800" width="120" height="100" rx="4"/><rect x="410" y="800" width="160" height="100" rx="4"/><rect x="610" y="800" width="140" height="100" rx="4"/>
      <rect x="50" y="940" width="120" height="120" rx="4"/><rect x="200" y="940" width="180" height="120" rx="4"/><rect x="410" y="940" width="100" height="120" rx="4"/><rect x="540" y="940" width="160" height="120" rx="4"/>
      <rect x="730" y="800" width="180" height="240" rx="4"/><rect x="940" y="800" width="100" height="240" rx="4"/>
      <rect x="430" y="1100" width="200" height="120" rx="4"/><rect x="430" y="1260" width="180" height="100" rx="4"/><rect x="780" y="1100" width="120" height="100" rx="4"/><rect x="930" y="1100" width="110" height="100" rx="4"/>
      <rect x="780" y="1240" width="160" height="100" rx="4"/><rect x="510" y="1400" width="140" height="140" rx="4"/><rect x="680" y="1400" width="160" height="120" rx="4"/><rect x="870" y="1400" width="140" height="120" rx="4"/>
      <rect x="540" y="1580" width="180" height="120" rx="4"/><rect x="750" y="1580" width="140" height="120" rx="4"/><rect x="920" y="1580" width="120" height="120" rx="4"/>
    </g>
    <g><line x1="0" y1="780" x2="1080" y2="780" stroke="#FFFFFF" stroke-width="42"/><line x1="0" y1="780" x2="1080" y2="780" stroke="#FED867" stroke-width="32"/></g>
    <g stroke="#FFFFFF" stroke-width="22">
      <line x1="0" y1="400" x2="1080" y2="400"/><line x1="0" y1="560" x2="1080" y2="560"/><line x1="0" y1="930" x2="1080" y2="930"/><line x1="0" y1="1080" x2="1080" y2="1080"/><line x1="0" y1="1220" x2="1080" y2="1220"/><line x1="0" y1="1380" x2="1080" y2="1380"/><line x1="0" y1="1560" x2="1080" y2="1560"/>
      <line x1="190" y1="0" x2="190" y2="1900"/><line x1="400" y1="0" x2="400" y2="1900"/><line x1="620" y1="0" x2="620" y2="1900"/><line x1="850" y1="0" x2="850" y2="1900"/>
    </g>
    <path id="route" d="M 280 760 L 280 850 L 500 850 L 500 1080 L 620 1080 L 620 1380 L 800 1380 L 800 1480" stroke="#FFFFFF" stroke-width="24" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1600" stroke-dashoffset="1600"/>
    <path id="route-blue" d="M 280 760 L 280 850 L 500 850 L 500 1080 L 620 1080 L 620 1380 L 800 1380 L 800 1480" stroke="#4080F0" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1600" stroke-dashoffset="1600"/>
  </svg>
</div>
<div class="top-card" id="topCard">
  <div class="dir-icon"><svg viewBox="0 0 24 24" fill="#FFF"><path d="M12 2 L19 9 L15 9 L15 16 L9 16 L9 9 L5 9 Z" transform="translate(0 2)"/></svg></div>
  <div class="label-block"><div class="from-to">ROTA</div><div class="destination">${destination}</div></div>
  <div class="close-btn">✕</div>
</div>
<div class="pin start" id="pinStart"><div class="marker">A</div><div class="stem"></div></div>
<div class="pin end" id="pinEnd"><div class="marker"></div><div class="stem"></div></div>
<div class="live-dot" id="liveDot"></div>
<div class="eta-card" id="etaCard">
  <div class="eta-handle"></div>
  <div class="eta-time">${etaMin} min</div>
  <div class="eta-meta"><strong>${distance}</strong> · Rota mais rápida${arriveAt ? ` · Chega às ${arriveAt}` : ''}</div>
  <div class="eta-buttons"><div class="eta-go" id="goBtn">GO</div><div class="eta-cancel">Sair</div></div>
</div>`;

  const script = `
var tl=gsap.timeline({paused:true});
tl.fromTo("#topCard",{opacity:0,y:-30},{opacity:1,y:0,duration:0.5,ease:"power3.out"},0.1);
tl.fromTo("#pinStart",{opacity:0,y:-80,scale:0.5},{opacity:1,y:0,scale:1,duration:0.5,ease:"back.out(2)"},0.4);
tl.fromTo("#liveDot",{opacity:0,scale:0},{opacity:1,scale:1,duration:0.3},0.7);
tl.fromTo("#pinEnd",{opacity:0,y:-80,scale:0.5},{opacity:1,y:0,scale:1,duration:0.5,ease:"back.out(2)"},0.9);
tl.to("#route",{strokeDashoffset:0,duration:1.4,ease:"power2.inOut"},1.2);
tl.to("#route-blue",{strokeDashoffset:0,duration:1.4,ease:"power2.inOut"},1.3);
tl.fromTo("#etaCard",{y:"100%"},{y:"0%",duration:0.7,ease:"power3.out"},1.9);
tl.to("#goBtn",{scale:1.05,duration:0.4,yoyo:true,repeat:1,ease:"sine.inOut"},2.7);
tl.to({},{duration:0.8});
`;

  const html = wrapDoc(input.compositionId, 1080, 1920, styles, body, script, input.durationSec);
  return {
    htmlBody: html,
    intent: `Rota Apple Maps até ${destination} (${etaMin} min, ${distance})`,
    text: destination,
    rationale: `Template apple-maps-route: UI fiel do Apple Maps com pins, rota animada e card de ETA para ${destination}.`,
    modelUsed: 'template-apple-maps-route',
  };
}

// ─── 10. Claude Bloom + Steps ───────────────────────────────────────────────

export async function buildClaudeBloomSteps(input: GenerateMotionInput, vars: MotionTemplateVars): Promise<GenerationOutput> {
  const brand = vars.BRAND || 'Claude Code';
  const step1 = vars.STEP_1 || 'Instalar';
  const step2 = vars.STEP_2 || 'Configurar';
  const step3 = vars.STEP_3 || 'Publicar';

  const logo = await fetchLogoOrPlaceholder(brand.split(' ')[0], '#D97757');

  const brandParts = brand.split(' ');
  const brandHtml = brandParts.length > 1
    ? `${brandParts[0]} <span class="accent">${brandParts.slice(1).join(' ')}</span>`
    : `<span class="accent">${brand}</span>`;

  const styles = `
body{background:transparent;font-family:-apple-system,"Inter","SF Pro Display",sans-serif;}
.stage{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:520px;display:flex;flex-direction:column;align-items:center;}
.starburst-wrap{position:relative;width:200px;height:200px;margin-bottom:14px;opacity:0;}
.rays{position:absolute;inset:-70px;border-radius:50%;background:radial-gradient(circle,rgba(217,119,87,0.65) 0%,rgba(217,119,87,0.2) 30%,transparent 65%);opacity:0;transform:scale(0.6);}
.starburst{position:absolute;inset:0;z-index:2;border-radius:40px;overflow:hidden;box-shadow:0 0 60px rgba(217,119,87,0.55),0 16px 30px rgba(0,0,0,0.5);}
.starburst img{width:100%;height:100%;display:block;object-fit:cover;}
.brand-text{font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:50px;font-weight:900;color:#FFF;letter-spacing:-1px;text-shadow:0 6px 24px rgba(0,0,0,0.7),0 0 30px rgba(217,119,87,0.45);opacity:0;}
.brand-text .accent{color:#D97757;}
.steps{display:flex;gap:16px;margin-top:18px;opacity:0;}
.step-chip{background:rgba(22,19,19,0.92);border:2px solid #D97757;border-radius:14px;padding:10px 18px;font-family:ui-monospace,Menlo,monospace;font-size:26px;font-weight:900;color:#EDD9BC;letter-spacing:1px;box-shadow:0 12px 26px rgba(0,0,0,0.5);opacity:0;transform:translateY(30px);}
.step-chip .num{color:#D97757;margin-right:8px;}
`;

  const body = `
<div class="stage">
  <div class="starburst-wrap" id="starburstWrap">
    <div class="rays" id="rays"></div>
    <div class="starburst"><img src="${logo}" alt="${brand}"></div>
  </div>
  <div class="brand-text" id="brandText">${brandHtml}</div>
  <div class="steps" id="steps">
    <div class="step-chip"><span class="num">01</span><span>${step1}</span></div>
    <div class="step-chip"><span class="num">02</span><span>${step2}</span></div>
    <div class="step-chip"><span class="num">03</span><span>${step3}</span></div>
  </div>
</div>`;

  const script = `
var tl=gsap.timeline({paused:true});
tl.fromTo("#rays",{opacity:0,scale:0.4},{opacity:1,scale:1.4,duration:0.6,ease:"power2.out"},0.2);
tl.fromTo("#starburstWrap",{opacity:0,scale:0.3,rotation:-45},{opacity:1,scale:1,rotation:0,duration:0.55,ease:"back.out(1.8)"},0.2);
tl.fromTo("#brandText",{opacity:0,y:20},{opacity:1,y:0,duration:0.45,ease:"power3.out"},0.5);
tl.to("#rays",{scale:1.2,opacity:0.7,duration:0.7,yoyo:true,repeat:${Math.max(4, Math.ceil((input.durationSec - 0.9) / 0.7))},ease:"sine.inOut"},0.9);
tl.to("#steps",{opacity:1,duration:0.1},1.3);
tl.to(".step-chip",{opacity:1,y:0,duration:0.45,stagger:0.18,ease:"back.out(1.5)"},1.35);
tl.to({},{duration:1.0});
`;

  const html = wrapDoc(input.compositionId, 1080, 1920, styles, body, script, input.durationSec);
  return {
    htmlBody: html,
    intent: `Reveal de solução: ${brand} + 3 passos (${step1}, ${step2}, ${step3})`,
    text: brand,
    rationale: `Template claude-bloom-steps: starburst com logo de ${brand} (buscado automaticamente) + wordmark + chips de passos.`,
    modelUsed: 'template-claude-bloom-steps',
  };
}

// ─── Brand palette adaptation ───────────────────────────────────────────────

/** IBRA default tokens baked into the templates. */
const IBRA_TOKENS = { bg: '#0A0808', text: '#EDD9BC', accent: '#D97757' };

/**
 * Templates whose look survives a palette swap. UI-mimicking templates
 * (apple-maps, imessage, toggle-flip) keep their native system palettes —
 * recoloring an iOS lock screen breaks the illusion that sells the motion.
 */
const BRAND_ADAPTABLE: ReadonlySet<string> = new Set([
  'stat-counter', 'typewriter-terminal', 'audio-waveform',
  'app-icon-launcher', 'wastebasket-trash', 'progress-bar', 'claude-bloom-steps',
]);

/**
 * Swap the IBRA tokens for the reel's brand palette. No-op for templates
 * outside BRAND_ADAPTABLE or when any palette field is missing.
 */
export function applyBrandPalette(
  html: string,
  templateId: string,
  palette?: { bg?: string; text?: string; accent?: string },
): string {
  if (!palette?.bg || !palette?.text || !palette?.accent) return html;
  if (!BRAND_ADAPTABLE.has(templateId)) return html;
  return html
    .replaceAll(IBRA_TOKENS.bg, palette.bg)
    .replaceAll(IBRA_TOKENS.text, palette.text)
    .replaceAll(IBRA_TOKENS.accent, palette.accent);
}

/**
 * Templates safe to composite as a screen-blend float over real footage:
 * dark canvases whose background disappears in the blend. UI-mimicking
 * templates with light backgrounds (apple-maps, imessage, toggle-flip) wash
 * out and cover the speaker — excluded.
 */
export const OVERLAY_SAFE_TEMPLATE_IDS: readonly string[] = [
  'stat-counter', 'typewriter-terminal', 'progress-bar', 'audio-waveform',
  'claude-bloom-steps', 'wastebasket-trash', 'app-icon-launcher',
];

/**
 * Prepare a template for screen-blend float over footage: pure-black canvas
 * (the blend erases #000000 completely; the near-black ink would leave a
 * faint veil) and no topographic background pattern bleeding through.
 */
export function applyOverlayMode(html: string, templateId: string): string {
  if (!OVERLAY_SAFE_TEMPLATE_IDS.includes(templateId)) return html;
  return html
    .replaceAll(IBRA_TOKENS.bg, '#000000')
    // Strip the topographic-line body::after pattern (svg data-uri bg).
    .replace(/body::after\{[^}]*\}/g, '');
}

/**
 * Light-mode swap for the reel's global Claro/Escuro toggle. Inverts the
 * dark IBRA canvas to a light paper look (accent stays). Same adaptability
 * rules as the brand palette — UI-mimicking templates keep their native
 * system look. Apply BEFORE applyBrandPalette (brand wins when both exist).
 */
export function applyColorMode(
  html: string,
  templateId: string,
  mode?: 'dark' | 'light',
): string {
  if (mode !== 'light') return html;
  if (!BRAND_ADAPTABLE.has(templateId)) return html;
  return html
    .replaceAll(IBRA_TOKENS.bg, '#FAFAF7')
    .replaceAll(IBRA_TOKENS.text, '#1A1815')
    // Secondary dark-canvas tints used in cards/chips/terminal shells —
    // flip to light equivalents so panels don't stay near-black on paper.
    .replaceAll('#161313', '#FFFFFF')
    .replaceAll('rgba(22,19,19,0.92)', 'rgba(255,255,255,0.95)')
    .replaceAll('rgba(237,217,188,0.12)', 'rgba(26,24,21,0.12)')
    .replaceAll('rgba(237,217,188,0.18)', 'rgba(26,24,21,0.18)')
    .replaceAll('rgba(237,217,188,0.08)', 'rgba(26,24,21,0.08)');
}

// ─── Template selection catalog (for the LLM router) ───────────────────────

export interface TemplateCatalogEntry {
  id: string;
  /** PT-BR — quando o LLM deve escolher este template. */
  whenToUse: string;
}

export const TEMPLATE_SELECTION_CATALOG: TemplateCatalogEntry[] = [
  { id: 'stat-counter',        whenToUse: 'O bloco apresenta UM número de impacto como protagonista: GB liberados, % de crescimento, valor em R$, views, multiplicador (3x). O número É a mensagem.' },
  { id: 'typewriter-terminal', whenToUse: 'O bloco descreve um comando, automação ou IA executando algo — "pedi pro Claude", "rodei o script", "a IA analisou". Visual de terminal digitando.' },
  { id: 'imessage-notif',      whenToUse: 'O bloco menciona mensagem recebida, notificação, resultado que "chega" — "olha o que recebi", "me avisou", "mandou o relatório".' },
  { id: 'toggle-flip',         whenToUse: 'O bloco fala de ATIVAR/LIGAR uma função, recurso ou configuração — "ative isso", "liga essa opção", "habilite o modo X".' },
  { id: 'progress-bar',        whenToUse: 'O bloco lista PASSOS de um processo (2 a 4 etapas claras) — "primeiro... depois... por fim", tutorial em sequência.' },
  { id: 'apple-maps-route',    whenToUse: 'O bloco menciona lugar físico, trajeto, distância, "como chegar", localização — visual de navegação Apple Maps.' },
  { id: 'wastebasket-trash',   whenToUse: 'O bloco manda ABANDONAR/SUBSTITUIR ferramentas — "pare de usar X", "joga o CapCut fora", "esquece o Premiere". 3 apps vão pro lixo e a alternativa é revelada.' },
  { id: 'app-icon-launcher',   whenToUse: 'O bloco apresenta um CONJUNTO de apps/ferramentas (stack, kit, "as ferramentas que eu uso") — grid 3×3 de ícones.' },
  { id: 'claude-bloom-steps',  whenToUse: 'O bloco REVELA a solução/ferramenta vencedora + um mini-plano — "a resposta é X, e você só precisa de 3 passos".' },
  { id: 'audio-waveform',      whenToUse: 'O bloco é sobre áudio, voz, podcast, narração, escuta — visualizador de onda sonora.' },
];

// ─── Variable extraction via Gemini ─────────────────────────────────────────

export interface TemplateVariableSchema {
  name: string;
  description: string;
  example: string;
  required: boolean;
}

export const TEMPLATE_VARIABLE_SCHEMAS: Record<string, TemplateVariableSchema[]> = {
  'stat-counter': [
    { name: 'EYEBROW',     description: 'Pequena legenda acima do número (ex: "Liberado", "Crescimento", "Economia")', example: 'Espaço Liberado', required: true },
    { name: 'STAT_NUMBER', description: 'O número/valor a exibir (só números, sem unidade)', example: '21', required: true },
    { name: 'STAT_UNIT',   description: 'Unidade após o número (ex: "GB", "%", "k", "x", "s")', example: 'GB', required: true },
    { name: 'SUBTITLE',    description: 'Texto menor abaixo (contexto, pode ser vazio)', example: 'em menos de 30 segundos', required: false },
  ],
  'typewriter-terminal': [
    { name: 'COMMAND',  description: 'Comando digitado na linha do terminal', example: 'claude analyze my storage', required: true },
    { name: 'LINE1',    description: 'Primeira linha de output do terminal', example: '→ escaneando 12.847 arquivos...', required: true },
    { name: 'LINE2',    description: 'Segunda linha de output', example: '→ encontrados 21GB liberáveis...', required: true },
    { name: 'SUCCESS',  description: 'Linha de sucesso verde (resultado final)', example: 'Pronto. 21GB liberados.', required: true },
  ],
  'imessage-notif': [
    { name: 'SENDER_1',  description: 'Nome do remetente da primeira notificação', example: 'Claude', required: true },
    { name: 'MESSAGE_1', description: 'Texto da primeira mensagem/notificação', example: 'Feito! Analisei 12.847 arquivos e encontrei 21GB liberáveis.', required: true },
    { name: 'SENDER_2',  description: 'Nome do app/remetente da segunda notificação', example: 'Claude Code', required: true },
    { name: 'MESSAGE_2', description: 'Texto da segunda mensagem', example: '21GB liberados. Resultado salvo em /tmp/report.md', required: true },
    { name: 'TIME',      description: 'Horário exibido na tela (formato HH:MM)', example: '9:41', required: false },
  ],
  'audio-waveform': [],
  'app-icon-launcher': [
    { name: 'ICON_1', description: 'App/ferramenta 1 — nome de marca buscada online ou emoji/símbolo', example: 'Claude', required: false },
    { name: 'ICON_2', description: 'App/ferramenta 2', example: 'Notion', required: false },
    { name: 'ICON_3', description: 'App/ferramenta 3', example: 'Figma', required: false },
    { name: 'ICON_4', description: 'App/ferramenta 4', example: 'Linear', required: false },
    { name: 'ICON_5', description: 'App/ferramenta 5', example: 'Cursor', required: false },
    { name: 'ICON_6', description: 'App/ferramenta 6', example: 'Vercel', required: false },
    { name: 'ICON_7', description: 'App/ferramenta 7', example: 'Supabase', required: false },
    { name: 'ICON_8', description: 'App/ferramenta 8', example: 'Stripe', required: false },
    { name: 'ICON_9', description: 'App/ferramenta 9', example: 'Slack', required: false },
  ],
  'wastebasket-trash': [
    { name: 'TOOL_1',  description: 'Primeira ferramenta que vai para a lixeira', example: 'CapCut', required: true },
    { name: 'TOOL_2',  description: 'Segunda ferramenta', example: 'After Effects', required: true },
    { name: 'TOOL_3',  description: 'Terceira ferramenta', example: 'Premiere', required: true },
    { name: 'WINNER',  description: 'A ferramenta que substitui todas (revelada no final)', example: 'Claude Code', required: true },
    { name: 'STEP_1',  description: 'Chip de passo 1 (curto, max 12 chars)', example: 'HyperFrames', required: false },
    { name: 'STEP_2',  description: 'Chip de passo 2', example: 'Remotion', required: false },
    { name: 'STEP_3',  description: 'Chip de passo 3', example: 'Ship', required: false },
  ],
  'toggle-flip': [
    { name: 'LABEL',       description: 'Nome do recurso/função sendo ativado (curto)', example: 'Modo Turbo', required: true },
    { name: 'DESCRIPTION', description: 'Descrição curta do que o recurso faz (1 linha)', example: 'Renderiza 3x mais rápido sem perder qualidade.', required: true },
  ],
  'progress-bar': [
    { name: 'STEP_1', description: 'Passo 1 do processo (curto, max 25 chars)', example: 'Instalar HyperFrames', required: true },
    { name: 'STEP_2', description: 'Passo 2', example: 'Carregar o script', required: true },
    { name: 'STEP_3', description: 'Passo 3', example: 'Gerar o vídeo', required: false },
    { name: 'STEP_4', description: 'Passo 4', example: 'Publicar', required: false },
  ],
  'apple-maps-route': [
    { name: 'DESTINATION', description: 'Nome do destino exibido no card de rota', example: 'Escritório Anthropic', required: true },
    { name: 'ETA_MIN',     description: 'Tempo estimado em minutos (só o número)', example: '12', required: true },
    { name: 'DISTANCE',    description: 'Distância com unidade', example: '4.2 km', required: true },
    { name: 'ARRIVE_AT',   description: 'Horário de chegada (HH:MM, opcional)', example: '9:53', required: false },
  ],
  'claude-bloom-steps': [
    { name: 'BRAND',  description: 'Nome da ferramenta/marca revelada (logo buscado automaticamente)', example: 'Claude Code', required: true },
    { name: 'STEP_1', description: 'Chip de passo 1 (curto, max 12 chars)', example: 'Instalar', required: true },
    { name: 'STEP_2', description: 'Chip de passo 2', example: 'Configurar', required: true },
    { name: 'STEP_3', description: 'Chip de passo 3', example: 'Publicar', required: true },
  ],
};
