import { useEffect, useState } from "react";
import { Quote, Sparkles } from "lucide-react";

const quotes = [
    { text: "A melhor maneira de prever o futuro é criá-lo.", author: "Peter Drucker" },
    { text: "Sucesso é a soma de pequenos esforços repetidos dia após dia.", author: "Robert Collier" },
    { text: "Não gerencie o tempo, gerencie sua energia.", author: "Autor Desconhecido" },
    { text: "O segredo do sucesso é a constância do propósito.", author: "Benjamin Disraeli" },
    { text: "A persistência é o caminho do êxito.", author: "Charles Chaplin" },
    { text: "Grandes resultados requerem grandes ambições.", author: "Heráclito" },
    { text: "Se você não pode medir, não pode gerenciar.", author: "Peter Drucker" },
    { text: "Qualidade significa fazer certo quando ninguém está olhando.", author: "Henry Ford" },
    { text: "A inovação distingue um líder de um seguidor.", author: "Steve Jobs" },
    { text: "O único lugar onde o sucesso vem antes do trabalho é no dicionário.", author: "Vidal Sassoon" },
    { text: "Liderança não é sobre ser o melhor. É sobre tornar todos os outros melhores.", author: "Sheryl Sandberg" },
    { text: "Comece onde você está. Use o que você tem. Faça o que você pode.", author: "Arthur Ashe" },
    { text: "A lógica leva você de A a B. A imaginação leva você a qualquer lugar.", author: "Albert Einstein" },
    { text: "Não tenha medo de desistir do bom para perseguir o ótimo.", author: "John D. Rockefeller" },
    { text: "Eu não falhei. Apenas descobri 10 mil maneiras que não funcionam.", author: "Thomas Edison" },
    { text: "O risco vem de não saber o que você está fazendo.", author: "Warren Buffett" },
    { text: "Seus clientes mais insatisfeitos são sua maior fonte de aprendizado.", author: "Bill Gates" },
    { text: "A disciplina é a ponte entre metas e realizações.", author: "Jim Rohn" },
    { text: "Não espere; o tempo nunca será 'perfeito'.", author: "Napoleon Hill" },
    { text: "Gênios são 1% inspiração e 99% transpiração.", author: "Thomas Edison" },
    { text: "Transportai um punhado de terra todos os dias e fareis uma montanha.", author: "Confúcio" },
    { text: "O homem que remove montanhas começa carregando pequenas pedras.", author: "Provérbio Chinês" },
    { text: "Aja como se o que você faz fizesse diferença. Faz.", author: "William James" }
];

export function MotivationalQuote() {
    const [quote, setQuote] = useState(quotes[0]);

    useEffect(() => {
        // Pick random quote on mount
        const randomIndex = Math.floor(Math.random() * quotes.length);
        setQuote(quotes[randomIndex]);
    }, []);

    return (
        <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-sm">
            {/* Animated Start Border Effect (Purple Shine) */}
            <div className="absolute inset-0 z-0 overflow-hidden rounded-xl">
                <div className="absolute -inset-[150%] animate-[spin_8s_linear_infinite] bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,#a855f7_50%,transparent_100%)] opacity-60 blur-md" />
            </div>

            {/* Inner Background (creates the "border" width by leaving 1px gap if we used padding, 
                but here we overlay the gradient. Let's use an inset container for content) 
            */}
            <div className="absolute inset-[1px] z-10 rounded-[11px] bg-zinc-950" />

            {/* Content */}
            <div className="relative z-20 flex h-full flex-col justify-between p-6">
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                    <Quote className="h-24 w-24 text-indigo-500" />
                </div>

                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2 text-indigo-400">
                        <Sparkles className="h-4 w-4 animate-pulse" />
                        <span className="text-xs font-semibold uppercase tracking-wider">Insight do Dia</span>
                    </div>

                    <blockquote className="text-lg font-medium text-white/90 italic leading-relaxed">
                        "{quote.text}"
                    </blockquote>
                </div>

                <cite className="mt-4 text-sm font-medium text-zinc-500 not-italic">
                    — {quote.author}
                </cite>
            </div>
        </div>
    );
}
