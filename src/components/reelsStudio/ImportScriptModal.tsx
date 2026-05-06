import React, { useState } from 'react';
import { importScriptWithAI, importScriptHeuristic } from './scriptImporter';
import type { ScriptBlock } from './types';

interface Props {
  onClose: () => void;
  onImported: (blocks: ScriptBlock[]) => void;
}

const PLACEHOLDER = `Cole seu roteiro aqui. Exemplo:

Olá pessoal! Hoje eu vou te mostrar uma ferramenta que mudou completamente como eu crio conteúdo.

Olha só, aqui é a interface principal. Repare como tudo é simples — você cola o roteiro, marca onde aparece o avatar, e o resto o app faz sozinho.

Vamos clicar em Gerar e ver acontecer. Em poucos segundos, o áudio fica pronto e os clipes do avatar também.

Se gostou, segue pra mais conteúdo assim. Tchau!`;

export const ImportScriptModal: React.FC<Props> = ({ onClose, onImported }) => {
  const [text, setText] = useState('');
  const [useAI, setUseAI] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = wordCount / 2.5;
  const canImport = text.trim().length > 0 && !analyzing;

  const handleImport = async () => {
    setError(null);
    if (!useAI) {
      const blocks = importScriptHeuristic(text);
      onImported(blocks);
      return;
    }
    setAnalyzing(true);
    try {
      const blocks = await importScriptWithAI(text);
      onImported(blocks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao analisar com IA';
      setError(msg);
      setAnalyzing(false);
    }
  };

  const handleFallback = () => {
    setError(null);
    const blocks = importScriptHeuristic(text);
    onImported(blocks);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
      <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-2xl w-full overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-6 pt-6 pb-4 flex items-start justify-between shrink-0">
          <div>
            <div className="text-base font-semibold text-zinc-100 mb-1">Importar roteiro</div>
            <div className="text-xs text-zinc-500">Cole seu roteiro completo. A IA vai dividir em blocos e marcar avatar/B-roll.</div>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors" disabled={analyzing}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 flex-1 overflow-y-auto">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            disabled={analyzing}
            className="w-full h-64 px-3 py-3 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-400/50 transition-colors resize-none leading-relaxed disabled:opacity-50"
          />
          <div className="flex items-center justify-between mt-2 text-[10px] text-zinc-500 font-mono">
            <span>{wordCount} palavras</span>
            <span>~{estimatedSeconds.toFixed(0)}s narrados</span>
          </div>
        </div>

        {/* AI toggle */}
        <div className="px-6 py-4 mt-2 border-t border-white/5 bg-black/20">
          <label className={`flex items-start gap-3 ${analyzing ? 'opacity-50' : 'cursor-pointer'}`}>
            <button
              type="button"
              onClick={() => !analyzing && setUseAI(v => !v)}
              disabled={analyzing}
              className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${useAI ? 'bg-violet-500' : 'bg-zinc-700'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-all ${useAI ? 'left-[18px]' : 'left-0.5'}`}></div>
            </button>
            <div className="flex-1">
              <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                Marcar com IA <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 uppercase tracking-wider">Recomendado</span>
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {useAI
                  ? 'Gemini analisa o roteiro e marca cada bloco como avatar ou B-roll automaticamente. Você ajusta depois.'
                  : 'Quebra o texto por parágrafos. Marcação automática por palavras-chave (menos preciso).'}
              </div>
            </div>
          </label>

          {error && (
            <div className="mt-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="text-[11px] text-red-300 mb-1">⚠ {error}</div>
              <button onClick={handleFallback} className="text-[10px] text-red-200 underline hover:text-red-100">
                Importar sem IA (modo heurístico)
              </button>
            </div>
          )}
        </div>

        <div className="px-6 py-4 flex gap-2 border-t border-white/5 shrink-0">
          <button
            onClick={onClose}
            disabled={analyzing}
            className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport}
            className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2"
          >
            {analyzing ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Analisando seu roteiro...
              </>
            ) : (
              <>Importar →</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
