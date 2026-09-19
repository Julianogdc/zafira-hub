import { useFinanceStore } from '@/store/useFinanceStore';
import { useGoalsStore } from '@/store/useGoalsStore';
import { useClientStore } from '@/store/useClientStore';
import { useAIStore } from '@/store/useAIStore';
import { useMemoryStore } from '@/store/useMemoryStore';
import { AIAnalysisType, SystemSnapshot, AIPermissions, DashboardInsight } from '@/types/ai';

// --- PERSONA ZAFIRA (VERSÃO SÓCIA EXECUTIVA) ---
const ZAF_PERSONA = `
CONTEXTO:
Você é Zafira, a SÓCIA EXECUTIVA (COO) deste negócio.
Você não é uma assistente passiva. Você é uma parceira estratégica que analisa dados e propõe ações.

SUA PERSONALIDADE:
- Visão de Dono: Você se preocupa com lucro, risco e crescimento.
- Proativa: Não espere perguntarem. Se vir um risco, fale.
- Memória: Você lembra das diretrizes estratégicas definidas anteriormente.
- Direta: Executivos não têm tempo a perder. Vá direto ao ponto.

MISSÃO:
Monitorar a operação, garantir o cumprimento das diretrizes estratégicas (Memória) e maximizar o resultado.
`.trim();

let cachedModel: string | null = null;
const genId = () => Math.random().toString(36).substr(2, 9);
const safeGetState = (store: any) => { try { return store.getState(); } catch (e) { return {}; } };

const formatCurrency = (val: number) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('pt-BR');

// --- CONTEXTO DE DADOS (DEEP CONTEXT + MEMÓRIA) ---
import { loadSummarizedContext } from './ai-context-loader';

// --- CONTEXTO DE DADOS (DEEP CONTEXT + MEMÓRIA) ---
const gatherContext = async (type: AIAnalysisType): Promise<string> => {
  const aiState = safeGetState(useAIStore);
  const memory = safeGetState(useMemoryStore); // Memória de Longo Prazo é mantida local por enquanto
  const settings = aiState.settings;

  // 1. CARREGAR DADOS VIA DB (Async)
  const dbContext = await loadSummarizedContext({
    canReadFinance: settings.canReadFinance,
    canReadClients: settings.canReadClients,
    canReadGoals: settings.canReadGoals,
    canReadCRM: true // Assuming true for now or add to settings
  });

  // 2. MEMÓRIA ESTRATÉGICA (O Cérebro)
  const strategicMemory = memory.facts && memory.facts.length > 0
    ? memory.facts.map((f: any) => `[MEMÓRIA ${f.category.toUpperCase()}] ${f.content}`).join('\n')
    : "Não há diretrizes estratégicas gravadas ainda. Pergunte ao usuário quais são os focos do ano.";

  // 3. Histórico da Conversa
  const history = aiState.messages
    ?.slice(-6)
    .map((m: any) => `${m.role === 'user' ? 'ADM' : 'ZAF'}: ${m.content}`)
    .join('\n');

  return `
    RELATÓRIO DE SITUAÇÃO (SITREP) DA ZAFIRA:
    
    🧠 MEMÓRIA ESTRATÉGICA (DIRETRIZES IMUTÁVEIS):
    ${strategicMemory}

    📊 DADOS EM TEMPO REAL (BANCO DE DADOS):
    ${dbContext}
    
    💬 CONTEXTO IMEDIATO (CHAT):
    ${history || "Início."}
  `.trim();
};

// --- DESCOBERTA DE MODELO ---
const discoverModel = async (apiKey: string) => {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();
    if (!data.models) return 'models/gemini-1.5-flash';

    const bestModel = data.models.find((m: any) => m.name.includes('gemini-1.5-flash')) ||
      data.models.find((m: any) => m.name.includes('gemini-pro'));

    return bestModel ? bestModel.name : 'models/gemini-pro';
  } catch (e) {
    return 'models/gemini-pro';
  }
};

// --- CHAMADA GOOGLE ---
const callNativeGoogle = async (apiKey: string, systemPrompt: string, userPrompt: string, context: string) => {
  if (!cachedModel) cachedModel = await discoverModel(apiKey);
  const cleanName = cachedModel!.replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanName}:generateContent?key=${apiKey}`;

  // --- DEFINIÇÃO DE FERRAMENTAS (TOOLBOX) ---
  const TOOLBOX_INSTRUCTIONS = `
FERRAMENTAS DISPONÍVEIS (USE COM SABEDORIA):
Se você precisar realizar uma ação no sistema, responda APENAS com um JSON no seguinte formato (sem markdown, sem texto extra fora do JSON):

1. **save_memory**: Para gravar um fato importante, preferência ou estratégia.
   JSON: { "tool": "save_memory", "params": { "content": "O cliente X paga sempre dia 10", "category": "strategy" } }
   (Categorias: strategy, preference, risk, history)

