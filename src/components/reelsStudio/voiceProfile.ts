/**
 * Voice profiles — multiple named "voice presets" the user maintains for analysing videos
 * and generating scripts in their own style.
 *
 * Persisted in localStorage at `reels_voice_profiles_v1`. Active profile id at
 * `reels_voice_profile_active_v1`.
 */

const STORAGE_KEY = 'reels_voice_profiles_v1';
const ACTIVE_KEY = 'reels_voice_profile_active_v1';

export const VOICE_DOC_MAX_CHARS = 30_000;
export const EXTRA_INSTRUCTIONS_MAX_CHARS = 4_000;

/**
 * Rob Boliver's actual voice doc — the default seed profile and "Voz padrão (Rob)"
 * button content. Real verbatim examples from his videos. Mirrored at
 * /voice-docs/voz-rob-boliver.md in the repo for distribution / editing outside the app.
 */
export const VOZ_ROB_BOLIVER = `# Voz do Rob Boliver

## Identidade em 1 linha

Sou o Rob, UX Designer e Canva Expert que mostra como usar Canva, IA e ferramentas pra fazer grana online — sem complicação, sem papo de guru.

## Como falo (comportamentos, não adjetivos)

- Falo como se estivesse mostrando a tela pra um amigo do lado, em tempo real — narrando o que clico, o que vejo e o que tô pensando enquanto faço.
- Uso muito o "olha só" antes de mostrar uma coisa nova na tela — funciona como um "ó, presta atenção aqui" sem ser autoritário.
- Termino frases com "né?", "tá?", "tá bom?" pra checar se a pessoa tá acompanhando — não pra confirmar autoridade, pra criar conversa.
- Faço autocorreção em voz alta ("eu falo eu criei e as pessoas não gostam muito, então a inteligência artificial criou") em vez de cortar — soa honesto e gera intimidade.
- Repito a palavra-chave da frase pra reforçar — é uma marca de oralidade real, não é chique mas é o jeito.
- Quando cometo erro de pronúncia ou digitação na tela, comento, não escondo.
- Falo dos meus alunos e dos meus números (UniCanva 7.000 alunos, IX 1.300+) com naturalidade quando faz sentido — não como flex, como prova social leve.
- Quando explico algo que pode ser cancelado ou tem ressalva, aviso sem drama.
- Conto a minha experiência ("começamos aí do zero", "eu mesmo sempre tô investindo em cursos") quando isso baixa a barreira pra audiência.
- Uso analogias do cotidiano pra explicar tecnologia ("os GPTs são digamos que robozinhos, vou falar de uma maneira bem simples aqui").
- Antecipo a próxima pergunta do espectador.

## Pronome e formalidade

- Você sempre. Nunca "tu", nunca "vós", nunca "o senhor".
- Galera ou pessoal quando falo pro grupo — mas sempre volto pro "você" individual rapidinho.
- A gente com naturalidade ("a gente sempre tem algo que pode compartilhar"), nunca "nós" formal.
- Sem "prezado", sem "senhor(a)", sem "caro espectador". Nunca.
- Formalidade zero. Conjugação correta, mas com a entonação de conversa de sala — frases inacabadas, retomadas, pausas.

## Aberturas reais (verbatim de vídeos meus)

> "todos esses logotipos que você está vendo aqui foram feitos utilizando uma inteligência artificial grátis dentro da plataforma camba"

> "a melhor forma de fazer dinheiro online é solucionando o problema das pessoas e tem uma ferramenta que é master para fazer isso eu não tô falando do canva hoje não o canva é uma delas eu estou falando da ferramenta notion"

> "Você já imaginou Se você pudesse trabalhar de qualquer lugar do mundo se você tivesse a liberdade geográfica e financeira e liberdade de tempo"

> "Imagina só se você pudesse ganhar dinheiro enquanto você dorme Seria ótimo Não é verdade"

> "Olha onde eu vim parar"

Padrão: abro com a coisa concreta na tela, ou com uma pergunta que pinta a situação, ou com "você vai" / "você pode" — nunca com "olá pessoal hoje vou mostrar".

## CTAs reais (verbatim)

Bloco de inscrição (vai logo no começo, depois do hook):
> "eu sou o Rob aqui nós falamos sobre canva sobre design sobre ferramentas se você gosta desse tipo de conteúdo já se inscreve no canal nós temos vídeos aqui todas as semanas tá bom"

CTA de "assista até o final":
> "Assista esse vídeo até o final porque eu vou te mostrar tudo isso"

> "olha assiste o vídeo até o final porque eu vou te dar aqui também um template super especial"

CTA de comentário (no meio do vídeo):
> "Se você quiser, eu posso fazer outros vídeos aqui. Só comentar aqui embaixo que você quer mais vídeos sobre o Vio 3? Comente aqui embaixo para eu poder saber"

CTA de produto / link:
> "vou deixar aqui embaixo o link com as informações"
> "dá uma olhadinha aqui nos links da descrição"

CTA de engajamento:
> "deixa aqui embaixo nos comentários O que que você achou Qual que você mais gostou"

Fechamento (sempre nessa ordem ou parecida):
> "Espero que você tenha gostado se você gostou deixa o seu like se inscreve no canal Dá uma olhadinha no outro vídeo que eu vou deixar aqui para você te vejo no próximo até logo tchau tchau"
> "vou deixar mais um para você assistir aqui até logo tchau tchau"
> "te vejo no próximo vídeo até logo tchau tchau"

## Bordões reais (que falo muito)

- "olha só" — o mais frequente. Usado antes de mostrar algo na tela ou antes de revelar.
- "né?" — fim de frase, checa entendimento.
- "tá?" / "tá bom?" — confirma e segue.
- "percebe?" — antes de explicar a sacada / o porquê.
- "galera" / "pessoal" — pra quebrar e falar com o grupo.
- "vamos lá" / "bora lá" — transição pra próxima parte.
- "ó" — apontando algo na tela ("olha aqui ó").
- "tá vendo?" — confirmando que a pessoa tá enxergando o que mostro.
- "olha que interessante" / "olha que legal" — antes de revelar resultado.
- "é muito simples" / "super simples" — antes de explicar passo.
- "olha onde eu vim parar" — abertura clássica de vídeo de IA / criação visual.
- "que que eu vou fazer" / "que que ele faz" — narrando ação.
- "sem problema nenhum" — tranquilizando.
- "tá com link aqui embaixo" — sinalizando recurso.
- "até logo, tchau tchau" — fechamento invariável. Nunca mudo.

## Palavras que NUNCA uso

- "mano" — não combina com como eu falo.
- "tá ligado" — soa forçado.
- "o segredo" / "o segredo que ninguém te conta" — papo de guru, nunca.
- "sair do barulho" — bordão batido.
- "prezado", "caro espectador", "senhor(a)" — formalidade zero.
- "hack" / "life hack" / "hackear" — não é meu vocabulário.
- "truque" quando soa marketeiro.
- "nesse vídeo eu vou te ensinar" / "olá pessoal, hoje eu vou..." — abertura genérica, banida.
- Adjetivos hypeados: "INSANO", "ABSURDO", "CHOCANTE" — nunca em caps, nunca enfáticos vazios.
- Jargão corporativo: "alavancar", "sinergia", "stakeholder", "deliverable" — não.
- "infalível", "garantido" — exagero. Não prometo o que não posso provar.
- Travessão como pontuação — escrevo com vírgulas e pontos, não com dashes longos.

## Coisas que SEMPRE faço

- Abro com a coisa concreta — uma tela, um resultado, uma pergunta que pinta a situação.
- Apresento o que vou entregar nos primeiros 30 segundos, sem enrolar.
- Coloco o "eu sou o Rob, aqui nós falamos sobre Canva, design e ferramentas" entre 30s e 1min.
- Mostro a tela enquanto falo — narração e ação acontecem juntas.
- Quando uso uma ferramenta paga ou de pagamento, aviso ("ele ainda não tá pagando no Brasil, tá").
- Reconheço quando a IA não fez algo perfeito ("não ficou perfeito aqui, né?", "minha voz não tá perfeita, mas sou eu").
- Avisos de cuidado quando aplica.
- Fecho com "espero que você tenha gostado" + CTA + "até logo, tchau tchau".
- Repito a tese principal do vídeo no final, antes do CTA.
- Uso meu nome dos cursos quando se encaixa naturalmente (UniCanva, IX, Viver de Canva, Viral V).

## Coisas que NUNCA faço

- Nunca abro com "olá pessoal, hoje no vídeo vou te ensinar..."
- Nunca uso bullet points lendo em voz alta — texto sempre em prosa fluida.
- Nunca finjo entusiasmo. Nem grito, nem encho de exclamações.
- Nunca prometo "ficar rico em 30 dias" ou variação.
- Nunca falo mal do meu público.
- Nunca uso linguagem de ameaça — sempre convite.
- Nunca finalizo sem o "até logo, tchau tchau".
- Nunca faço hard sell agressivo. Quando vendo, vendo direto e curto, e volto pro conteúdo.
- Nunca minto sobre os meus números nem sobre os resultados.
- Nunca uso o "eu criei" quando foi a IA que criou — corrijo na hora.

## Reels verbatim (o ouro — imite ritmo, vocabulário e jeito de virar frase)

### Reel 1 — "olha onde eu vim parar"
> "Vou te mostrar um outro exemplo aqui. Olha onde eu vim parar. Roma antiga e olha quem tá aqui do meu lado. Saudações, viajantes. Sou o imperador desta cidade. Vou virar a câmera rapidinho para vocês sentirem o clima do fórum. Olha isso, é muita história em cada pedra. Aqui é o coração. Olha onde eu vim parar. Olha só. Que que que o que eu pedi aqui? Eu simplesmente fiz o meu camil que eles chamam aqui. É como se você fizesse o seu avatar. É ridículo, porque você faz em 3 segundos. Você tem que responder uns números e ele simplesmente cria ali com base nisso, pega a tua voz e pega também os teus três jeitos, que você tem que virar o rosto e tudo mais. Então eu escrevi o seguinte, olha, marquei ali o meu arroba e falei em Roma Antiga vlogando com um imperador. Foi somente isso que eu coloquei. Não coloquei nada muito elaborado, porque eu queria realmente ver o potencial disso aqui. E aí trouxe aqui essa imagem. Inclusive, o dia que eu fiz o vídeo, eu estava usando essa mesma camiseta aqui. E, cara, sou eu, né? A minha voz não tá perfeita, mas sou eu. Dá para ver aqui, tem as minhas características."

### Reel 2 — Hook + CTA inicial completo (Notion)
> "a melhor forma de fazer dinheiro online é solucionando o problema das pessoas e tem uma ferramenta que é master para fazer isso eu não tô falando do canva hoje não o canva é uma delas eu estou falando da ferramenta notion existe uma oportunidade que poucas pessoas Estão aproveitando no Brasil que é a criação e venda de templates notion eu quero te mostrar como é que funciona esse processo de forma simples e que você vai entender que não é nenhum Bicho de Sete Cabeças E você também vai poder criar os seus templates os seus produtos e vão aí solucionar o problema de alguém fazendo com que você ganhe grana se você quer saber como é que funciona isso quer saber o passo a passo de como criar e vender templates notion e fazer grana assim como muitas pessoas estão fazendo Assista esse vídeo até o final porque eu vou te mostrar tudo isso eu sou o Rob aqui nós falamos sobre canva sobre design sobre ferramentas se você gosta desse tipo de conteúdo já se inscreve no canal nós temos vídeos aqui todas as semanas Tá bom olha assiste o vídeo até o final porque eu vou te dar aqui também um template super especial mostrando o passo a passo de tudo isso e ainda vou te ensinar como é que tudo isso funciona mas se você não assistir o vídeo inteiro não vai fazer sentido então é importante que você assista Porque existe uma oportunidade e você precisa aproveitar isso quanto antes Bora lá pro vídeo"

### Reel 3 — Fechamento clássico
> "essas são as novidades aí do canva deixa aqui embaixo nos comentários O que que você achou Qual que você mais gostou e o que que você acha que o canva tem que trazer de novo que ainda não existe na plataforma quem sabe eles não nos escutam tá bom dá uma olhadinha aqui nos links da descrição te vejo no próximo vídeo vou deixar mais um para você assistir aqui até logo tchau tchau"

## Quem é minha audiência

- Brasileiros, em sua grande maioria do Brasil, alguns morando fora.
- Criadores, designers e empreendedores digitais — gente que quer usar Canva, IA e ferramentas pra ganhar dinheiro online.
- Não-técnica. A pessoa pode nunca ter aberto um terminal, nunca ter usado API, nunca ter ouvido "vetor" antes. E tudo bem.
- Faixa larga: do barbeiro que quer vender curso, à mãe que quer criar arte digital pra Etsy / Elo7, ao jovem profissional que quer monetizar conhecimento.
- Plataformas que conhecem: Canva, Instagram, YouTube, Hotmart, Kiwify, Elo7, 99Freelas, Etsy, Mercado Livre.
- Não querem teoria. Querem ver na tela, copiar o passo, aplicar hoje.
- Têm medo de tecnologia parecer "bicho de sete cabeças" — minha missão é tirar esse medo.

## Tom emocional padrão

Animado mas não eufórico. Confiante mas não arrogante. Próximo mas não íntimo.

Pensa num professor bom de cursinho que adora a matéria dele e quer que você entenda — não no influencer gritando "GENTE EU ENCONTREI O SEGREDO". Não no acadêmico distante.

Quando algo dá certo na tela, o tom é de "olha que legal" — surpresa genuína controlada, não explosão. Quando algo dá errado, o tom é "tava dando um errinho ali, mas não tem problema, a gente tenta novamente" — tranquilidade de quem já mexeu nisso muito.

A emoção dominante é curiosidade compartilhada: a sensação de "olha o que descobri / olha o que dá pra fazer agora, vem ver comigo". Não é hype. Não é venda. É descoberta com o público junto.

Teste de tom: "Eu falaria isso numa conversa de bar com um amigo?" Se a resposta for não, reescreve.
`;

