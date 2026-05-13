import { GoogleGenAI } from '@google/genai';
import type { ScriptBlock } from '../components/reelsStudio/types';

const getApiKey = (): string => {
  const key = localStorage.getItem('GOOGLE_API_KEY');
  if (!key) throw new Error('GOOGLE_API_KEY não configurada. Adicione em Configurações.');
  return key;
};

const MODEL = 'gemini-3-flash-preview';

export const generateInstagramCaption = async (
  blocks: ScriptBlock[],
  projectName: string,
): Promise<string> => {
  const script = blocks.map(b => b.text.trim()).filter(Boolean).join(' ');
  if (!script) throw new Error('Script vazio — adicione texto nos blocos antes de gerar a descrição.');

  // Use the last block as the CTA (typically where the call-to-action lives)
  const cta = blocks[blocks.length - 1]?.text.trim() ?? '';

  const prompt = `Escreva uma descrição otimizada para Instagram Reels em português brasileiro.

ROTEIRO DO VÍDEO:
${script}

CTA DO VÍDEO (último bloco): ${cta}

ESTRUTURA OBRIGATÓRIA (escreva tudo, não corte):
1. Hook (1 linha que para o scroll — pergunta ou afirmação forte)
2. Linha em branco
3. Corpo (3-4 linhas explicando o valor do conteúdo)
4. Linha em branco
5. CTA (1 linha direta baseada no CTA do vídeo)
6. Linha em branco
7. Hashtags (10 hashtags relevantes)

REGRAS:
- Apenas português brasileiro conversacional
- Sem markdown, sem aspas, sem explicações
- Retorne SOMENTE o texto da descrição, pronto para colar`;

  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  // Flash em primeiro; Pro como fallback. Flash Lite cortado — entrega
  // caption morna pra texto criativo.
  const models = [MODEL, 'gemini-3.1-pro-preview'];
  let lastErr: unknown;
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { temperature: 0.8, maxOutputTokens: 2048 },
      });
      const text = response.text?.trim();
      if (!text) throw new Error('Resposta vazia do modelo.');
      return text;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
};