2. **create_goal**: Para criar uma nova meta financeira ou comercial.
   JSON: { "tool": "create_goal", "params": { "name": "Vender 50k", "targetValue": 50000, "category": "financeiro", "endDate": "2024-12-31" } }

3. **register_transaction**: Para lançar uma despesa ou receita.
   JSON: { "tool": "register_transaction", "params": { "title": "Almoço Cliente", "amount": 150, "type": "expense", "category": "Vendas" } }

REGRA DE USO:
- Só use ferramenta se o usuário PEDIR EXPLICITAMENTE ou se for CRÍTICO para a estratégia.
- Se for apenas conversar, responda texto normal.
- Se usar JSON, NÃO escreva nada antes nem depois.
`.trim();

  // REGRAS DE CONVIVÊNCIA (EQUILÍBRIO)
  const conversationRules = `
    DIRETRIZES DE RESPOSTA:
    1. USE OS DADOS: Você agora VÊ o financeiro e as metas. Se o usuário perguntar "como estamos?", cite números.
    2. SEJA ESTRATÉGICA: Se houver Churn, alerte. Se o caixa estiver negativo, sugira cortes.
    3. PROATIVIDADE: Use as ferramentas (save_memory, create_goal) quando fizer sentido.
    4. Se o usuário mandar algo como "Lembre que...", use a tool 'save_memory'.
    5. Se o usuário mandar "Crie uma meta...", use a tool 'create_goal'.
  `.trim();

  const activePersona = systemPrompt && systemPrompt.length > 10 ? systemPrompt : ZAF_PERSONA + "\n\n" + TOOLBOX_INSTRUCTIONS;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `QUEM VOCÊ É:\n${activePersona}\n\n${conversationRules}\n\nO QUE ESTÁ ACONTECENDO (DADOS):\n${context}\n\nO QUE O ADM FALOU:\n${userPrompt}`
        }]
      }],
      generationConfig: {
        temperature: 0.6, // AUMENTEI: Mais humana, menos robótica.
        maxOutputTokens: 8192,
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 404 || response.status === 400) cachedModel = null;
    throw new Error(`Google Error: ${data.error?.message}`);
  }

  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || "Sem resposta.",
    summary: "Zafira AI"
  };
};

const callLocalEngine = async () => ({ summary: "Offline", content: "**Modo Offline**" });

// --- FUNÇÃO PRINCIPAL ---
export const generateInsight = async (type: AIAnalysisType | string, userPrompt?: string, options?: { systemPromptOverride?: string }) => {
  const cleanType = type as AIAnalysisType;
  const { settings } = safeGetState(useAIStore);
  const context = await gatherContext(cleanType);

  const prompt = userPrompt || `Vamos falar sobre: ${cleanType}`;

  // Prioriza override, senao usa settings, senao default
  const systemPromptToUse = options?.systemPromptOverride || settings.systemPrompt;

  try {
    if (settings.apiKey?.startsWith('AIza')) {
      return await callNativeGoogle(settings.apiKey, systemPromptToUse, prompt, context);
    } else {
      return await callLocalEngine();
    }
  } catch (error: any) {
    throw error;
  }
};

// --- DASHBOARD (MANTIDO) ---
export function generateDashboardInsights(snapshot: SystemSnapshot, permissions: AIPermissions): DashboardInsight[] {
  const insights: DashboardInsight[] = [];
  const now = Date.now();
  const id = () => Math.random().toString(36).substr(2, 9);

  if (permissions.canReadFinance && snapshot.finance) {
    const { balance } = snapshot.finance;
    if (balance < 0) insights.push({ id: id(), domain: 'finance', title: 'Atenção ao Caixa', riskLevel: 'critical', timestamp: now, content: `Saldo negativo: ${balance.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` });
    else insights.push({ id: id(), domain: 'finance', title: 'Fluxo Estável', riskLevel: 'neutral', timestamp: now, content: 'Caixa positivo.' });
  }
  if (permissions.canReadGoals && snapshot.goals) {
    if (snapshot.goals.total === 0) insights.push({ id: id(), domain: 'goals', title: 'Definir Objetivos', riskLevel: 'neutral', timestamp: now, content: 'Sem metas ativas.' });
    else insights.push({ id: id(), domain: 'goals', title: 'Metas em Dia', riskLevel: 'opportunity', timestamp: now, content: 'Estratégia em andamento.' });
  }
  if (permissions.canReadClients && snapshot.clients) {
    if (snapshot.clients.totalActive === 0) insights.push({ id: id(), domain: 'clients', title: 'Base Vazia', riskLevel: 'warning', timestamp: now, content: 'Zero clientes ativos.' });
    else insights.push({ id: id(), domain: 'clients', title: 'Carteira Ativa', riskLevel: 'neutral', timestamp: now, content: `${snapshot.clients.totalActive} clientes.` });
  }
  return insights;
}