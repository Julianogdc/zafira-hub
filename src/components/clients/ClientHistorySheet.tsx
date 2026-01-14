import React from 'react';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription
} from '@/components/ui/sheet';
import {
    FileText,
    Calendar,
    DollarSign,
    CheckCircle2,
    Clock,
    AlertCircle
} from 'lucide-react';
import { Client } from '../../types/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

interface ClientHistorySheetProps {
    client: Client | null;
    isOpen: boolean;
    onClose: () => void;
}

export function ClientHistorySheet({ client, isOpen, onClose }: ClientHistorySheetProps) {
    if (!client) return null;

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(value);
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        // Handle YYYY-MM-DD or ISO
        return new Date(dateStr).toLocaleDateString('pt-BR');
    };

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent className="w-[400px] sm:w-[540px] bg-zinc-950 border-l border-white/10 text-white overflow-y-auto">
                <SheetHeader className="mb-6">
                    <SheetTitle className="text-2xl font-bold text-white flex items-center gap-2">
                        {client.name}
                        <Badge variant={client.status === 'active' ? 'default' : 'destructive'}
                            className={client.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : ''}>
                            {client.status === 'active' ? 'Ativo' : 'Inativo'}
                        </Badge>
                    </SheetTitle>
                    <SheetDescription className="text-zinc-400">
                        Histórico completo do cliente e documentos.
                    </SheetDescription>
                </SheetHeader>

                <div className="space-y-6">
                    {/* Resumo Financeiro */}
                    <section className="space-y-3">
                        <h3 className="text-sm font-medium text-white flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-emerald-500" />
                            Dados do Contrato
                        </h3>
                        <div className="grid grid-cols-2 gap-4 bg-zinc-900/50 p-4 rounded-lg border border-white/5">
                            <div>
                                <p className="text-xs text-zinc-500">Valor Mensal</p>
                                <p className="text-lg font-bold text-white">{formatCurrency(client.contractValue)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-zinc-500">Dia de Pagamento</p>
                                <p className="text-lg font-bold text-white">Dia {client.paymentDay || '-'}</p>
                            </div>
                            <div>
                                <p className="text-xs text-zinc-500">Início</p>
                                <p className="text-sm text-zinc-300">{formatDate(client.contractStart)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-zinc-500">Fim</p>
                                <p className="text-sm text-zinc-300">{formatDate(client.contractEnd)}</p>
                            </div>
                        </div>
                    </section>

                    <Separator className="bg-white/10" />

                    {/* Contratos e Arquivos */}
                    <section className="space-y-3">
                        <h3 className="text-sm font-medium text-white flex items-center gap-2">
                            <FileText className="w-4 h-4 text-blue-500" />
                            Contratos & Arquivos ({client.contracts?.length || 0})
                        </h3>
                        <ScrollArea className="h-[150px] w-full rounded-md border border-white/10 bg-zinc-900/30 p-4">
                            {client.contracts && client.contracts.length > 0 ? (
                                <div className="space-y-3">
                                    {client.contracts.map((contract) => (
                                        <div key={contract.id} className="flex items-center justify-between group">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded bg-zinc-800 text-zinc-400 group-hover:bg-blue-500/10 group-hover:text-blue-500 transition-colors">
                                                    <FileText className="w-4 h-4" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium text-zinc-200">{contract.fileName}</p>
                                                    <p className="text-xs text-zinc-500">{new Date(contract.uploadDate).toLocaleDateString('pt-BR')}</p>
                                                </div>
                                            </div>
                                            <a
                                                href={contract.fileData}
                                                download={contract.fileName}
                                                className="text-xs text-zinc-400 hover:text-white underline decoration-zinc-600 underline-offset-4"
                                            >
                                                Baixar
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-zinc-500 text-center py-8">Nenhum contrato anexado.</p>
                            )}
                        </ScrollArea>
                    </section>

                    <Separator className="bg-white/10" />

                    {/* Histórico de Pagamentos */}
                    <section className="space-y-3 pb-6">
                        <h3 className="text-sm font-medium text-white flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-purple-500" />
                            Histórico de Pagamentos
                        </h3>
                        <div className="relative border-l border-white/10 ml-2 space-y-6 pl-6 pt-2">
                            {client.paymentHistory && client.paymentHistory.length > 0 ? (
                                client.paymentHistory.map((payment, index) => (
                                    <div key={index} className="relative">
                                        <span className={`absolute -left-[29px] top-1 h-3 w-3 rounded-full border-2 border-zinc-950 ${payment.status === 'paid' ? 'bg-emerald-500' : 'bg-amber-500'
                                            }`} />
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-zinc-200 capitalize">
                                                {payment.month}
                                            </span>
                                            <div className="flex items-center gap-2 mt-1">
                                                {payment.status === 'paid' ? (
                                                    <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/5 text-[10px] h-5">
                                                        <CheckCircle2 className="w-3 h-3 mr-1" />
                                                        Pago
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-amber-500 border-amber-500/20 bg-amber-500/5 text-[10px] h-5">
                                                        <Clock className="w-3 h-3 mr-1" />
                                                        Pendente
                                                    </Badge>
                                                )}
                                                {payment.paidAt && (
                                                    <span className="text-xs text-zinc-500">em {new Date(payment.paidAt).toLocaleDateString()}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-zinc-500 italic">Nenhum registro de pagamento.</p>
                            )}
                        </div>
                    </section>
                </div>
            </SheetContent>
        </Sheet>
    );
}
