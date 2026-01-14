import { useState, useMemo } from 'react';
import { Edit2, Trash2, FileText, AlertCircle, AlertTriangle, CheckCircle2, DollarSign, ArrowUpDown, ArrowUp, ArrowDown, Calendar } from 'lucide-react';
import { Client } from '../../types/client';
import { useClientStore } from '../../store/useClientStore';
import { useFinanceStore } from '../../store/useFinanceStore';
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ClientListProps {
  clients: Client[];
  onEdit: (client: Client) => void;
  selectedMonth: number;
  selectedYear: number;
}

export function ClientList({ clients, onEdit, selectedMonth, selectedYear }: ClientListProps) {
  const { deleteClient, setPaymentStatus } = useClientStore();
  const { addTransaction } = useFinanceStore();

  const [clientToDelete, setClientToDelete] = useState<string | null>(null);

  // Sorting State
  const [sortConfig, setSortConfig] = useState<{
    key: 'name' | 'contractValue' | 'paymentDay' | null;
    direction: 'asc' | 'desc';
  }>({ key: 'name', direction: 'asc' });

  const sortedClients = useMemo(() => {
    const sortable = [...clients];
    if (sortConfig.key) {
      sortable.sort((a, b) => {
        let aValue = a[sortConfig.key!];
        let bValue = b[sortConfig.key!];

        // Handle PaymentDay nulls
        if (sortConfig.key === 'paymentDay') {
          aValue = aValue || 0;
          bValue = bValue || 0;
        }

        if (aValue === bValue) return 0;

        // String comparison
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortConfig.direction === 'asc'
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue);
        }

        // Number comparison
        // @ts-ignore
        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        // @ts-ignore
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortable;
  }, [clients, sortConfig]);

  const handleSort = (key: 'name' | 'contractValue' | 'paymentDay') => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const currentMonthKey = `${(selectedMonth + 1).toString().padStart(2, '0')}/${selectedYear}`;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
  };

  const getExpirationStatus = (dateString?: string) => {
    if (!dateString) return 'normal';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiration = new Date(dateString);
    expiration.setHours(0, 0, 0, 0);

    const diffTime = expiration.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'expired';
    if (diffDays <= 30) return 'warning';
    return 'normal';
  };

  const handlePaymentChange = (client: Client, value: string) => {
    const status = value as 'paid' | 'pending';
    setPaymentStatus(client.id, currentMonthKey, status);

    if (status === 'paid') {
      // 2. Add Transaction to Finance
      addTransaction({
        id: crypto.randomUUID(),
        type: 'income',
        title: `Pagamento: ${client.name}`,
        amount: client.contractValue,
        category: 'Pagamento Clientes',
        date: new Date().toISOString()
      });

      toast.success(`Pagamento registrado para ${client.name}`, {
        description: "Lançamento financeiro criado com sucesso."
      });
    }
  };

  // Abre o modal de confirmação (não deleta ainda)
  const handleDeleteRequest = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setClientToDelete(id);
  };

  // Executa a exclusão de fato
  const confirmDelete = () => {
    if (clientToDelete) {
      deleteClient(clientToDelete);
      setClientToDelete(null);
    }
  };

  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-zinc-500 bg-zinc-950/30 border border-white/5 rounded-xl border-dashed">
        <FileText className="w-12 h-12 mb-4 opacity-20" />
        <p>Nenhum cliente cadastrado.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <TooltipProvider>
          <Table>
            <TableHeader className="bg-zinc-900/50">
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead
                  className="text-zinc-400 cursor-pointer hover:text-white transition-colors group"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-2">
                    Cliente
                    {sortConfig.key === 'name' && (
                      sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-500" /> : <ArrowDown className="w-3 h-3 text-emerald-500" />
                    )}
                    {sortConfig.key !== 'name' && <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />}
                  </div>
                </TableHead>
                <TableHead
                  className="text-zinc-400 cursor-pointer hover:text-white transition-colors group"
                  onClick={() => handleSort('paymentDay')}
                >
                  <div className="flex items-center gap-2">
                    Dia Pgto
                    {sortConfig.key === 'paymentDay' && (
                      sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-500" /> : <ArrowDown className="w-3 h-3 text-emerald-500" />
                    )}
                    {sortConfig.key !== 'paymentDay' && <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />}
                  </div>
                </TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="text-zinc-400">Pagamento ({currentMonthKey})</TableHead>
                <TableHead className="text-zinc-400">Vencimento Contrato</TableHead>
                <TableHead
                  className="text-zinc-400 cursor-pointer hover:text-white transition-colors group"
                  onClick={() => handleSort('contractValue')}
                >
                  <div className="flex items-center gap-2">
                    Valor Mensal
                    {sortConfig.key === 'contractValue' && (
                      sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-500" /> : <ArrowDown className="w-3 h-3 text-emerald-500" />
                    )}
                    {sortConfig.key !== 'contractValue' && <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />}
                  </div>
                </TableHead>
                <TableHead className="text-zinc-400">Docs</TableHead>
                <TableHead className="text-right text-zinc-400">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedClients.map((client) => {
                const expirationStatus = getExpirationStatus(client.contractEnd);
                const isPaidThisMonth = client.paymentHistory?.some(p => p.month === currentMonthKey && p.status === 'paid');

                return (
                  <TableRow
                    key={client.id}
                    className="border-white/5 hover:bg-zinc-900/50 cursor-pointer transition-colors group"
                    onClick={() => onEdit(client)}
                  >
                    <TableCell className="font-medium text-zinc-200">
                      {client.name}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-1.5 text-zinc-300">
                        <Calendar className="w-3 h-3 text-zinc-500" />
                        {client.paymentDay ? `Dia ${client.paymentDay}` : '-'}
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`
                          ${client.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                            : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'}
                        `}
                      >
                        {client.status === 'active' ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>

                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {isPaidThisMonth ? (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30 gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Pago
                        </Badge>
                      ) : (
                        <Select onValueChange={(v) => handlePaymentChange(client, v)}>
                          <SelectTrigger className="h-7 w-[110px] bg-zinc-900 border-white/10 text-xs">
                            <SelectValue placeholder="Pendente" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending" className="text-yellow-500">Pendente</SelectItem>
                            <SelectItem value="paid" className="text-emerald-500 font-medium">Confirmar Pgto</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        {expirationStatus === 'expired' && (
                          <Tooltip>
                            <TooltipTrigger>
                              <AlertCircle className="w-4 h-4 text-red-500" />
                            </TooltipTrigger>
                            <TooltipContent><p>Contrato Vencido</p></TooltipContent>
                          </Tooltip>
                        )}

                        {expirationStatus === 'warning' && (
                          <Tooltip>
                            <TooltipTrigger>
                              <AlertCircle className="w-4 h-4 text-yellow-500" />
                            </TooltipTrigger>
                            <TooltipContent><p>Vence em menos de 30 dias</p></TooltipContent>
                          </Tooltip>
                        )}

                        <span className={`text-sm ${expirationStatus === 'expired' ? 'text-red-400 font-medium' :
                          expirationStatus === 'warning' ? 'text-yellow-400' :
                            'text-zinc-400'
                          }`}>
                          {formatDate(client.contractEnd)}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="text-zinc-300">
                      {formatCurrency(client.contractValue)}
                    </TableCell>

                    <TableCell className="text-zinc-500 text-xs">
                      {client.contracts.length > 0 ? (
                        <span className="flex items-center gap-1 group-hover:text-emerald-500 transition-colors">
                          <FileText className="w-3 h-3" /> {client.contracts.length}
                        </span>
                      ) : '-'}
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-white/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(client);
                          }}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-zinc-400 hover:text-red-400 hover:bg-red-950/30"
                          onClick={(e) => handleDeleteRequest(e, client.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TooltipProvider>
      </div>

      {/* Modal de Confirmação de Exclusão (Estilo Dark/Glass) */}
      <AlertDialog open={!!clientToDelete} onOpenChange={() => setClientToDelete(null)}>
        <AlertDialogContent className="bg-zinc-950 border border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="text-red-500 w-5 h-5" />
              Excluir Cliente?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              Esta ação é irreversível. O cliente, seus contratos e histórico serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-transparent border-white/10 text-white hover:bg-zinc-900 hover:text-white"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-900/50 text-red-200 border border-red-500/20 hover:bg-red-900 hover:text-white transition-colors"
            >
              Sim, Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}