/**
 * Neutral voice doc template (placeholder-only). Used when the user wants to start
 * fresh for a different person/brand. Kept for power users.
 */
export const VOICE_DOC_TEMPLATE = `# Quem eu sou em uma linha
[Sua identidade resumida. Quem é você, o que faz, pra quem.]

# Como eu falo
[3 a 5 frases curtas descrevendo seu jeito. Em vez de adjetivos vagos como "casual", descreva o comportamento. Ex: "começo direto sem cumprimentar", "uso pausas longas", "rio no meio de frases sérias".]

# Pronome e formalidade
- Pronome principal: [tu / você / vocês / nós]
- Quando fica mais informal: [descreva a situação]
- Quando fica mais formal: [descreva a situação]

# Aberturas que JÁ usei e funcionaram
[IMPORTANTE: cole aqui de 5 a 10 ABERTURAS reais de reels/vídeos seus que funcionaram bem. Verbatim, do jeito que você falou. NÃO invente. Se não tiver, deixe vazio até gravar mais conteúdo.]

# CTAs que JÁ usei e funcionaram
[Cole de 3 a 5 CTAs reais seus, verbatim. Como você termina seus vídeos.]

# Frases que eu repito (bordões reais)
[Cole frases que você fala muito. Olha gravações antigas suas e anota. Não adianta inventar — só o que você realmente fala.]

# Palavras que eu NUNCA uso
[Liste palavras que outros criadores usam mas você odeia ou não combinam contigo. Ex: termos genéricos, gírias que não são suas, palavrões, marketing speak.]

# Coisas que eu SEMPRE faço
[Padrões de comportamento. Ex: "começo com o problema antes da solução", "uso números específicos não 'muitos'", "termino com pergunta direta".]

# Coisas que eu NUNCA faço
[O oposto. Ex: "não cumprimento no início", "não uso emoji no áudio", "não vendo no meio do conteúdo".]

# Reels meus que representam minha voz
[OURO PURO PRO GEMINI. Cole transcrições COMPLETAS de 2-3 reels seus que você mais gosta. Verbatim. O modelo aprende seu ritmo, vocabulário e jeito de virar frase.]

## Reel 1 — [tópico]
[transcrição completa]

## Reel 2 — [tópico]
[transcrição completa]

## Reel 3 — [tópico]
[transcrição completa]

# Pra quem eu falo
[Sua audiência principal em 1-2 linhas. Quem assiste, idade aproximada, contexto.]

# Tom emocional padrão
- Energia: [baixa / média / alta]
- Calor: [frio / neutro / caloroso]
- Velocidade: [pausada / normal / acelerada]
`;

