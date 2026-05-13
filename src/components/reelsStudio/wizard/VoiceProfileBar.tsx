/**
 * Voice profile inline bar — extracted from the deleted VideoReferenceModal.
 * Shows active profile + language override + rewrite level override, plus an
 * "Editar perfis" button that opens the full VoiceProfilesPanel as an overlay.
 *
 * Used inside CreationWizard's config step for sources where TTS / rewrite are
 * relevant (script / video / article). NOT shown for source 'topic' or when
 * format is 'carousel' (carousel doesn't use TTS).
 */

import React from 'react';
import type { LanguageOption } from '../types';
import { REWRITE_LABELS, LANGUAGE_OPTIONS, type VoiceProfile, type RewriteLevel } from '../voiceProfile';

interface Props {
  activeProfile: VoiceProfile;
  profiles: VoiceProfile[];
  languageOverride: LanguageOption;
  rewriteOverride: RewriteLevel | null;
  disabled?: boolean;
  onSelectProfile: (id: string) => void;
  onChangeLanguage: (lang: LanguageOption) => void;
  onChangeRewrite: (level: RewriteLevel | null) => void;
  onEditProfiles: () => void;
}

export const VoiceProfileBar: React.FC<Props> = ({
  activeProfile,
  profiles,
  languageOverride,
  rewriteOverride,
  disabled = false,
  onSelectProfile,
  onChangeLanguage,
  onChangeRewrite,
  onEditProfiles,
}) => {
  const effectiveRewrite = rewriteOverride ?? activeProfile.rewriteLevel;
  return (
    <div className="px-3 py-2.5 rounded-lg bg-violet-500/[0.06] border border-violet-500/20 flex items-center gap-3 text-[11px] flex-wrap">
      <span className="text-violet-300">🎙</span>
      <span className="text-zinc-400">Perfil:</span>
      <select
        value={activeProfile.id}
        onChange={e => onSelectProfile(e.target.value)}
        disabled={disabled}
        className="bg-black/30 border border-white/10 rounded px-2 py-1 text-zinc-100 text-[11px] outline-none focus:border-violet-400/50 disabled:opacity-50"
      >
        {profiles.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <span className="text-zinc-500">·</span>
      <select
        value={languageOverride}
        onChange={e => onChangeLanguage(e.target.value as LanguageOption)}
        disabled={disabled}
        className="bg-black/30 border border-white/10 rounded px-2 py-1 text-zinc-100 text-[11px] outline-none focus:border-violet-400/50 disabled:opacity-50"
        title="Idioma de saída desta importação"
      >
        <option value="auto">
          Auto · {LANGUAGE_OPTIONS.find(l => l.value === activeProfile.outputLanguage)?.label ?? activeProfile.outputLanguage}
        </option>
        <option value="pt-BR">PT-BR</option>
        <option value="en-US">EN-US</option>
        <option value="es-ES">ES-ES</option>
        <option value="fr-FR">FR</option>
        <option value="it-IT">IT</option>
        <option value="de-DE">DE</option>
      </select>
      <span className="text-zinc-500">·</span>
      <select
        value={effectiveRewrite}
        onChange={e => {
          const v = e.target.value as RewriteLevel;
          // Clearing override happens by selecting the profile's default level.
          onChangeRewrite(v === activeProfile.rewriteLevel ? null : v);
        }}
        disabled={disabled}
        className="bg-black/30 border border-white/10 rounded px-2 py-1 text-zinc-100 text-[11px] outline-none focus:border-violet-400/50 disabled:opacity-50"
        title={REWRITE_LABELS[effectiveRewrite].hint}
      >
        {(['faithful', 'translate', 'adapt', 'reimagine'] as RewriteLevel[]).map(level => (
          <option key={level} value={level}>{REWRITE_LABELS[level].label}</option>
        ))}
      </select>
      <button
        onClick={onEditProfiles}
        disabled={disabled}
        className="ml-auto px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-200 font-medium disabled:opacity-50"
      >
        Editar perfis
      </button>
    </div>
  );
};
