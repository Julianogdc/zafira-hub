import React from 'react';
import { useGoalsStore } from '@/store/useGoalsStore'; // Ajuste o caminho
import { GoalCategory, GoalPeriod, FinancialBinding } from '@/types/goals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
// Importe outros componentes UI necessários (Label, Card, etc.)

export const GoalForm = () => {
  // 1. Conexão direta com a Store
  // Não usamos mais useState locais para os campos!
  const { form, setForm, addGoal, resetForm } = useGoalsStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // A mágica acontece aqui: 
    // Como 'form' já está validado e tipado no Store, basta passar ele.
    addGoal(); 
    
    // Opcional: Feedback visual ou fechar modal aqui
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      
      {/* CAMPO 1: NOME DA META (Antigo Title) */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Nome da Meta</label>
        <Input
          required
          placeholder="Ex: Aumentar Faturamento Q3"
          value={form.name} // ✅ Lê direto do Store
          onChange={(e) => setForm({ name: e.target.value })} // ✅ Atualiza Parcialmente
        />
      </div>

      {/* CAMPO 2: CATEGORIA (O Motivo de toda essa refatoração) */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Categoria</label>
        <Select
          value={form.category} // ✅ Nunca será undefined (graças ao INITIAL_STATE)
          onValueChange={(value) => setForm({ category: value as GoalCategory })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione a categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="financeiro">Financeiro</SelectItem>
            <SelectItem value="comercial">Comercial</SelectItem>
            <SelectItem value="marketing">Marketing</SelectItem>
            <SelectItem value="operacional">Operacional</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* CAMPO 3: VALOR ALVO (Exemplo de numérico) */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Valor Alvo</label>
        <Input
          type="number"
          value={form.targetValue}
          onChange={(e) => setForm({ targetValue: Number(e.target.value) })}
        />
      </div>

      {/* CAMPO 4: PERÍODO (Exemplo de Enum) */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Período</label>
        <Select
          value={form.period}
          onValueChange={(value) => setForm({ period: value as GoalPeriod })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="monthly">Mensal</SelectItem>
            <SelectItem value="yearly">Anual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* BOTÕES DE AÇÃO */}
      <div className="flex justify-end gap-2 pt-4">
        <Button 
          type="button" 
          variant="outline" 
          onClick={resetForm} // ✅ Limpa o form para o padrão seguro
        >
          Cancelar
        </Button>
        <Button type="submit">
          Salvar Meta
        </Button>
      </div>
    </form>
  );
};