export type RewriteLevel = 'faithful' | 'translate' | 'adapt' | 'reimagine';

/** Output language for the rewritten script. BCP-47 keeps it future-proof. */
export type OutputLanguage = 'pt-BR' | 'pt-PT' | 'en-US' | 'es-ES' | 'es-419' | 'fr-FR' | 'it-IT' | 'de-DE' | 'source';

export const LANGUAGE_OPTIONS: { value: OutputLanguage; label: string; ttsName: string }[] = [
  { value: 'source', label: 'Igual ao vídeo original', ttsName: 'detected' },
  { value: 'pt-BR',  label: 'Português (Brasil)',      ttsName: 'Brazilian Portuguese' },
  { value: 'pt-PT',  label: 'Português (Portugal)',    ttsName: 'European Portuguese' },
  { value: 'en-US',  label: 'English (US)',            ttsName: 'American English' },
  { value: 'es-ES',  label: 'Español (España)',        ttsName: 'European Spanish' },
  { value: 'es-419', label: 'Español (Latam)',         ttsName: 'Latin American Spanish' },
  { value: 'fr-FR',  label: 'Français',                ttsName: 'French' },
  { value: 'it-IT',  label: 'Italiano',                ttsName: 'Italian' },
  { value: 'de-DE',  label: 'Deutsch',                 ttsName: 'German' },
];

