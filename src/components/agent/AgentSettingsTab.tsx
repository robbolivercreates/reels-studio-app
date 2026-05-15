// Settings tab that mirrors Daydream's "Agents" panel. Shows whether the
// user has Claude Code installed/authed, whether our MCP server is running
// and registered, and offers a manual-setup snippet they can copy if
// auto-register failed.

import React, { useCallback, useEffect, useState } from 'react';
import { getHealth, registerMcp } from './agentBridge';
import type { ClaudeHealth } from './types';
import {
  ACTIVE_PROVIDERS,
  useTextProvider,
  useMotionProvider,
  useMaxBlockSec,
  type TextProvider,
  type MotionProvider,
  type MaxBlockSec,
} from './agentPrefs';

export const AgentSettingsTab: React.FC = () => {
  const [health, setHealth] = useState<ClaudeHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { value: textProvider, resolved: resolvedTextProvider, setValue: setTextProvider } = useTextProvider();
  const { value: motionProvider, resolved: resolvedMotionProvider, setValue: setMotionProvider } = useMotionProvider();
  const { value: maxBlockSec, setValue: setMaxBlockSec } = useMaxBlockSec();
  const [skipSetup, setSkipSetup] = useState<boolean>(
    () => typeof window !== 'undefined' && window.localStorage?.getItem('reels.agent.skipReelSetup') === 'true',
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await getHealth();
      setHealth(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRegister = useCallback(async () => {
    setRegistering(true);
    setError(null);
    try {
      await registerMcp();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegistering(false);
    }
  }, [refresh]);

  const port = health?.mcp_port;
  const mcpCmd = port
    ? `claude mcp add reels --transport http http://127.0.0.1:${port}/mcp --scope user`
    : 'claude mcp add reels --transport http http://127.0.0.1:PORT/mcp --scope user';

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(mcpCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [mcpCmd]);

  return (
    <div className="px-6 pt-4 pb-2 flex-1 overflow-y-auto space-y-5">
      {/* Claude Code card */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🤖</span>
          <div className="flex-1">
            <div className="text-[12px] font-semibold text-zinc-100">Anthropic Claude Code</div>
            <div className="text-[10px] text-zinc-500">Use sua assinatura do Claude — sem precisar de chave de API.</div>
          </div>
          <StatusBadge health={health} loading={loading} />
        </div>

        {health && !health.installed && (
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[10.5px] text-amber-200 leading-snug">
            Claude Code CLI não encontrado no PATH.{' '}
            <a
              href="https://docs.claude.com/en/docs/claude-code/quickstart"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-amber-100"
            >
              Instalar agora →
            </a>
          </div>
        )}

        {health && health.installed && !health.authed && (
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[10.5px] text-amber-200 leading-snug">
            Claude Code instalado mas sem login. Abra um terminal e rode <code className="bg-black/30 px-1 rounded">claude</code> para entrar.
          </div>
        )}

        {health && health.installed && health.authed && !health.registered && (
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[10.5px] text-amber-200 leading-snug flex items-center gap-3">
            <span className="flex-1">
              MCP server <code className="bg-black/30 px-1 rounded">reels</code> ainda não registrado no Claude Code.
            </span>
            <button
              onClick={() => void handleRegister()}
              disabled={registering}
              className="text-[10px] px-2 py-1 rounded-md bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-violet-100 disabled:opacity-50"
            >
              {registering ? 'Registrando…' : 'Registrar'}
            </button>
          </div>
        )}

        {health && health.installed && health.authed && health.registered && (
          <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-[10.5px] text-emerald-200 leading-snug">
            Tudo pronto. O Claude Code já pode listar e operar este projeto via MCP.
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="text-[10px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 disabled:opacity-50"
          >
            {loading ? 'Verificando…' : 'Verificar de novo'}
          </button>
        </div>
      </div>

      {/* Manual setup */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Setup manual</div>
        <div className="text-[10.5px] text-zinc-400 leading-snug">
          Se o registro automático falhar, rode este comando em um terminal externo. O MCP server precisa estar rodando (este app aberto).
        </div>
        <div className="rounded-md bg-black/40 border border-white/10 px-3 py-2 flex items-center gap-2">
          <code className="flex-1 text-[10.5px] font-mono text-zinc-200 truncate">{mcpCmd}</code>
          <button
            onClick={handleCopy}
            disabled={!port}
            className="text-[10px] px-2 py-0.5 rounded-md bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-200 disabled:opacity-40 shrink-0"
          >
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
        {port ? (
          <div className="text-[10px] text-zinc-500">
            MCP rodando em <code className="bg-black/30 px-1 rounded">127.0.0.1:{port}/mcp</code>.
          </div>
        ) : (
          <div className="text-[10px] text-amber-300">
            MCP server ainda não iniciado. Reinicie o app se isto persistir.
          </div>
        )}
      </div>

      {/* Active providers — read-only inventory. Surfaces "what's running
          under the hood" without forcing a configuration choice for the
          ~95% of capabilities that have only one real provider today.
          Upgrades to dropdowns naturally when alternatives appear. */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
          Provedores ativos
        </div>
        <div className="text-[10.5px] text-zinc-400 leading-snug">
          O agente roteia cada tipo de operação pro provedor certo automaticamente.
          As chaves de API ficam em <span className="text-zinc-200">Chaves de API</span>.
        </div>
        <div className="space-y-1.5">
          {ACTIVE_PROVIDERS.map(p => {
            const hasKey = p.storageKey ? !!localStorage.getItem(p.storageKey) : true;
            return (
              <div
                key={p.capability}
                className="flex items-start gap-3 px-3 py-2 rounded-md bg-black/20 border border-white/5"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-zinc-200">{p.label}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">
                    {p.provider}
                    {p.note && <span className="text-zinc-500"> · {p.note}</span>}
                  </div>
                </div>
                {p.storageKey && (
                  <span
                    className={`text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0 ${
                      hasKey
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-200'
                        : 'bg-amber-500/15 border border-amber-500/30 text-amber-200'
                    }`}
                  >
                    {hasKey ? 'configurado' : 'falta chave'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Advanced — single power-user toggle, collapsed by default. */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <button
          onClick={() => setAdvancedOpen(o => !o)}
          className="w-full flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <svg
            className="w-2.5 h-2.5 transition-transform"
            style={{ transform: advancedOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Avançado
        </button>

        {advancedOpen && (
          <div className="mt-2 space-y-5">
            {/* ─── TEXT PROVIDER ─── */}
            <div className="space-y-2.5">
              <div>
                <div className="text-[11.5px] font-medium text-zinc-200 mb-0.5">
                  Provedor para roteiros e textos
                </div>
                <div className="text-[10px] text-zinc-500 leading-snug">
                  Quem escreve roteiros, captions, regenerações de bloco. O perfil de voz que você
                  cadastrou é injetado no prompt em ambos os modos.
                </div>
              </div>

              <div className="space-y-1.5">
                {([
                  {
                    id: 'auto' as TextProvider,
                    label: 'Auto',
                    hint: 'Gemini se tiver a chave; Claude como fallback.',
                  },
                  {
                    id: 'gemini' as TextProvider,
                    label: 'Sempre Gemini',
                    hint: 'Flash (rápido) com Pro como fallback. Requer GOOGLE_API_KEY.',
                  },
                  {
                    id: 'claude' as TextProvider,
                    label: 'Sempre Claude',
                    hint: 'Usa sua assinatura do Claude. Modelo escolhido no picker do chat (Sonnet/Opus/Haiku).',
                  },
                ]).map(opt => {
                  const active = textProvider === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setTextProvider(opt.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-start gap-2.5 ${
                        active
                          ? 'bg-violet-500/15 border border-violet-500/40'
                          : 'bg-black/20 border border-white/5 hover:bg-white/[0.04]'
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full mt-0.5 shrink-0 border ${
                          active ? 'border-violet-400 bg-violet-500' : 'border-zinc-500'
                        }`}
                      >
                        {active && (
                          <div className="w-full h-full rounded-full flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11.5px] font-medium text-zinc-100">{opt.label}</div>
                        <div className="text-[10px] text-zinc-500 leading-snug mt-0.5">{opt.hint}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="text-[10px] text-zinc-500">
                Em uso agora: <span className="text-zinc-300 font-mono">{resolvedTextProvider}</span>
                {textProvider === 'auto' && (
                  <span className="text-zinc-600"> · resolvido pela chave configurada</span>
                )}
              </div>
            </div>

            {/* ─── MOTION PROVIDER ─── */}
            <div className="space-y-2.5">
              <div>
                <div className="text-[11.5px] font-medium text-zinc-200 mb-0.5">
                  Provedor para motion graphics
                </div>
                <div className="text-[10px] text-zinc-500 leading-snug">
                  Quem gera o HTML+CSS dos motions. Gemini tem busca automática de cores de marca via
                  Google Search. Claude segue as regras HyperFrames mas sem grounding — mais lento.
                </div>
              </div>

              <div className="space-y-1.5">
                {([
                  {
                    id: 'auto' as MotionProvider,
                    label: 'Auto',
                    hint: 'Gemini Pro se tiver a chave; Claude como fallback.',
                  },
                  {
                    id: 'gemini' as MotionProvider,
                    label: 'Sempre Gemini',
                    hint: 'Gemini 3.1 Pro com brand-color grounding. Flash como fallback de erro.',
                  },
                  {
                    id: 'claude' as MotionProvider,
                    label: 'Sempre Claude',
                    hint: 'Claude escreve o HTML direto. Modelo do picker do chat. Sem grounding de marca.',
                  },
                ]).map(opt => {
                  const active = motionProvider === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setMotionProvider(opt.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-start gap-2.5 ${
                        active
                          ? 'bg-violet-500/15 border border-violet-500/40'
                          : 'bg-black/20 border border-white/5 hover:bg-white/[0.04]'
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full mt-0.5 shrink-0 border ${
                          active ? 'border-violet-400 bg-violet-500' : 'border-zinc-500'
                        }`}
                      >
                        {active && (
                          <div className="w-full h-full rounded-full flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11.5px] font-medium text-zinc-100">{opt.label}</div>
                        <div className="text-[10px] text-zinc-500 leading-snug mt-0.5">{opt.hint}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="text-[10px] text-zinc-500">
                Em uso agora: <span className="text-zinc-300 font-mono">{resolvedMotionProvider}</span>
                {motionProvider === 'auto' && (
                  <span className="text-zinc-600"> · resolvido pela chave configurada</span>
                )}
              </div>
            </div>

            {/* ─── MAX BLOCK SECONDS ─── */}
            <div className="space-y-2.5">
              <div>
                <div className="text-[11.5px] font-medium text-zinc-200 mb-0.5">
                  Duração máxima do bloco
                </div>
                <div className="text-[10px] text-zinc-500 leading-snug">
                  Blocos longos viram cansativos no avatar e estáticos no B-roll.
                  Quando o import detectar um bloco mais longo que o limite, ele
                  é quebrado na pausa natural mais próxima — a primeira parte
                  fica avatar, o resto vira B-roll.
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  { id: 3 as MaxBlockSec, label: '3s' },
                  { id: 5 as MaxBlockSec, label: '5s' },
                  { id: 8 as MaxBlockSec, label: '8s' },
                  { id: 'auto' as MaxBlockSec, label: 'Auto' },
                ]).map(opt => {
                  const active = maxBlockSec === opt.id;
                  return (
                    <button
                      key={String(opt.id)}
                      onClick={() => setMaxBlockSec(opt.id)}
                      className={`text-[11.5px] font-medium py-1.5 rounded-lg transition-colors ${
                        active
                          ? 'bg-violet-500/15 border border-violet-500/40 text-violet-100'
                          : 'bg-black/20 border border-white/5 text-zinc-400 hover:bg-white/[0.04]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <div className="text-[10px] text-zinc-500">
                {maxBlockSec === 'auto'
                  ? 'Sem limite — a IA decide o tamanho dos blocos.'
                  : `Blocos acima de ${maxBlockSec}s são divididos automaticamente.`}
              </div>
            </div>

            {/* ─── IMPORT SETUP CARD ─── */}
            <div className="space-y-2">
              <div>
                <div className="text-[11.5px] font-medium text-zinc-200 mb-0.5">
                  Pré-perguntas em imports de vídeo
                </div>
                <div className="text-[10px] text-zinc-500 leading-snug">
                  Quando você cola um link de reel/TikTok sem dizer duração, tom ou foco, o chat
                  pergunta antes de gerar. Desligue se prefere ir direto com os padrões.
                </div>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer px-3 py-2 rounded-lg bg-black/20 border border-white/5 hover:bg-white/[0.04]">
                <input
                  type="checkbox"
                  checked={skipSetup}
                  onChange={e => {
                    const next = e.target.checked;
                    setSkipSetup(next);
                    if (next) {
                      window.localStorage.setItem('reels.agent.skipReelSetup', 'true');
                    } else {
                      window.localStorage.removeItem('reels.agent.skipReelSetup');
                    }
                  }}
                  className="w-3.5 h-3.5 accent-violet-500"
                />
                <div className="text-[11.5px] text-zinc-100">
                  Sempre pular o card de setup
                </div>
              </label>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-[10.5px] text-red-300">
          {error}
        </div>
      )}
    </div>
  );
};

interface StatusBadgeProps {
  health: ClaudeHealth | null;
  loading: boolean;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ health, loading }) => {
  if (loading || !health) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-zinc-400">
        Verificando…
      </span>
    );
  }
  const allGood = health.installed && health.authed && health.registered;
  if (allGood) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-200">
        Conectado
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200">
      Não conectado
    </span>
  );
};
