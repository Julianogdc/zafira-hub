import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit2, ExternalLink, FileText, Mail, Phone, Calendar, ArrowRight } from 'lucide-react';
import {
  HubClient,
  statusLabels,
  statusColors,
} from '@/services/clients';
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

interface ClientListProps {
  clients: HubClient[];
  onEdit: (client: HubClient) => void;
}

export function ClientList({ clients, onEdit }: ClientListProps) {
  const navigate = useNavigate();

  const formatCurrency = (value?: number | string | null) => {
    if (value === undefined || value === null) return 'R$ 0,00';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(num);
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('pt-BR');
    } catch {
      return '-';
    }
  };

  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-zinc-500 bg-zinc-950/30 border border-white/5 rounded-xl border-dashed">
        <FileText className="w-12 h-12 mb-3 opacity-20 text-zinc-400" />
        <p className="text-zinc-300 font-medium">Nenhum cliente encontrado</p>
        <p className="text-xs text-zinc-500 mt-1">Cadastre um novo cliente ou tente outros filtros de busca.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-zinc-950/40 backdrop-blur-sm">
      <Table>
        <TableHeader className="bg-zinc-900/60">
          <TableRow className="border-white/10 hover:bg-transparent">
            <TableHead className="text-zinc-400 font-medium">Cliente</TableHead>
            <TableHead className="text-zinc-400 font-medium">Status</TableHead>
            <TableHead className="text-zinc-400 font-medium">Contato</TableHead>
            <TableHead className="text-zinc-400 font-medium">Início</TableHead>
            <TableHead className="text-zinc-400 font-medium">Valor do Contrato</TableHead>
            <TableHead className="text-right text-zinc-400 font-medium">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => {
            const badgeStyle = statusColors[client.status] || statusColors.ACTIVE;

            return (
              <TableRow
                key={client.id}
                className="border-white/5 hover:bg-zinc-900/40 cursor-pointer transition-colors group"
                onClick={() => navigate(`/clientes/${client.id}`)}
              >
                {/* Nome do Cliente */}
                <TableCell className="font-medium text-zinc-200 py-3.5">
                  <div>
                    <div className="font-semibold text-white group-hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                      {client.name}
                      <ArrowRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-emerald-400" />
                    </div>
                    {client.legalName && (
                      <div className="text-xs text-zinc-500 truncate max-w-xs">{client.legalName}</div>
                    )}
                  </div>
                </TableCell>

                {/* Status */}
                <TableCell className="py-3.5">
                  <Badge
                    variant="outline"
                    className={`${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border} px-2.5 py-0.5 text-xs font-semibold`}
                  >
                    {statusLabels[client.status] || client.status}
                  </Badge>
                </TableCell>

                {/* Contato */}
                <TableCell className="py-3.5 text-xs text-zinc-400">
                  <div className="space-y-0.5">
                    {client.email ? (
                      <div className="flex items-center gap-1.5 text-zinc-300">
                        <Mail className="w-3 h-3 text-zinc-500" />
                        <span className="truncate max-w-[180px]">{client.email}</span>
                      </div>
                    ) : (
                      <span className="text-zinc-600">-</span>
                    )}
                    {client.phone && (
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <Phone className="w-3 h-3 text-zinc-500" />
                        <span>{client.phone}</span>
                      </div>
                    )}
                  </div>
                </TableCell>

                {/* Início */}
                <TableCell className="py-3.5 text-xs text-zinc-400">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 text-zinc-500" />
                    <span>{formatDate(client.startDate || client.createdAt)}</span>
                  </div>
                </TableCell>

                {/* Valor do Contrato */}
                <TableCell className="py-3.5 text-zinc-200 font-medium">
                  {formatCurrency(client.contractValue)}
                </TableCell>

                {/* Ações */}
                <TableCell className="py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2.5 text-xs text-zinc-400 hover:text-white hover:bg-white/10 gap-1.5"
                      onClick={() => navigate(`/clientes/${client.id}`)}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Cliente 360
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-white/10"
                      onClick={() => onEdit(client)}
                      title="Editar cliente"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}