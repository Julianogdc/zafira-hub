import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Target, Trophy, Lightbulb, TrendingUp, Sparkles, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const salesContent = [
    {
        type: 'quote',
        text: "Não encontre clientes para seus produtos, encontre produtos para seus clientes.",
        author: "Seth Godin",
        category: "Clássico"
    },
    {
        type: 'quote',
        text: "Toda venda tem cinco obstáculos: falta de necessidade, falta de dinheiro, falta de pressa, falta de desejo e falta de confiança.",
        author: "Zig Ziglar",
        category: "Objeções"
    },
    {
        type: 'tip',
        title: "Técnica de Fechamento: A Escolha Alternativa",
        text: "Ao invés de perguntar 'Você quer comprar?', pergunte 'Você prefere a opção A ou B?'. Isso assume a venda e foca na preferência.",
        category: "Fechamento"
    },
    {
        type: 'tip',
        title: "Gatilho: Escassez",
        text: "Aumente o valor percebido limitando a disponibilidade. 'Temos apenas 2 vagas nesta condição especial' funciona melhor que 'Temos vagas à vontade'.",
        category: "Gatilhos Mentais"
    },
    {
        type: 'quote',
        text: "Preço é o que você paga. Valor é o que você leva.",
        author: "Warren Buffett",
        category: "Valor"
    },
    {
        type: 'tip',
        title: "Dica: Escuta Ativa",
        text: "Fale 20% do tempo e ouça 80%. As dores do cliente estão nas entrelinhas do que ele diz.",
        category: "Rapport"
    },
    {
        type: 'quote',
        text: "Se você não cuidar do seu cliente, o seu concorrente irá.",
        author: "Bob Hooey",
        category: "Atendimento"
    },
    {
        type: 'tip',
        title: "Objeção: Está Caro",
        text: "Quando o cliente diz 'está caro', ele geralmente quer dizer 'eu não vi valor suficiente ainda'. Isole a objeção: 'Tirando o preço, existe mais algo que te impede?'",
        category: "Objeções"
    },
    {
        type: 'quote',
        text: "Vender é construir uma ponte entre o problema do cliente e a sua solução.",
        author: "Zig Ziglar",
        category: "Vendas"
    },
    {
        type: 'tip',
        title: "Gatilho: Prova Social",
        text: "Mencione casos de sucesso semelhantes ao do lead: 'A Empresa X tinha esse problema e resolvemos assim...'. Isso remove o risco da decisão.",
        category: "Gatilhos Mentais"
    },
    {
        type: 'quote',
        text: "As pessoas não compram o que você faz; elas compram o porquê você faz.",
        author: "Simon Sinek",
        category: "Propósito"
    },
    {
        type: 'tip',
        title: "Follow-up",
        text: "Nunca termine uma conversa sem definir o próximo passo e quem é o responsável. 'Vou te ligar na terça às 14h, ok?' é melhor que 'A gente se fala'.",
        category: "Processo"
    },
    {
        type: 'quote',
        text: "Ninguém gosta de ser vendido, mas todo mundo gosta de comprar.",
        author: "Earl Weaver",
        category: "Psicologia"
    },
    {
        type: 'tip',
        title: "Silêncio Estratégico",
        text: "Após apresentar o preço ou fazer o pedido de fechamento, CALAR-SE. O primeiro que falar, perde (ou concede).",
        category: "Negociação"
    },
    {
        type: 'quote',
        text: "A venda começa quando o cliente diz não.",
        author: "Elmer Wheeler",
        category: "Persistência"
    },
    {
        type: 'tip',
        title: "Espelhamento",
        text: "Sutilmente imite o tom de voz e ritmo do cliente. Se ele fala devagar, fale devagar. Isso cria conexão subconsciente (Rapport).",
        category: "Rapport"
    },
    {
        type: 'tip',
        title: "Reciprocidade",
        text: "Entregue valor antes de pedir. Um ebook, uma dica, uma análise gratuita. O cliente se sentirá inclinado a retribuir ouvindo sua proposta.",
        category: "Gatilhos Mentais"
    },
    {
        type: 'quote',
        text: "Para obter o que você quer, ajude os outros a obterem o que eles querem.",
        author: "Zig Ziglar",
        category: "Filosofia"
    },
    {
        type: 'tip',
        title: "Autoridade",
        text: "Demonstre conhecimento no nicho do cliente. Fale a língua dele e use termos técnicos específicos do setor dele.",
        category: "Posicionamento"
    },
    {
        type: 'tip',
        title: "Ancoragem de Preço",
        text: "Comece apresentando a opção mais cara (Premium) para depois mostrar a Standard. A Standard parecerá barata em comparação.",
        category: "Gatilhos Mentais"
    }
];

export function SalesMotivationWidget() {
    const [currentIndex, setCurrentIndex] = useState(0);

    // Random start
    useEffect(() => {
        setCurrentIndex(Math.floor(Math.random() * salesContent.length));
    }, []);

    const nextContent = () => {
        setCurrentIndex((prev) => (prev + 1) % salesContent.length);
    };

    const currentItem = salesContent[currentIndex];
    const isQuote = currentItem.type === 'quote';

    return (
        <Card className="border-none bg-gradient-to-r from-indigo-900/50 to-purple-900/50 backdrop-blur-xl relative overflow-hidden group">
            {/* Background Decorations */}
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                <Trophy className="w-32 h-32 text-indigo-400" />
            </div>

            <CardContent className="p-6 relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">

                <div className="flex-1 space-y-4">
                    <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold border ${isQuote ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'}`}>
                            {currentItem.category}
                        </span>
                        {isQuote ? <Sparkles className="w-4 h-4 text-amber-400" /> : <Lightbulb className="w-4 h-4 text-emerald-400" />}
                    </div>

                    <AnimatePresence mode='wait'>
                        <motion.div
                            key={currentIndex}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            transition={{ duration: 0.3 }}
                            className="space-y-2"
                        >
                            {isQuote ? (
                                <>
                                    <blockquote className="text-xl md:text-2xl font-medium text-white italic leading-relaxed">
                                        "{currentItem.text}"
                                    </blockquote>
                                    <footer className="text-sm text-indigo-200 font-medium">
                                        — {currentItem.author}
                                    </footer>
                                </>
                            ) : (
                                <>
                                    <h3 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
                                        <TrendingUp className="w-5 h-5 text-emerald-400" />
                                        {currentItem.title}
                                    </h3>
                                    <p className="text-base text-zinc-300 leading-relaxed">
                                        {currentItem.text}
                                    </p>
                                </>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>

                <div className="shrink-0 flex flex-col gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={nextContent}
                        className="rounded-full h-12 w-12 border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20"
                        title="Próxima Dica"
                    >
                        <RefreshCcw className="w-5 h-5 text-indigo-300" />
                    </Button>
                </div>
            </CardContent>

            {/* Progress Bar Indicator maybe? Naah simple is better */}
        </Card>
    );
}
