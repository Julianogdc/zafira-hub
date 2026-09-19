import { useState, useEffect, useCallback } from "react";
import { asanaService } from "@/lib/asana-service";
import { Button } from "@/components/ui/button";
import { Paperclip, Download, X, File as FileIcon, Loader2, Image as ImageIcon, Users } from "lucide-react";
import { toast } from "sonner";
import { useDropzone } from "react-dropzone";
import { AsanaUser, AsanaAttachment } from "@/types/asana";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card"

interface AttachmentListProps {
    taskGid: string;
    currentUser: AsanaUser | null;
}

export const AttachmentList = ({ taskGid, currentUser }: AttachmentListProps) => {
    const [attachments, setAttachments] = useState<AsanaAttachment[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        loadAttachments();
    }, [taskGid]);

    const loadAttachments = async () => {
        setLoading(true);
        try {
            const data = await asanaService.getAttachments(taskGid);
            setAttachments(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        if (acceptedFiles.length === 0) return;
        setUploading(true);
        let count = 0;
        for (const file of acceptedFiles) {
            try {
                await asanaService.uploadAttachment(taskGid, file);
                count++;
            } catch (err) {
                console.error(err);
                toast.error(`Erro ao enviar ${file.name}`);
            }
        }
        if (count > 0) {
            toast.success(`${count} arquivos enviados!`);
            loadAttachments();
        }
        setUploading(false);
    }, [taskGid]);

    const handleDownloadGroup = async (files: AsanaAttachment[]) => {
        if (files.length === 0) return;
        toast.info(`Baixando ${files.length} arquivos...`);

        // Forced download using Blob to prevent opening in new tab
        for (const [index, att] of files.entries()) { // Removed index check logic, just loop
            try {
                const url = att.download_url || att.permanent_url;
                const response = await fetch(url);
                const blob = await response.blob();
                const blobUrl = window.URL.createObjectURL(blob);

                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = att.name; // This should now hold respect
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(blobUrl);

                // Small delay just to be safe
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                console.error("Download failed forcedly, trying fallback", e);
                // Fallback to standard open
                const link = document.createElement('a');
                link.href = att.download_url || att.permanent_url;
                link.target = '_blank';
                link.download = att.name;
                link.click();
            }
        }
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

    // Chronological Grouping Logic
    // Groups contiguous uploads by the same user into blocks
    const groupedBlocks = attachments.reduce((blocks, att) => {
        const creatorName = att.created_by?.name || "Desconhecido";
        const creatorId = att.created_by?.gid || "unknown";

        const lastBlock = blocks[blocks.length - 1];

        if (lastBlock && lastBlock.creatorId === creatorId) {
            lastBlock.items.push(att);
        } else {
            blocks.push({
                creatorName,
                creatorId,
                items: [att]
            });
        }
        return blocks;
    }, [] as { creatorName: string; creatorId: string; items: AsanaAttachment[] }[]);

    if (loading && attachments.length === 0) return <div className="text-xs text-slate-500 flex gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Carregando anexos...</div>;

    return (
        <div className="space-y-6">
            <h3 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2"><Paperclip className="w-3.5 h-3.5" /> Anexos ({attachments.length})</h3>

            {groupedBlocks.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-2">Nenhum anexo.</div>
            ) : (
                groupedBlocks.map((block, idx) => (
                    <div key={`${block.creatorId}-${idx}`} className="space-y-2 relative pl-4 border-l-2 border-white/5 pb-2">
                        {/* Visual indicator on timeline */}
                        <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-slate-700 border-2 border-[#1e1e2e]"></div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Users className="w-3 h-3 text-slate-600" />
                                <span className={`text-[11px] font-semibold uppercase tracking-wider ${block.creatorId === currentUser?.gid ? 'text-purple-400' : 'text-slate-500'}`}>
                                    {block.creatorId === currentUser?.gid ? "Eu" : block.creatorName}
                                </span>
                                <span className="text-[10px] text-slate-600">({block.items.length} arquivos)</span>
                            </div>

                            <Button variant="ghost" size="sm" onClick={() => handleDownloadGroup(block.items)} className="h-5 text-[10px] px-2 text-slate-500 hover:text-white hover:bg-white/5">
                                <Download className="w-3 h-3 mr-1" /> Baixar
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-2">
                            {block.items.map(att => {
                                const isImage = att.name.match(/\.(jpg|jpeg|png|gif|webp)$/i) || att.resource_subtype === 'image';
                                const imageUrl = att.view_url || att.permanent_url;

                                return (
                                    <div key={att.gid} className="group relative flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/5 hover:border-purple-500/30 transition-all overflow-hidden">
                                        <div className="h-8 w-8 rounded-md bg-black/30 flex items-center justify-center shrink-0 overflow-hidden">
                                            {isImage ? (
                                                <img src={imageUrl} alt={att.name} className="h-full w-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                            ) : (
                                                <FileIcon className="w-4 h-4 text-slate-400" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <HoverCard>
                                                <HoverCardTrigger asChild>
                                                    <p className="text-xs text-slate-200 font-medium truncate cursor-help" title={att.name}>{att.name}</p>
                                                </HoverCardTrigger>
                                                {isImage && (
                                                    <HoverCardContent className="w-80 p-0 bg-transparent border-none shadow-2xl z-50" side="right" align="start">
                                                        <div className="rounded-lg overflow-hidden border border-white/10 bg-[#1e1e2e]">
                                                            <div className="bg-black/50 aspect-video flex items-center justify-center">
                                                                <img src={imageUrl} alt={att.name} className="max-w-full max-h-[300px] object-contain" />
                                                            </div>
                                                            <div className="bg-[#1e1e2e] p-2 text-xs text-center text-slate-300 border-t border-white/5">
                                                                {att.name}
                                                            </div>
                                                        </div>
                                                    </HoverCardContent>
                                                )}
                                            </HoverCard>
                                            <button onClick={() => handleDownloadGroup([att])} className="text-[10px] text-slate-500 hover:text-purple-400 flex items-center gap-1 mt-0.5"><Download className="w-3 h-3" /> Baixar</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))
            )}

            <div {...getRootProps()} className={`border border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${isDragActive ? 'border-purple-500 bg-purple-500/10' : 'border-white/10 hover:bg-white/5'}`}>
                <input {...getInputProps()} />
                {uploading ? (
                    <div className="flex items-center justify-center gap-2 text-xs text-purple-300">
                        <Loader2 className="w-4 h-4 animate-spin" /> Enviando...
                    </div>
                ) : (
                    <p className="text-xs text-slate-500">
                        {isDragActive ? "Solte os arquivos aqui..." : "Clique ou arraste arquivos para anexar"}
                    </p>
                )}
            </div>
        </div>
    );
};