export type LanguageSimplicity = 'default' | 'simple' | 'very-simple';

export const SIMPLICITY_LABELS: Record<LanguageSimplicity, { label: string; hint: string }> = {
  'default':     { label: 'Padrão',         hint: 'Sem regra extra de simplicidade.' },
  'simple':      { label: 'Simples',        hint: 'Palavras comuns, frases curtas, sem jargão técnico.' },
  'very-simple': { label: 'Muito simples',  hint: 'Como falar com um amigo no bar. Palavras curtas. Nada empolado.' },
};

export interface VoiceProfile {
  id: string;
  name: string;
  /** Output language for the rewritten script. 'source' = keep original. */
  outputLanguage: OutputLanguage;
  /** Default rewrite intensity for analyses run with this profile. */
  rewriteLevel: RewriteLevel;
  /** How simple the language should be. Independent from rewriteLevel. */
  simpleLanguage: LanguageSimplicity;
  /** Free-form Gemini instructions appended to every prompt that uses this profile. */
  extraInstructions: string;
  /** User's personal voice doc in Markdown. Optional. Capped at VOICE_DOC_MAX_CHARS. */
  voiceDoc: string;
  createdAt: number;
  updatedAt: number;
}

const uid = () => `vp_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;

export const REWRITE_LABELS: Record<RewriteLevel, { label: string; hint: string }> = {
  faithful:  { label: 'Fiel ao original',     hint: 'Idioma original, palavra por palavra (sem reescrita).' },
  translate: { label: 'Traduzido pro Brasil', hint: 'Português BR mantendo estrutura — adapta exemplos, gírias e referências culturais. (padrão)' },
  adapt:     { label: 'Adaptado pra sua voz', hint: 'PT-BR no seu tom; preserva o hook, CTA e beats do original.' },
  reimagine: { label: 'Reescrito do zero',    hint: 'Vídeo serve só como referência estrutural; roteiro novo cobrindo o mesmo tópico no seu estilo.' },
};

const buildDefaultProfile = (): VoiceProfile => ({
  id: uid(),
  name: 'Voz do Rob',
  outputLanguage: 'pt-BR',
  rewriteLevel: 'adapt',
  simpleLanguage: 'simple',
  extraInstructions: '',
  voiceDoc: VOZ_ROB_BOLIVER,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// ─── PERSISTENCE ────────────────────────────────────────────────────────

export const loadProfiles = (): VoiceProfile[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is Partial<VoiceProfile> => Boolean(p?.id && p?.name))
      .map(p => ({
        // Backfill fields added after this profile was created.
        outputLanguage: 'pt-BR',
        rewriteLevel: 'translate',
        simpleLanguage: 'default',
        extraInstructions: '',
        voiceDoc: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...p,
      } as VoiceProfile));
  } catch {
    return [];
  }
};

export const saveProfiles = (profiles: VoiceProfile[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
};

export const getActiveProfileId = (): string | null => localStorage.getItem(ACTIVE_KEY);

export const setActiveProfileId = (id: string | null): void => {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
};

/** Returns existing profiles or seeds a default one + activates it. */
export const ensureProfiles = (): { profiles: VoiceProfile[]; activeId: string } => {
  let profiles = loadProfiles();
  if (profiles.length === 0) {
    const seed = buildDefaultProfile();
    profiles = [seed];
    saveProfiles(profiles);
    setActiveProfileId(seed.id);
    return { profiles, activeId: seed.id };
  }
  let activeId = getActiveProfileId();
  if (!activeId || !profiles.find(p => p.id === activeId)) {
    activeId = profiles[0].id;
    setActiveProfileId(activeId);
  }
  return { profiles, activeId };
};

export const upsertProfile = (profile: VoiceProfile): VoiceProfile[] => {
  const profiles = loadProfiles();
  const idx = profiles.findIndex(p => p.id === profile.id);
  const stamped = { ...profile, updatedAt: Date.now() };
  if (idx >= 0) profiles[idx] = stamped;
  else profiles.push(stamped);
  saveProfiles(profiles);
  return profiles;
};

export const deleteProfile = (id: string): VoiceProfile[] => {
  const profiles = loadProfiles().filter(p => p.id !== id);
  saveProfiles(profiles);
  if (getActiveProfileId() === id) {
    setActiveProfileId(profiles[0]?.id ?? null);
  }
  return profiles;
};

export const createBlankProfile = (name = 'Novo perfil'): VoiceProfile => ({
  ...buildDefaultProfile(),
  id: uid(),
  name,
  rewriteLevel: 'translate',
});

// ─── PROMPT BUILDER ────────────────────────────────────────────────────

const buildRewriteInstruction = (level: RewriteLevel, langName: string, isSource: boolean): string => {
  const targetLine = isSource ? 'in the SAME LANGUAGE as the source video' : `in ${langName}`;
  switch (level) {
    case 'faithful':
      return `KEEP the original language word-for-word. Do NOT translate, do NOT adapt. Transcribe and segment only. (Output language flag is ignored at this level.)`;
    case 'translate':
      return `TRANSLATE every block ${targetLine}. Localise idioms, examples, prices, references, and cultural cues to the target audience. Preserve meaning, structure, hook, beats, and CTA. Do NOT plagiarise: rewrite phrasing naturally rather than literally — but stay faithful to the original message.`;
    case 'adapt':
      return `Write the script ${targetLine} in the user's voice (see VOICE PROFILE below). Preserve the original hook structure, beat order, and CTA intent. Use the user's preferred phrasing, sentence rhythm, and slang. Do NOT plagiarise.`;
    case 'reimagine':
      return `IGNORE the exact wording. Use the video only as STRUCTURAL reference (topic, format, hook style, CTA pattern). Write a brand-new script ${targetLine} in the user's voice (see VOICE PROFILE below) that covers the same topic and would work as an alternative version of this reel. Match approximate duration per beat.`;
  }
};

