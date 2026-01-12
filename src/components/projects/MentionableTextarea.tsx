import { useState, useRef, ChangeEvent, KeyboardEvent } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Bold, Italic, List, Eye, EyeOff } from "lucide-react";
import { AsanaUser } from "@/types/asana";
import { RichTextRenderer } from "./RichTextRenderer";

interface MentionableTextareaProps {
    value: string;
    onChange: (e: ChangeEvent<HTMLTextAreaElement> | { target: { value: string } }) => void;
    placeholder?: string;
    className?: string;
    users: AsanaUser[];
    autoFocus?: boolean;
    onBlur?: () => void;
    onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    showToolbar?: boolean;
}

export const MentionableTextarea = ({
    value, onChange, placeholder, className, users, autoFocus, onBlur, onKeyDown, showToolbar = false
}: MentionableTextareaProps) => {
    const [showMentions, setShowMentions] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [atIndex, setAtIndex] = useState<number | null>(null);
    const [previewMode, setPreviewMode] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        const pos = e.target.selectionStart;
        onChange(e);

        const lastAt = val.lastIndexOf('@', pos - 1);
        if (lastAt !== -1) {
            const isStartOrSpace = lastAt === 0 || val[lastAt - 1] === ' ' || val[lastAt - 1] === '\n';
            if (isStartOrSpace) {
                const query = val.substring(lastAt + 1, pos);
                if (!query.includes(' ')) {
                    setAtIndex(lastAt);
                    setMentionQuery(query);
                    setShowMentions(true);
                    return;
                }
            }
        }
        setShowMentions(false);
        setAtIndex(null);
        e.target.style.height = 'inherit';
        e.target.style.height = `${e.target.scrollHeight}px`;
    };

    const insertMention = (userName: string) => {
        if (atIndex === null) return;
        const before = value.substring(0, atIndex);
        const after = value.substring(atIndex + 1 + mentionQuery.length);
        // Insere o @Nome
        const newValue = `${before}@${userName} ${after}`;
        onChange({ target: { value: newValue } });
        setShowMentions(false);
        setAtIndex(null);
        setTimeout(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
                const newCursorPos = atIndex + 1 + userName.length + 1; // +1 do @
                textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
            }
        }, 50);
    };

    const insertFormat = (tag: string, closeTag?: string) => {
        if (!textareaRef.current) return;
        const start = textareaRef.current.selectionStart;
        const end = textareaRef.current.selectionEnd;
        const text = textareaRef.current.value;

        const before = text.substring(0, start);
        const selected = text.substring(start, end);
        const after = text.substring(end);

        const cTag = closeTag || tag.replace('<', '</');

        const newVal = `${before}${tag}${selected}${cTag}${after}`;
        onChange({ target: { value: newVal } });

        setTimeout(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
                // If text was selected, keep selection around it? no, just put cursor after
                const newPos = start + tag.length + selected.length + cTag.length;
                textareaRef.current.setSelectionRange(newPos, newPos);
            }
        }, 10);
    };

    const filteredUsers = users.filter(u => u.name.toLowerCase().includes(mentionQuery.toLowerCase()));

    return (
        <div className="relative w-full flex flex-col group">
            {showToolbar && (
                <div className="flex items-center gap-0.5 p-1 border-b border-white/5 bg-white/5 justify-between">
                    <div className="flex items-center gap-0.5">
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-white hover:bg-white/10" onMouseDown={(e) => { e.preventDefault(); insertFormat('**', '**'); }} title="Negrito"><Bold className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-white hover:bg-white/10" onMouseDown={(e) => { e.preventDefault(); insertFormat('_', '_'); }} title="Itálico"><Italic className="w-3 h-3" /></Button>
                        <div className="w-px h-3 bg-white/10 mx-1" />
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-white hover:bg-white/10" onMouseDown={(e) => { e.preventDefault(); insertFormat('\n- ', ''); }} title="Lista"><List className="w-3 h-3" /></Button>
                    </div>
                    <Button variant="ghost" size="icon" className={`h-6 w-6 hover:bg-white/10 ${previewMode ? 'text-purple-400 bg-purple-500/10' : 'text-slate-400 hover:text-white'}`} onClick={() => setPreviewMode(!previewMode)} title={previewMode ? "Editar" : "Pré-visualizar"}>
                        {previewMode ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </Button>
                </div>
            )}

            {previewMode ? (
                <div className={`w-full overflow-y-auto ${className} p-3 text-sm text-slate-300`}>
                    <RichTextRenderer text={value} />
                </div>
            ) : (
                <Textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => {
                        onChange(e);
                        handleInput(e);
                    }}
                    onKeyDown={(e) => {
                        if (onKeyDown) onKeyDown(e);
                    }}
                    onBlur={onBlur}
                    placeholder={placeholder}
                    className={`${className} min-h-[100px]`}
                    autoFocus={autoFocus}
                />
            )}
            {!previewMode && showMentions && filteredUsers.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#1e1e2e] border border-white/10 rounded-lg shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
                    <div className="p-2 text-[10px] text-slate-500 uppercase font-bold bg-white/5 border-b border-white/5">Sugestões</div>
                    <ScrollArea className="max-h-[200px]">
                        {filteredUsers.map(u => (
                            <div key={u.gid} className="px-3 py-2.5 hover:bg-purple-600 hover:text-white cursor-pointer text-xs text-slate-200 flex items-center gap-2 transition-colors" onMouseDown={(e) => { e.preventDefault(); insertMention(u.name); }}>
                                <Avatar className="h-6 w-6 ring-1 ring-white/10"><AvatarImage src={u.photo?.image_60x60 || undefined} /><AvatarFallback>U</AvatarFallback></Avatar> <span className="font-medium">{u.name}</span>
                            </div>
                        ))}
                    </ScrollArea>
                </div>
            )}
        </div>
    );
};
