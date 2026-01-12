import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Save, Box, Terminal, Layers, Link as LinkIcon, Activity, PenLine } from "lucide-react";

import { useToolsStore } from "@/store/useToolsStore";
import { Tool } from "@/types/tools"; // Importe o tipo Tool
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  name: z.string().min(2, "Nome muito curto"),
  description: z.string().min(5, "Descrição muito curta"),
  type: z.enum(["component", "iframe", "webhook", "link_external"]),
  source: z.string().min(1, "A origem/URL é obrigatória"),
  category: z.enum(["operacional", "comercial", "marketing", "ia", "outros"]),
  status: z.enum(["active", "development", "inactive"]),
  version: z.string().optional(),
  visibility: z.enum(["admin", "all", "member"]).optional(),
});

interface ToolRegistrationDialogProps {
  toolToEdit?: Tool | null; // Prop opcional para edição
  open?: boolean;           // Controle externo de abertura
  onOpenChange?: (open: boolean) => void;
}

export function ToolRegistrationDialog({ toolToEdit, open: externalOpen, onOpenChange }: ToolRegistrationDialogProps) {
  // Controle interno se não for controlado externamente
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;

  const { addTool, editTool } = useToolsStore();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      type: "link_external",
      source: "",
      category: "operacional",
      status: "development",
      version: "1.0",
      visibility: "all",
    },
  });

  // Efeito para preencher o formulário quando estiver editando
  useEffect(() => {
    if (toolToEdit) {
      form.reset({
        name: toolToEdit.name,
        description: toolToEdit.description,
        type: toolToEdit.type,
        source: toolToEdit.source,
        category: toolToEdit.category,
        status: toolToEdit.status,
        version: toolToEdit.version || "1.0",
        visibility: toolToEdit.visibility || "all",
      });
    } else {
      form.reset({
        name: "",
        description: "",
        type: "link_external",
        source: "",
        category: "operacional",
        status: "development",
        version: "1.0",
        visibility: "all",
      });
    }
  }, [toolToEdit, isOpen, form]);

  function onSubmit(values: z.infer<typeof formSchema>) {
    // Criamos um objeto explícito para garantir ao TypeScript que os dados existem
    const toolData = {
      name: values.name,
      description: values.description,
      type: values.type,
      source: values.source,
      category: values.category,
      status: values.status,
      version: values.version || "1.0",
      visibility: values.visibility || "all",
    };

    if (toolToEdit) {
      // MODO EDIÇÃO
      editTool(toolToEdit.id, toolData);
      toast({ title: "Ferramenta atualizada!", description: "As alterações foram salvas." });
    } else {
      // MODO CRIAÇÃO
      addTool(toolData);
      toast({ title: "Ferramenta cadastrada!", description: "Adicionada ao catálogo." });
    }

    setOpen(false);
    // Só reseta o form se for criação nova (para não limpar enquanto edita)
    if (!toolToEdit) form.reset();
  }

  const inputStyle = "bg-white/5 border-white/10 text-white placeholder:text-zinc-600 focus-visible:ring-purple-500/50 focus-visible:border-purple-500/50";
  const labelStyle = "text-xs uppercase tracking-wider text-zinc-400 font-semibold";

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {/* Só mostra o Trigger se não estiver sendo controlado externamente (Modo Botão Novo) */}
      {externalOpen === undefined && (
        <DialogTrigger asChild>
          <Button className="bg-white/5 hover:bg-purple-500 hover:text-white border border-white/10 text-zinc-300 gap-2 transition-all shadow-sm">
            <Plus className="w-4 h-4" />
            Nova Ferramenta
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-[650px] bg-zinc-950/95 backdrop-blur-xl border-white/10 text-zinc-100 shadow-2xl shadow-purple-900/20">
        <DialogHeader className="pb-4 border-b border-white/5">
          <DialogTitle className="flex items-center gap-2 text-xl font-light">
            {toolToEdit ? <PenLine className="w-5 h-5 text-purple-400" /> : <Box className="w-5 h-5 text-purple-400" />}
            {toolToEdit ? "Editar Ferramenta" : "Cadastrar Ferramenta"}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            {toolToEdit ? "Altere as configurações ou status da ferramenta." : "Configure uma nova utilidade para o Zafira Hub."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4">

            {/* SEÇÃO 1: IDENTIDADE */}
            <div className="space-y-4">
              <div className="grid grid-cols-12 gap-4">
                <div className="col-span-8">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={labelStyle}>Nome</FormLabel>
                        <FormControl><Input {...field} className={inputStyle} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="col-span-4">
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={labelStyle}>Categoria</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                          <FormControl><SelectTrigger className={inputStyle}><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200">
                            <SelectItem value="operacional">Operacional</SelectItem>
                            <SelectItem value="comercial">Comercial</SelectItem>
                            <SelectItem value="marketing">Marketing</SelectItem>
                            <SelectItem value="ia">IA / Automação</SelectItem>
                            <SelectItem value="outros">Outros</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={labelStyle}>Descrição</FormLabel>
                    <FormControl><Textarea className={`${inputStyle} resize-none min-h-[60px]`} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator className="bg-white/10" />

            {/* SEÇÃO 2: TÉCNICO */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Terminal className="w-4 h-4 text-purple-400" />
                <h4 className="text-sm font-medium text-white">Configuração Técnica</h4>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelStyle}>Tipo</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                        <FormControl><SelectTrigger className={inputStyle}><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200">
                          <SelectItem value="link_external"><div className="flex items-center gap-2"><LinkIcon className="w-3 h-3" /> Link Externo</div></SelectItem>
                          <SelectItem value="iframe"><div className="flex items-center gap-2"><Layers className="w-3 h-3" /> Iframe</div></SelectItem>
                          <SelectItem value="webhook"><div className="flex items-center gap-2"><Activity className="w-3 h-3" /> Webhook</div></SelectItem>
                          <SelectItem value="component"><div className="flex items-center gap-2"><Terminal className="w-3 h-3" /> Componente</div></SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelStyle}>Status</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                        <FormControl><SelectTrigger className={inputStyle}><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200">
                          <SelectItem value="active" className="text-emerald-400">Ativa</SelectItem>
                          <SelectItem value="development" className="text-amber-400">Em Desenvolvimento</SelectItem>
                          <SelectItem value="inactive" className="text-zinc-500">Inativa</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />


                <FormField
                  control={form.control}
                  name="visibility"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelStyle}>Visibilidade</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                        <FormControl><SelectTrigger className={inputStyle}><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200">
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="admin">Apenas Admins</SelectItem>
                          <SelectItem value="member">Membros + Admins</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="source"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={labelStyle}>Source / URL</FormLabel>
                    <FormControl><Input {...field} className={`${inputStyle} font-mono text-xs`} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="hover:bg-white/5 hover:text-white">Cancelar</Button>
              <Button type="submit" className="bg-purple-600 hover:bg-purple-700 text-white min-w-[120px]">
                <Save className="w-4 h-4 mr-2" />
                {toolToEdit ? "Atualizar" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}