/**
 * Output is fed straight into Minimax speech-2.8-hd TTS. The model reads characters
 * literally — emojis, ALL CAPS, raw numbers, abbreviations, parentheses, weird
 * punctuation all degrade synthesis quality. These rules tell Gemini to write
 * lines that SOUND right when spoken, not lines that LOOK right on a page.
 */
const TTS_RULES = `
--- TTS DELIVERY RULES (hard requirements — output goes straight to Minimax speech-2.8-hd TTS) ---

PUNCTUATION IS REQUIRED. Every sentence MUST end with proper terminal punctuation: . ! or ?
Use commas inside sentences to create natural breathing pauses. Use question marks for questions. Use exclamation marks sparingly for genuine emphasis. NEVER write a block without punctuation. NEVER write a stream of words separated only by spaces. The TTS engine relies on punctuation to know where to breathe — text without punctuation comes out flat and rushed.

Examples of CORRECT punctuation:
  ✓ "Olha só, tem uma coisa que mudou tudo. Quer saber qual é?"
  ✓ "Hoje vou te mostrar três jeitos de fazer isso. O primeiro é o mais simples."

Examples of WRONG (DO NOT DO THIS):
  ✗ "Olha so tem uma coisa que mudou tudo quer saber qual e"
  ✗ "Hoje vou te mostrar tres jeitos de fazer isso o primeiro e o mais simples"

Other rules for "blocks[].text":
- Write for the EAR, not the eye. But always with full punctuation.
- Spell out numbers in words ("dois milhões" not "2.000.000", "cinquenta por cento" not "50%").
- Spell out symbols and currencies ("dólares" not "$", "arroba" not "@").
- Spell out abbreviations on first mention ("inteligência artificial" not "IA", unless the abbreviation is itself pronounced as a word).
- No emojis, no parentheses, no brackets, no hashtags, no URLs, no markdown formatting.
- KEEP all standard punctuation: periods, commas, question marks, exclamation marks, colons, semicolons, em-dashes.
- Avoid ellipses ("...") — Minimax over-extends pauses on them. Use a period instead.
- Capitalize the first letter of each sentence and proper nouns. Do not write in all-caps.
- The "transcript" field stays faithful to the original audio for reference — these rules apply ONLY to "blocks[].text".`.trim();

