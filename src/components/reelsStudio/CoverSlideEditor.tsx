/**
 * CoverSlideEditor — editable cover image panel for carousel wizards.
 *
 * Shows an editable prompt textarea, optional reference photo + brand logo,
 * and a "Gerar capa" button that calls GPT Image 2 via fal.ai.
 * Shared between CreationWizard and GuidedWizard.
 */

import React, { useRef } from 'react';

interface DetectedBrandProp {
  name: string;
  domain: string;
  /** base64 data-URI fetched from Clearbit — null while loading, false if fetch failed */
  logoDataUri: string | null | false;
}

interface Props {
  editedPrompt: string;
  referencePhoto: string | null;
  generatedImageUrl: string | null;
  generating: boolean;
  error: string | null;
  hasKey: boolean;
  /** Brand detected from the topic (e.g. Canva, Claude). Shows logo + status. */
  detectedBrand?: DetectedBrandProp | null;
  onPromptChange: (v: string) => void;
  onReferencePhotoChange: (v: string | null) => void;
  onGenerate: () => void;
}

export const CoverSlideEditor: React.FC<Props> = ({
  editedPrompt,
  referencePhoto,
  generatedImageUrl,
  generating,
  error,
  hasKey,
  detectedBrand,
  onPromptChange,
  onReferencePhotoChange,
  onGenerate,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const result = ev.target?.result;
      if (typeof result === 'string') onReferencePhotoChange(result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="mb-3 rounded-xl border border-cyan-500/20 bg-[#0A0A0F] overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-cyan-300 uppercase tracking-wider">Slide 1 · Capa</span>
          <span className="text-[9px] text-zinc-500 bg-white/5 rounded px-1.5 py-0.5">GPT Image 2 · fal.ai</span>
        </div>
        {!hasKey && (
          <span className="text-[9px] text-amber-400">FAL_KEY não configurada</span>
        )}
      </div>

      <div className="p-3 space-y-2.5">
        {/* Generated image preview */}
        {generatedImageUrl && (
          <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: '4/5' }}>
            <img
              src={generatedImageUrl}
              alt="Capa gerada"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>
        )}

        {/* Prompt editor */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Prompt</span>
            <button
              onClick={() => onPromptChange('')}
              className="text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors"
              title="Limpar prompt"
            >
              Limpar
            </button>
          </div>
          <textarea
            value={editedPrompt}
                    spellCheck={false}
                    autoCorrect="off"
                    onChange={e => onPromptChange(e.target.value)}
            rows={5}
            className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-2.5 py-2 text-[10px] text-zinc-300 placeholder-zinc-600 resize-y focus:outline-none focus:border-cyan-500/40 transition-colors leading-relaxed"
            placeholder="Descreva a capa aqui — ou aguarde a geração automática…"
          />
        </div>

        {/* Reference assets row: photo + brand logo */}
        <div className="flex items-start gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoUpload}
          />

          {/* Creator reference photo */}
          {referencePhoto ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <img
                src={referencePhoto}
                alt="Foto de referência"
                className="w-8 h-8 rounded-md object-cover shrink-0 border border-cyan-500/30"
              />
              <span className="text-[10px] text-zinc-400 truncate flex-1">Foto de referência</span>
              <button
                onClick={() => onReferencePhotoChange(null)}
                className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors shrink-0"
              >
                Remover
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-white/20 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Adicionar foto de referência
            </button>
          )}

          {/* Brand logo badge */}
          {detectedBrand && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/5">
              {detectedBrand.logoDataUri === null ? (
                // Loading
                <div className="w-4 h-4 border border-cyan-500/40 border-t-transparent rounded-full animate-spin" />
              ) : detectedBrand.logoDataUri === false ? (
                // Failed — show icon placeholder
                <div className="w-4 h-4 rounded bg-white/10 flex items-center justify-center text-[8px] text-zinc-500">?</div>
              ) : (
                // Loaded
                <img
                  src={detectedBrand.logoDataUri}
                  alt={`${detectedBrand.name} logo`}
                  className="w-4 h-4 rounded object-contain bg-white"
                />
              )}
              <span className="text-[9px] text-cyan-400">{detectedBrand.name}</span>
              {typeof detectedBrand.logoDataUri === 'string' && (
                <span className="text-[8px] text-zinc-600">logo detectado</span>
              )}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">{error}</p>
        )}

        {/* Generate button */}
        <button
          onClick={onGenerate}
          disabled={generating || !hasKey || !editedPrompt.trim()}
          className="w-full py-2 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{
            background: 'linear-gradient(135deg, rgba(0,180,216,0.2), rgba(123,47,190,0.2))',
            border: '1px solid rgba(0,180,216,0.3)',
            color: generating ? '#94a3b8' : '#67e8f9',
          }}
        >
          {generating ? (
            <>
              <div className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
              Gerando capa…
            </>
          ) : generatedImageUrl ? (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Gerar novamente
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Gerar capa com GPT Image 2
            </>
          )}
        </button>
      </div>
    </div>
  );
};
