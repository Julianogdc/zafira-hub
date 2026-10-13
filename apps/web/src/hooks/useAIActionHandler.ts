
import { useMemoryStore } from '@/store/useMemoryStore';
import { useGoalsStore } from '@/store/useGoalsStore';
import { useFinanceStore } from '@/store/useFinanceStore';
import { useClientStore } from '@/store/useClientStore';
import { toast } from 'sonner';

export const useAIActionHandler = () => {

    // Função principal que recebe a resposta RAW da IA e decide o que fazer
    const handleAIAction = (responseContent: string) => {
        try {
            // Tenta achar um JSON no meio do texto (caso a IA fale algo antes)
            // Regex procura por { "tool": ... }
            const jsonMatch = responseContent.match(/\{[\s\S]*"tool"[\s\S]*\}/);

            if (!jsonMatch) return null; // Não é uma ação, é só texto

            const actionData = JSON.parse(jsonMatch[0]);

            if (!actionData.tool) return null;

            console.log("🤖 AI ACTION DETECTED:", actionData);

            switch (actionData.tool) {
                case 'save_memory':
                    return executeSaveMemory(actionData.params);
                case 'create_goal':
                    return executeCreateGoal(actionData.params);
                case 'register_transaction':
                    return executeTransaction(actionData.params);
                default:
                    console.warn("Tool not found:", actionData.tool);
                    return null;
            }

        } catch (e) {
            console.error("Failed to parse AI Action:", e);
            return null;
        }
    };

    // --- EXECUTORES ---

    const executeSaveMemory = (params: any) => {
        if (!params.content || !params.category) return "Erro: Parâmetros inválidos para Memória.";
        useMemoryStore.getState().addFact(params.content, params.category);
        toast.success("Memória Estratégica Salva!", { description: params.content });
        return `✅ AÇÃO EXECUTADA: Memória salva com sucesso ("${params.content}").`;
    };

    const executeCreateGoal = (params: any) => {
        // Precisamos adicionar um método direto no store, pois o atual lê do form.
        // Por enquanto, vamos simular ou forçar.
        // Ideal: Atualizar useGoalsStore para ter addGoalDirect(data)

        // PALEATIVO: Usar o setForm + addGoal sequencialmente (hacky mas funciona rápido)
        const store = useGoalsStore.getState();

        store.setForm({
            name: params.name || "Meta Sugerida pela IA",
            targetValue: Number(params.targetValue) || 0,
            category: params.category || 'financeiro',
            endDate: params.endDate ? new Date(params.endDate).getTime() : Date.now() + (30 * 24 * 60 * 60 * 1000), // +30 dias default
            type: 'monetary',
            active: true
        });

        store.addGoal(); // Salva o que está no form

        toast.success("Nova Meta Criada!", { description: `${params.name}` });
        return `✅ AÇÃO EXECUTADA: Meta "${params.name}" criada com sucesso.`;
    };

    const executeTransaction = (params: any) => {
        const store = useFinanceStore.getState();
        store.addTransaction({
            id: crypto.randomUUID(),
            title: params.title || "Transação via IA",
            amount: Number(params.amount) || 0,
            type: params.type || 'expense',
            category: params.category || 'Outros',
            date: new Date().toISOString()
        });
        toast.success("Transação Registrada!", { description: `${params.title} (R$ ${params.amount})` });
        return `✅ AÇÃO EXECUTADA: Finança "${params.title}" registrada.`;
    };

    return { handleAIAction };
};
