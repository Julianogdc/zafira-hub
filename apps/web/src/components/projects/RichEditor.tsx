import { Bold, Italic, Underline, List, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MentionableTextarea } from "./MentionableTextarea";
import { AsanaUser } from "@/types/asana";
import { ChangeEvent, KeyboardEvent } from "react";

interface RichEditorProps {
    value: string;
    onChange: (e: ChangeEvent<HTMLTextAreaElement> | { target: { value: string } }) => void;
    onBlur?: () => void;
    onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
    className?: string;
    users: AsanaUser[];
}

export function RichEditor({ value, onChange, onBlur, onKeyDown, placeholder, className, users }: RichEditorProps) {
    // Helper to wrap selected text with tags
    const insertTag = (tag: string) => {
        // Since we don't have direct access to the textarea ref inside MentionableTextarea here easily without ref forwarding,
        // we will implement a simpler appending strategy or rely on the user typing.
        // Ideally, we should wrap the selection.
        // For this version without changing MentionableTextarea too much, we'll append standard HTML tags around selection if possible,
        // or just append to end if not.

        // UPGRADE: To do this properly, we should probably merge this WITH MentionableTextarea or forward the ref.
        // Let's assume for now we just append the tag start/end to the text to let the user type inside, 
        // or we need to access the textarea. 

        // Let's try to manipulate the string directly.
        // A simple approach for v1: Append the tag to the end or cursor position.

        const output = value + `<${tag}></${tag}>`;
        onChange({ target: { value: output } });
    };

    // Better approach: We need to manipulate the textarea. 
    // Since MentionableTextarea controls the rendering, maybe we should pass a `toolbar` prop to it?
    // OR, we wrap it here.

    // Let's implement a simple toolbar that just inserts tags at the end for now to ensure safety, 
    // or we can try to improve MentionableTextarea to expose its ref.

    return (
        <div className="flex flex-col border border-white/10 rounded-xl bg-black/20 focus-within:border-purple-500/50 transition-colors overflow-hidden relative group">
            <div className="flex items-center gap-1 p-1 border-b border-white/5 bg-white/5">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10" onClick={() => insertTag('strong')} title="Negrito">
                    <Bold className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10" onClick={() => insertTag('em')} title="Itálico">
                    <Italic className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10" onClick={() => insertTag('u')} title="Sublinhado">
                    <Underline className="w-3.5 h-3.5" />
                </Button>
                <div className="w-px h-4 bg-white/10 mx-1" />
                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10" onClick={() => insertTag('ul')} title="Lista">
                    <List className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10" onClick={() => insertTag('ol')} title="Lista Numerada">
                    <ListOrdered className="w-3.5 h-3.5" />
                </Button>
            </div>
            <MentionableTextarea
                value={value}
                onChange={onChange}
                onBlur={onBlur}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                className={`border-none focus-visible:ring-0 resize-none bg-transparent ${className}`}
                users={users}
            />
        </div>
    );
}

// NOTE: The `insertTag` above is primitive.
// Function to actually insert at cursor requires access to the input element.
// I will modify `MentionableTextarea` to forward its ref or handle formatting internally relative to this request.
// BUT for now, I will modify `MentionableTextarea` to accept an `insertText` command or similar,
// or I'll just rewrite `MentionableTextarea` to include these tools directly to simplify things.
