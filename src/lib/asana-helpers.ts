import { AsanaTask, AsanaUser } from "@/types/asana";
import { fromAsanaDate, formatDateLocal } from "@/lib/date-utils";

export const getColorClass = (c: string) => {
    const m: Record<string, string> = {
        'dark-pink': 'bg-pink-500/20 text-pink-300 border-pink-500/30',
        'dark-green': 'bg-green-500/20 text-green-300 border-green-500/30',
        'dark-blue': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
        'dark-red': 'bg-red-500/20 text-red-300 border-red-500/30',
        'dark-teal': 'bg-teal-500/20 text-teal-300 border-teal-500/30',
        'dark-brown': 'bg-amber-700/20 text-amber-500 border-amber-700/30',
        'dark-purple': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    };
    return m[c] || 'bg-slate-500/20 text-slate-300 border-slate-500/30';
};

export const formatTaskDate = (t: AsanaTask | null) => {
    if (!t) return null;
    if (t.due_at) return formatDateLocal(fromAsanaDate(t.due_at), "dd/MM HH:mm");
    if (t.due_on) return formatDateLocal(fromAsanaDate(t.due_on), "dd/MM");
    return null;
};

export const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const convertToAsanaHtml = (text: string, users: AsanaUser[]) => {
    if (!text) return "";

    let htmlText = text;

    // Se parece HTML (vem do Tiptap)
    if (htmlText.includes('<p') || htmlText.includes('<ul') || htmlText.includes('<h') || htmlText.includes('<strong') || htmlText.includes('<em')) {

        // FASE 1: Pré-processamento com Regex para garantir a conversão de BLOCOS em QUEBRAS
        // Isso evita malabarismos com DOM Nodes

        // P: </p> -> <br/> (quebra após parágrafo)
        // Substituir novos parágrafos por quebra dupla visual ou simples?
        // Simples: </p> -> <br/>
        htmlText = htmlText.replace(/<\/p>/gi, "<br/>");
        htmlText = htmlText.replace(/<p[^>]*>/gi, ""); // Remove abertura de P

        // Divs também, se houver
        htmlText = htmlText.replace(/<\/div>/gi, "<br/>");
        htmlText = htmlText.replace(/<div[^>]*>/gi, "");

        // Brs existentes: garantir formato
        htmlText = htmlText.replace(/<br\s*\/?>/gi, "<br/>");

        // CLEANUP: spaces explicitly BEFORE parsing
        // Replace &nbsp; and \u00A0 with normal space to avoid XML issues
        htmlText = htmlText.replace(/&nbsp;/g, " ").replace(/\u00A0/g, " ");

        // FASE 2: Parsing para Limpeza (Sanitization)
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<body>${htmlText}</body>`, 'text/html');

        const allowedTags = new Set([
            'a', 'b', 'blockquote', 'code', 'del', 'em', 'i', 'ins', 'li', 'ol', 'pre', 's', 'strike', 'strong', 'sub', 'sup', 'u', 'ul', 'br'
        ]);

        const allElements = doc.body.querySelectorAll('*');

        allElements.forEach(el => {
            const tagName = el.tagName.toLowerCase();

            if (!allowedTags.has(tagName)) {
                // Unwrap genérico e remove (pois já tratamos P e DIV antes)
                const parent = el.parentNode;
                while (el.firstChild) {
                    parent?.insertBefore(el.firstChild, el);
                }
                parent?.removeChild(el);
                return;
            }

            // STRIP ATTRIBUTES
            const attrsToRemove = [];
            for (let i = 0; i < el.attributes.length; i++) {
                const attrName = el.attributes[i].name;
                if (tagName === 'a' && (attrName === 'href' || attrName === 'data-asana-gid' || attrName === 'title')) {
                    continue;
                }
                attrsToRemove.push(attrName);
            }
            attrsToRemove.forEach(attr => el.removeAttribute(attr));
        });

        const serializer = new XMLSerializer();
        let xmlString = "";

        // Iterar manualmente para garantir
        const children = Array.from(doc.body.childNodes);
        children.forEach(node => {
            xmlString += serializer.serializeToString(node);
        });

        // FASE 3: Normalização Final
        // Garantir que BRs sejam <br/> (XHTML)
        xmlString = xmlString.replace(/<br\s*\/?>/gi, "<br/>");

        // Limpeza namespaces e chars estranhos finais
        xmlString = xmlString
            .replace(/ xmlns=".*?"/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/\u00A0/g, " ");

        return `<body>${xmlString}</body>`;
    }

    // --- Legacy Fallback ---
    const mentionRegex = /@([\w\u00C0-\u00FF]+(?: [\w\u00C0-\u00FF]+)?)/g;
    htmlText = htmlText.replace(mentionRegex, (match, name) => {
        const user = users.find(u => u.name.toLowerCase() === name.toLowerCase());
        if (user) {
            return `<a href="https://app.asana.com/0/${user.gid}/list" data-asana-gid="${user.gid}">@${user.name}</a>`;
        }
        return match;
    });

    htmlText = htmlText
        .replace(/\n/g, "<br/>")
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    return `<body>${htmlText}</body>`;
};

export const asanaHtmlToMarkdown = (html: string | undefined): string => {
    if (!html) return "";

    let text = html;
    text = text.replace(/<body[^>]*>/g, '').replace(/<\/body>/g, '');
    text = text.replace(/<a[^>]*>(.*?)<\/a>/g, '$1');
    text = text.replace(/<ul>/g, '').replace(/<\/ul>/g, '');
    text = text.replace(/<li>(.*?)<\/li>/g, '\n- $1');
    text = text.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
    text = text.replace(/<b>(.*?)<\/b>/g, '**$1**');
    text = text.replace(/<em>(.*?)<\/em>/g, '_$1_');
    text = text.replace(/<i>(.*?)<\/i>/g, '_$1_');
    text = text.replace(/<br\s*\/?>/g, '\n');
    text = text.replace(/<p[^>]*>/g, '\n').replace(/<\/p>/g, '\n');
    text = text.replace(/\n\n+/g, '\n\n').trim();

    return text;
};
