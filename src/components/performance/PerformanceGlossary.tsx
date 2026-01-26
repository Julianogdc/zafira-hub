import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, HelpCircle } from "lucide-react";

export const PerformanceGlossary = () => {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground hover:text-purple-400 hover:bg-purple-500/5 mt-auto border-t rounded-none py-6">
                    <BookOpen className="h-4 w-4" />
                    Biblioteca de Termos
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BookOpen className="h-5 w-5 text-purple-500" />
                        Biblioteca de Termos: Tráfego Pago
                    </DialogTitle>
                    <DialogDescription>
                        Guia rápido para entender as principais métricas e siglas do Meta Ads e Google Ads.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="meta" className="flex-1 flex flex-col min-h-0">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="meta">Meta Ads</TabsTrigger>
                        <TabsTrigger value="google">Google Ads</TabsTrigger>
                    </TabsList>

                    <div className="flex-1 min-h-0 mt-4 overflow-y-auto pr-2" style={{ maxHeight: '50vh' }}>
                        <div className="space-y-6">
                            <TabsContent value="meta" className="mt-0 space-y-6">
                                <div className="space-y-4">
                                    <TermItem
                                        term="CTR (Taxa de Cliques)"
                                        definition="Click-Through Rate. É a porcentagem de pessoas que clicaram no seu anúncio após vê-lo. Ajuda a entender se o criativo é atraente."
                                    />
                                    <TermItem
                                        term="CPC (Custo por Clique)"
                                        definition="O valor médio que você paga por cada clique no link do seu anúncio."
                                    />
                                    <TermItem
                                        term="CPM (Custo por Mil Impressões)"
                                        definition="Quanto custa para exibir seu anúncio 1.000 vezes. É uma métrica de custo de leilão e inventário."
                                    />
                                    <TermItem
                                        term="Alcance"
                                        definition="O número de pessoas únicas que viram seu anúncio pelo menos uma vez."
                                    />
                                    <TermItem
                                        term="Impressões"
                                        definition="O número total de vezes que seu anúncio foi exibido na tela (pode incluir várias visualizações pela mesma pessoa)."
                                    />
                                    <TermItem
                                        term="Frequência"
                                        definition="O número médio de vezes que cada pessoa viu seu anúncio. Frequências muito altas podem indicar saturação."
                                    />
                                    <TermItem
                                        term="ROAS (Retorno sobre Gasto com Anúncios)"
                                        definition="Receita gerada dividida pelo valor investido. Indica a saúde financeira das campanhas de venda direta."
                                    />
                                    <TermItem
                                        term="Custo por Resultado"
                                        definition="O valor médio investido para obter a ação principal da campanha (ex: uma mensagem iniciada ou um lead)."
                                    />
                                </div>
                            </TabsContent>

                            <TabsContent value="google" className="mt-0 space-y-6">
                                <div className="space-y-4">
                                    <TermItem
                                        term="Índice de Qualidade"
                                        definition="Nota de 1 a 10 que o Google dá para seus anúncios baseada na relevância da palavra-chave, anúncio e página de destino."
                                    />
                                    <TermItem
                                        term="Parcela de Impressão"
                                        definition="As impressões que você recebeu divididas pelo número estimado de impressões que você estava qualificado para receber."
                                    />
                                    <TermItem
                                        term="Conversão"
                                        definition="Uma ação que é contabilizada quando alguém interage com seu anúncio e realiza uma ação valiosa definida por você (ex: compra, cadastro)."
                                    />
                                    <TermItem
                                        term="CPA (Custo por Aquisição)"
                                        definition="O valor médio que você paga para obter uma conversão. É focado na eficiência da venda/lead."
                                    />
                                    <TermItem
                                        term="Rede de Pesquisa"
                                        definition="Anúncios que aparecem nos resultados de busca do Google quando alguém pesquisa por termos específicos."
                                    />
                                    <TermItem
                                        term="Rede de Display"
                                        definition="Anúncios visuais que aparecem em sites parceiros, blogs e portais, focados em alcance e reconhecimento."
                                    />
                                    <TermItem
                                        term="Palavras-chave de Correspondência Exata"
                                        definition="O anúncio só aparece se a pesquisa do usuário for idêntica ou possuir o mesmo significado da sua palavra-chave."
                                    />
                                </div>
                            </TabsContent>
                        </div>
                    </div>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};

const TermItem = ({ term, definition }: { term: string; definition: string }) => (
    <div className="border-b pb-4 last:border-0">
        <h4 className="font-bold text-sm text-purple-400 mb-1 flex items-center gap-2">
            <HelpCircle className="h-3 w-3" />
            {term}
        </h4>
        <p className="text-sm text-muted-foreground leading-relaxed">
            {definition}
        </p>
    </div>
);
