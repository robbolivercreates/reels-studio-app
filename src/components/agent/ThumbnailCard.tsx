import React, { useState } from 'react';
import { ThemeTokens } from '../reelsStudio/theme';
import { saveThumbnailToAssets } from '../../services/thumbnailService';

interface ThumbnailCardProps {
  dataUrl: string;
  filename: string;
  projectName: string;
  tokens: ThemeTokens;
}

export const ThumbnailCard: React.FC<ThumbnailCardProps> = ({
  dataUrl,
  filename,
  projectName,
  tokens,
}) => {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSaveToAssets = async () => {
    if (saveStatus === 'saving' || saveStatus === 'saved') return;
    setSaveStatus('saving');
    try {
      await saveThumbnailToAssets(projectName, filename, dataUrl);
      setSaveStatus('saved');
    } catch (err: any) {
      console.error('[ThumbnailCard] Erro ao salvar nos assets:', err);
      setSaveStatus('error');
      setErrorMessage(err.message || 'Erro desconhecido');
      setTimeout(() => setSaveStatus('idle'), 4000);
    }
  };

  return (
    <div
      className="flex flex-col gap-4 p-4 rounded-2xl w-full max-w-[340px] mx-auto border transition-all duration-300 hover:shadow-xl hover:shadow-black/20"
      style={{
        backgroundColor: '#0F0F15',
        borderColor: 'rgba(0, 180, 216, 0.15)',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.4)',
        background: 'linear-gradient(135deg, #0A0A0F 0%, #151025 100%)',
      }}
    >
      {/* Title Header */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-widest text-[#00B4D8] font-bold">
          Thumbnail Gerada
        </span>
        <span className="text-xs font-semibold text-white truncate" title={filename}>
          {filename}
        </span>
      </div>

      {/* Portrait Image Preview Container */}
      <div className="relative aspect-[9/16] w-full max-h-[380px] rounded-xl overflow-hidden border border-white/10 bg-black/40 group shadow-inner">
        <img
          src={dataUrl}
          alt="Thumbnail Preview"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        {/* Glow overlay effect */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
      </div>

      {/* Action Buttons Row */}
      <div className="flex flex-col gap-2">
        {/* Baixar Button - direct download */}
        <a
          href={dataUrl}
          download={filename}
          className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white text-center cursor-pointer transition-all duration-200 active:scale-95 border border-[#00B4D8]/30 hover:border-[#00B4D8] hover:shadow-[0_0_12px_rgba(0,180,216,0.3)]"
          style={{
            background: 'linear-gradient(90deg, rgba(0, 180, 216, 0.2) 0%, rgba(123, 47, 190, 0.2) 100%)',
          }}
        >
          <span className="text-sm">⬇</span>
          <span>Baixar PNG</span>
        </a>

        {/* Salvar nos Assets Button */}
        <button
          onClick={handleSaveToAssets}
          disabled={saveStatus === 'saving' || saveStatus === 'saved'}
          className={`flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-center transition-all duration-200 active:scale-95 border ${
            saveStatus === 'saved'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
              : saveStatus === 'error'
              ? 'border-red-500/50 bg-red-500/10 text-red-400'
              : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
          }`}
        >
          {saveStatus === 'idle' && (
            <>
              <span className="text-sm">💾</span>
              <span>Salvar nos Assets</span>
            </>
          )}
          {saveStatus === 'saving' && (
            <>
              <span className="animate-spin text-sm">⏳</span>
              <span>Salvando...</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <span className="text-sm">✓</span>
              <span>Salvo nos Assets!</span>
            </>
          )}
          {saveStatus === 'error' && (
            <>
              <span className="text-sm">✕</span>
              <span>{errorMessage || 'Erro ao salvar'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