/**
 * Anti-pompous wordlist for pt-BR. These appear in formal writing but feel
 * stiff in conversational reels. The Gemini prompt forbids them at simplicity
 * levels 'simple' and 'very-simple'.
 */
const POMPOUS_PT_BR = [
  'outrossim', 'destarte', 'doravante', 'todavia', 'porém', 'contudo', 'entretanto',
  'primordial', 'imprescindível', 'fundamental', 'crucial', 'essencial', 'cerne',
  'paradigma', 'sinérgico', 'alavancar', 'robusto', 'escalar', 'mensurar',
  'otimização', 'metodologia', 'estratégico', 'holístico', 'plataforma',
  'stakeholder', 'mindset', 'leverage', 'insights', 'a priori', 'a posteriori',
];

const SIMPLICITY_INSTRUCTION: Record<LanguageSimplicity, string> = {
  'default': '',
  'simple': `
--- SIMPLE LANGUAGE RULE ---
Write "blocks[].text" using SIMPLE, COMMON words.
- Short sentences (max ~12 words each).
- No jargon. No corporate speak. No marketing buzzwords.
- Prefer everyday words over fancy synonyms ("usar" > "utilizar", "ajudar" > "auxiliar", "mostrar" > "demonstrar", "começar" > "iniciar").
- For pt-BR, the following words are FORBIDDEN unless absolutely unavoidable: ${POMPOUS_PT_BR.join(', ')}.
- If a sentence sounds like a textbook, rewrite it shorter.`.trim(),

  'very-simple': `
--- VERY SIMPLE LANGUAGE RULE ---
Write "blocks[].text" as if speaking to a friend over coffee. Plain spoken language.
- Short sentences (max ~10 words each).
- Use words a 12-year-old would understand.
- For pt-BR, the following words are FORBIDDEN: ${POMPOUS_PT_BR.join(', ')}.
- Also AVOID: long technical terms, English loanwords, abstract nouns, gerund chains.
- Concrete > abstract ("esse vídeo" > "este conteúdo audiovisual").
- If you can say it shorter, say it shorter.
- IMPORTANT: keep ALL punctuation. Periods, commas, question marks. Even short sentences need punctuation. Sentences end with . ! or ? — never with just a space or new line.`.trim(),
};

