import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { Button } from '@/components/ui/button';
import { Bold, Italic, Strikethrough, List, ListOrdered, Undo, Redo, Underline as UnderlineIcon, Heading1, Heading2, Code, Link as LinkIcon } from 'lucide-react';
import { useEffect } from 'react';

interface TiptapEditorProps {
    value: string;
    onChange: (html: string) => void;
    onBlur?: () => void;
    placeholder?: string;
    className?: string;
    editable?: boolean;
}

export const TiptapEditor = ({ value, onChange, onBlur, placeholder = "Escreva aqui...", className, editable = true }: TiptapEditorProps) => {
    const editor = useEditor({
        extensions: [
            StarterKit,
            Underline,
            Link.configure({
                openOnClick: false,
                HTMLAttributes: {
                    class: 'text-blue-400 underline cursor-pointer',
                },
            }),
            Placeholder.configure({
                placeholder,
            }),
        ],
        content: value,
        editable,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
        onBlur: ({ editor }) => {
            if (onBlur) {
                onBlur();
            }
        },
        editorProps: {
            attributes: {
                class: 'prose prose-sm prose-invert max-w-none focus:outline-none min-h-[150px] p-4 text-slate-300 leading-relaxed whitespace-pre-wrap [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-white [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_code]:bg-white/10 [&_code]:rounded [&_code]:p-1',
            },
        },
    });

    // Sync content if value changes externally (e.g. switching tasks)
    useEffect(() => {
        if (editor && value !== editor.getHTML()) {
            // Only set content if it's significantly different to avoid cursor jumps
            // Use commands to set content
            if (Math.abs(value.length - editor.getHTML().length) > 10 || value === "") {
                editor.commands.setContent(value);
            }
        }
    }, [value, editor]);

    const setLink = () => {
        if (!editor) return;
        const previousUrl = editor.getAttributes('link').href;
        const url = window.prompt('URL:', previousUrl);

        // cancelled
        if (url === null) {
            return;
        }

        // empty
        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
        }

        // update
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    };

    if (!editor) {
        return null;
    }

    return (
        <div className={`flex flex-col border border-white/10 rounded-xl bg-black/20 focus-within:border-purple-500/50 transition-colors overflow-hidden group ${className}`}>
            {editable && (
                <div className="flex items-center gap-1 p-1 border-b border-white/5 bg-white/5 flex-wrap">
                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${editor.isActive('bold') ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white hover:bg-white/10'}`} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrito (Cmd+B)">
                        <Bold className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${editor.isActive('italic') ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white hover:bg-white/10'}`} onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálico (Cmd+I)">
                        <Italic className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${editor.isActive('underline') ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white hover:bg-white/10'}`} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado (Cmd+U)">
                        <UnderlineIcon className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${editor.isActive('strike') ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white hover:bg-white/10'}`} onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado (Cmd+Shift+X)">
                        <Strikethrough className="w-3.5 h-3.5" />
                    </Button>

                    <div className="w-px h-4 bg-white/10 mx-1" />

                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${editor.isActive('heading', { level: 1 }) ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white hover:bg-white/10'}`} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Título 1">
                        <Heading1 className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${editor.isActive('heading', { level: 2 }) ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white hover:bg-white/10'}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Título 2">
                        <Heading2 className="w-3.5 h-3.5" />
                    </Button>

                    <div className="w-px h-4 bg-white/10 mx-1" />

                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${editor.isActive('bulletList') ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white hover:bg-white/10'}`} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista">
                        <List className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${editor.isActive('orderedList') ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white hover:bg-white/10'}`} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista Numerada">
                        <ListOrdered className="w-3.5 h-3.5" />
                    </Button>

                    <div className="w-px h-4 bg-white/10 mx-1" />

                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${editor.isActive('code') ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white hover:bg-white/10'}`} onClick={() => editor.chain().focus().toggleCode().run()} title="Código">
                        <Code className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${editor.isActive('link') ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white hover:bg-white/10'}`} onClick={setLink} title="Link">
                        <LinkIcon className="w-3.5 h-3.5" />
                    </Button>

                    <div className="w-px h-4 bg-white/10 mx-1" />

                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10" onClick={() => editor.chain().focus().undo().run()} title="Desfazer">
                        <Undo className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10" onClick={() => editor.chain().focus().redo().run()} title="Refazer">
                        <Redo className="w-3.5 h-3.5" />
                    </Button>
                </div>
            )}
            <EditorContent editor={editor} className="bg-transparent" />
        </div>
    );
};
