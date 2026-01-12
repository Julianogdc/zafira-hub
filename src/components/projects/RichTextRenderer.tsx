import React, { useEffect, useRef } from 'react';
import { asanaService } from "@/lib/asana-service";

export const RichTextRenderer = ({ text, html, className }: { text: string, html?: string, className?: string }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Find all images that need hydration
        const images = containerRef.current.querySelectorAll('img[data-asana-gid]');

        images.forEach(async (img) => {
            const htmlImg = img as HTMLImageElement;
            const gid = htmlImg.getAttribute('data-asana-gid');

            // If exists and not fully hydrated
            if (gid && htmlImg.getAttribute('data-hydrated') !== 'true') {
                try {
                    htmlImg.setAttribute('data-hydrated', 'processing');

                    // Fetch fresh URL from Asana
                    const newUrl = await asanaService.getAttachmentUrl(gid);

                    if (newUrl) {
                        htmlImg.src = newUrl;
                        htmlImg.classList.remove('animate-pulse', 'bg-slate-800/50', 'min-h-[150px]');
                        htmlImg.style.minHeight = 'auto'; // Reset min-height once loaded
                        htmlImg.setAttribute('data-hydrated', 'true');
                    } else {
                        htmlImg.style.display = 'none';
                    }
                } catch (e) {
                    console.error("Failed to hydrate image", gid);
                    htmlImg.style.display = 'none';
                }
            }
        });
    }, [html, text]);

    // Helper to process HTML string
    const processHtml = (rawHtml: string) => {
        if (!rawHtml) return "";

        // Unescape HTML entities
        const txt = document.createElement("textarea");
        txt.innerHTML = rawHtml;
        const unescapedHtml = txt.value;

        // Clean body tags
        let cleanHtml = unescapedHtml.replace(/<\/?body[^>]*>/g, '').trim();

        // CLIENT-SIDE IMAGE PREVIEW REINFORCED:
        // Look for <a href="...#gid=123">filename.png</a> OR <a href="...">filename.png</a>
        // And inject an img tag with visible placeholder

        // Regex 1: Matches links with #gid param (our new format)
        const gidLinkRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*#gid=([^"]*))"[^>]*>([^<]*?)<\/a>/gi;

        cleanHtml = cleanHtml.replace(gidLinkRegex, (match, fullUrl, gid, textVal) => {
            if (textVal.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i) || fullUrl.match(/\.(png|jpg|jpeg|gif|webp|svg)/i)) {
                return `${match}<br/><img src="" data-asana-gid="${gid}" alt="${textVal}" class="rounded-lg mt-2 max-w-full shadow-md border border-white/10 min-h-[150px] w-full bg-slate-800/50 animate-pulse object-contain transition-all" />`;
            }
            return match;
        });

        // Regex 2: Fallback for standard image links (if #gid is stripped or legacy)
        // Matches <a href="...image.png">...</a>
        const imgLinkFallbackRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*\.(?:png|jpg|jpeg|gif|webp|svg))"[^>]*>([^<]*?)<\/a>/gi;

        cleanHtml = cleanHtml.replace(imgLinkFallbackRegex, (match, url, textVal) => {
            // Avoid double replacement if already handled by above regex (it won't match if replaced, but just in case)
            if (match.includes('<img')) return match;

            return `${match}<br/><img src="${url}" alt="${textVal}" class="rounded-lg mt-2 max-w-full shadow-md border border-white/10" />`;
        });

        return cleanHtml;
    };

    if (html) {
        return (
            <div
                ref={containerRef}
                className={`prose prose-sm prose-invert max-w-none text-slate-300 break-words overflow-hidden whitespace-pre-wrap ${className} [&>strong]:text-white [&>em]:text-slate-200 [&>a]:text-blue-400 [&>a]:no-underline hover:[&>a]:underline [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>img]:max-w-full [&>img]:rounded-lg [&>img]:mt-2`}
                dangerouslySetInnerHTML={{ __html: processHtml(html) }}
            />
        );
    }

    // Fallback logic
    if (text && (text.includes('<body>') || text.includes('</body>') || text.includes('<a href'))) {
        return (
            <div
                ref={containerRef}
                className={`prose prose-sm prose-invert max-w-none text-slate-300 break-words overflow-hidden whitespace-pre-wrap ${className} [&>strong]:text-white [&>em]:text-slate-200 [&>a]:text-blue-400 [&>a]:no-underline hover:[&>a]:underline [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>img]:max-w-full [&>img]:rounded-lg [&>img]:mt-2`}
                dangerouslySetInnerHTML={{ __html: processHtml(text) }}
            />
        );
    }

    if (!text) return null;

    // Plain text fallback
    const regex = /(https?:\/\/[^\s]+)|(@[\w\u00C0-\u00FF]+(?: [\w\u00C0-\u00FF]+)?)|(\*\*.+?\*\*)|(__(.+?)__)|(\*(.+?)\*)|(_(.+?)_)/g;

    return (
        <div className={`whitespace-pre-wrap break-words ${className}`}>
            {text.split(regex).map((part, i) => {
                if (!part) return null;
                if (part.match(/^https?:\/\//)) {
                    return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer" onClick={(e) => e.stopPropagation()}>{part}</a>;
                }
                if (part.startsWith('@')) {
                    // Remove highlight as requested by user
                    return <span key={i}>{part}</span>;
                }
                if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
                    return <strong key={i} className="text-white font-bold">{part.slice(2, -2)}</strong>;
                }
                if ((part.startsWith('*') && part.endsWith('*') && part.length > 2) || (part.startsWith('_') && part.endsWith('_') && part.length > 2)) {
                    return <em key={i} className="text-slate-200 italic">{part.slice(1, -1)}</em>;
                }
                return <span key={i}>{part}</span>;
            })}
        </div>
    );
};