export const buildVoicePromptSection = (profile: VoiceProfile): string => {
  const langOpt = LANGUAGE_OPTIONS.find(l => l.value === profile.outputLanguage) ?? LANGUAGE_OPTIONS[0];
  const isSource = profile.outputLanguage === 'source';

  const lines: string[] = [];
  lines.push('--- OUTPUT LANGUAGE ---');
  lines.push(isSource
    ? 'Use the SAME language as the source video for "blocks[].text" and "brollSuggestions[].idea".'
    : `Use ${langOpt.ttsName} (${profile.outputLanguage}) for "blocks[].text" and "brollSuggestions[].idea".`);
  lines.push('');
  lines.push('--- REWRITE LEVEL ---');
  lines.push(buildRewriteInstruction(profile.rewriteLevel, langOpt.ttsName, isSource));
  lines.push('');
  lines.push(TTS_RULES);

  const simplicityInstr = SIMPLICITY_INSTRUCTION[profile.simpleLanguage];
  if (simplicityInstr) {
    lines.push('');
    lines.push(simplicityInstr);
  }

  const hasVoice = profile.voiceDoc.trim().length > 0 || profile.extraInstructions.trim().length > 0;
  if (hasVoice) {
    lines.push('');
    lines.push('--- VOICE PROFILE ---');
    lines.push(`Profile name: ${profile.name}`);

    if (profile.extraInstructions.trim()) {
      lines.push('');
      lines.push('Extra instructions from the user (highest priority — follow these even if they conflict with defaults, except hard JSON-schema and TTS rules):');
      lines.push(profile.extraInstructions.trim());
    }

    if (profile.voiceDoc.trim()) {
      lines.push('');
      lines.push(`HOW TO USE THE VOICE DOCUMENT BELOW — READ CAREFULLY:

The document teaches you VOCABULARY and TONE only. It is NOT a structural template. Specifically:

1. The document contains REAL examples (hooks, CTAs, sign-offs) the user has used in PAST videos. These are reference samples to learn the user's RHYTHM, WORD CHOICES, and SENTENCE PATTERNS — NOT phrases to copy verbatim into every script.

2. DO NOT auto-insert "self-introduction" blocks (like "eu sou o Rob, aqui falamos sobre canva..."). Self-introductions only appear when the source content explicitly calls for one (e.g. a long-form YouTube video with channel intro). For a 15-30s reel about a product, news, or insight, NO self-introduction unless the user explicitly asks for it in extra instructions.

3. DO NOT auto-insert sign-offs like "espero que você tenha gostado", "tchau tchau", "te vejo no próximo vídeo". These belong to long-form YouTube videos, NOT short reels. Short reels end with a single punchy CTA tied to the content (the example CTAs section shows several options — pick ONE that fits, or write a new one in the user's voice).

4. The "Palavras que NUNCA uso" (forbidden words) list is HARD. Words there must NEVER appear in output. This is non-negotiable. If the document says the user never uses "segredo", do NOT use "segredo". If it says no "INSANO" / "ABSURDO", do not use them.

5. Match the user's GRAMMAR PATTERNS: pronouns ("você" not "tu"), informality level, sentence shape (short, conversational, with "né?", "tá?", "olha só" sprinkled where natural — but only if the content beat actually wants that beat, not as filler).

6. Match the user's TONE: confident-not-arrogant, close-not-intimate, animated-not-euphoric. Read the "Tom emocional padrão" and "Coisas que SEMPRE/NUNCA faço" sections — those are the rules.

7. Match the user's HOOK STYLE (opens with concrete thing on screen, or with a question that paints a situation — never with "olá pessoal hoje vou..."). Apply this pattern to the FIRST block.

Voice document follows below:`);
      lines.push('');
      lines.push(profile.voiceDoc.trim());
      lines.push('');
      lines.push('--- END OF VOICE DOCUMENT ---');
      lines.push('Reminder: use the document for vocabulary and tone, NOT as a script template. Do not paste self-intros or long sign-offs unless the source content needs them.');
    }
  }
  return lines.join('\n');
};
