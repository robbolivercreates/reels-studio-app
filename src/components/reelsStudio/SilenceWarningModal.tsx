// Anti-dessync warning shown when the user clicks "Gerar clipes" with
// silence detected but the silence-cut toggle is OFF. Without applying
// the cut first, HeyGen renders the avatar with silences baked into
// the lipsync; the export then strips those silences and the lips
// drift out of sync with the audio.
//
// The user can: apply + generate, generate anyway (acknowledge the
// risk), or cancel.

import React from 'react';

interface Props {
  silenceSeconds: number;
  durationSeconds: number;
  onApplyAndGenerate: () => void;
  onGenerateAnyway: () => void;
  onCancel: () => void;
}

export const SilenceWarningModal: React.FC<Props> = ({
  silenceSeconds,
  durationSeconds,
  onApplyAndGenerate,
  onGenerateAnyway,
  onCancel,
}) => {
  const savedPct = durationSeconds > 0
    ? Math.round((silenceSeconds / durationSeconds) * 100)
    : 0;
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-6">
      <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-md w-full overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <div className="text-[11px] uppercase tracking-widest text-amber-300/80 font-semibold mb-2">
            Sync · atenção
          </div>
          <div className="text-base font-semibold text-zinc-100 mb-2">
            Aplicar corte de silêncio antes?
          </div>
          <div className="text-[12px] text-zinc-400 leading-relaxed">
            Detectei <span className="text-zinc-200 font-medium">{silenceSeconds.toFixed(1)}s</span> de
            silêncio nesse áudio (≈{savedPct}% da duração). Se eu gerar o HeyGen
            agora, ele vai sincronizar os lábios <span className="text-zinc-200">com</span> o silêncio —
            quando o export cortar depois, o áudio fica fora de sync.
          </div>
        </div>

        <div className="px-6 py-3 bg-black/30 mt-4 border-t border-white/5">
          <div className="text-[10.5px] text-zinc-500 leading-snug">
            <span className="text-zinc-400">Recomendado:</span> aplicar agora.
            O HeyGen renderiza só {(durationSeconds - silenceSeconds).toFixed(1)}s
            (mais barato) e o sync sai perfeito.
          </div>
        </div>

        <div className="px-6 py-4 flex flex-col gap-2">
          <button
            onClick={onApplyAndGenerate}
            className="w-full py-2.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-[12.5px] font-semibold transition-colors"
          >
            Aplicar corte e gerar (recomendado)
          </button>
          <button
            onClick={onGenerateAnyway}
            className="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-[12px] font-medium transition-colors"
          >
            Gerar sem cortar
          </button>
          <button
            onClick={onCancel}
            className="w-full py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};
