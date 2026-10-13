import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2,
  Calendar,
  Users,
  MapPin,
  Clock,
  Briefcase,
  Layers,
  FileText,
  Activity,
  Phone,
  Mail,
  Palette,
  Edit2,
  Link as LinkIcon,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Badge,
  LoadingState,
  ErrorState,
  PermissionState,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/ds';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

import {
  clientsService,
  ClientDetail,
  ClientTimelineEvent,
  ApiClientStatus,
  statusLabels,
  UpdateClientDTO,
  ClientContact,
  ClientMeetingNote,
  CreateClientMeetingNoteRequest,
  ClientBriefing,
  ClientBrandKit,
} from '@/services/clients';
import { asanaIntegrationService, ClientAsanaProject } from '@/services/asana';

import styles from './Cliente360.module.css';

function getIntegrationStatusLabel(status: string) {
  switch (status) {
    case 'ACTIVE':
      return 'Ativa';
    case 'DISCONNECTED':
      return 'Desconectada';
    case 'ERROR':
      return 'Erro';
    default:
      return status;
  }
}
function hasBriefingContent(briefing?: ClientBriefing | null) {
  if (!briefing) return false;
  return !!(
    briefing.objective ||
    briefing.targetAudience ||
    briefing.positioning ||
    briefing.competitors ||
    briefing.toneOfVoice ||
    briefing.notes
  );
}

function hasBrandKitContent(brandKit?: ClientBrandKit | null) {
  if (!brandKit) return false;
  return !!(
    (brandKit.colors && brandKit.colors.length > 0) ||
    (brandKit.typography && brandKit.typography.length > 0) ||
    (brandKit.externalLinks && brandKit.externalLinks.length > 0) ||
    (brandKit.notes && brandKit.notes.trim().length > 0)
  );
}

function isValidWebProtocol(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

interface BrandKitColorFormItem {
  _localId: string;
  name: string;
  hex: string;
}

interface BrandKitTypographyFormItem {
  _localId: string;
  role: string;
  fontName: string;
}

interface BrandKitLinkFormItem {
  _localId: string;
  label: string;
  url: string;
  type?: string;
}

interface BrandKitFormState {
  colors: BrandKitColorFormItem[];
  typography: BrandKitTypographyFormItem[];
  externalLinks: BrandKitLinkFormItem[];
  notes: string;
}

let nextBrandKitLocalId = 1;
function generateBrandKitLocalId(prefix: string = 'bk'): string {
  return `${prefix}_${Date.now()}_${nextBrandKitLocalId++}_${Math.random().toString(36).substring(2, 7)}`;
}

const TABS = [
  { value: 'visao-geral', label: 'Visão Geral' },
  { value: 'empresa-marca', label: 'Empresa & Marca' },
  { value: 'operacao', label: 'Operação' },
  { value: 'contrato-financeiro', label: 'Contrato & Financeiro' },
  { value: 'relacionamento-memoria', label: 'Relacionamento & Memória' },
  { value: 'integracoes', label: 'Integrações' },
];

export default function Cliente360() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get('tab') || 'visao-geral';

  // O fallback para visao-geral se aba inválida
  useEffect(() => {
    if (!TABS.find((t) => t.value === activeTab)) {
      setSearchParams({ tab: 'visao-geral' }, { replace: true });
    }
  }, [activeTab, setSearchParams]);

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [timeline, setTimeline] = useState<ClientTimelineEvent[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);

  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState(false);

  const [asanaProjects, setAsanaProjects] = useState<ClientAsanaProject[]>([]);
  const [asanaProjectsLoading, setAsanaProjectsLoading] = useState(false);
  const [asanaProjectsError, setAsanaProjectsError] = useState<{ status?: number; message: string } | null>(null);

  const requestSequenceRef = useRef(0);

  const loadData = useCallback(async (clientId: string) => {
    const currentSequence = ++requestSequenceRef.current;
    
    setLoading(true);
    setError(null);
    setTimelineLoading(true);
    setTimelineError(false);
    setAsanaProjectsLoading(true);
    setAsanaProjectsError(null);

    try {
      const detail = await clientsService.getClientById(clientId);
      if (currentSequence !== requestSequenceRef.current) return;
      
      setClient(detail);
      setLoading(false);

      try {
        const events = await clientsService.getClientTimeline(clientId);
        if (currentSequence !== requestSequenceRef.current) return;
        setTimeline(events || []);
      } catch (tErr) {
        if (currentSequence !== requestSequenceRef.current) return;
        console.warn('Falha ao carregar timeline', tErr);
        setTimelineError(true);
      } finally {
        if (currentSequence === requestSequenceRef.current) {
          setTimelineLoading(false);
        }
      }

      try {
        const projects = await asanaIntegrationService.getClientProjects(clientId);
        if (currentSequence !== requestSequenceRef.current) return;
        setAsanaProjects(projects || []);
      } catch (pErr: any) {
        if (currentSequence !== requestSequenceRef.current) return;
        const pStatus = pErr?.status || pErr?.response?.status;
        console.warn('Falha ao carregar projetos Asana do cliente', pErr);
        setAsanaProjectsError({
          status: pStatus,
          message:
            pStatus === 403
              ? "Acesso restrito: você não possui a permissão 'projects.view' para visualizar os projetos deste cliente."
              : 'Não foi possível consultar os projetos do Asana vinculados a este cliente no momento.',
        });
      } finally {
        if (currentSequence === requestSequenceRef.current) {
          setAsanaProjectsLoading(false);
        }
      }
    } catch (err: any) {
      if (currentSequence !== requestSequenceRef.current) return;
      console.error('Falha ao carregar ClientDetail', err);
      setError({
        status: err?.status || err?.response?.status,
        message: err?.message || 'Falha ao carregar os dados do cliente.',
      });
      setLoading(false);
      setTimelineLoading(false);
      setAsanaProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id) {
      loadData(id);
    }
    
    setAsanaProjects([]);
    setAsanaProjectsLoading(false);
    setAsanaProjectsError(null);

    setContactModalOpen(false);
    setDeleteContactOpen(false);
    setEditOpen(false);
    setContactSaving(false);
    setDeletingContact(false);
    setContactToDelete(null);

    setMeetingModalOpen(false);
    setDeleteMeetingOpen(false);
    setMeetingSaving(false);
    setDeletingMeeting(false);
    setMeetingToDelete(null);

    setBriefingModalOpen(false);
    setBriefingSaving(false);
    setBriefingForm({
      objective: '',
      targetAudience: '',
      positioning: '',
      competitors: '',
      toneOfVoice: '',
      notes: '',
    });

    setBrandKitModalOpen(false);
    setBrandKitSaving(false);
    setBrandKitForm({
      colors: [],
      typography: [],
      externalLinks: [],
      notes: '',
    });

    return () => {
      requestSequenceRef.current++;
    };
  }, [id, loadData]);

  const handleTabChange = (val: string) => {
    setSearchParams({ tab: val });
  };

  // --- Modal Editar ---
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<UpdateClientDTO>>({});
  const [addressForm, setAddressForm] = useState<any>({});

  // --- Contatos ---
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactForm, setContactForm] = useState<Partial<ClientContact>>({
    id: '',
    name: '',
    role: '',
    email: '',
    phone: '',
    isPrimary: false,
    notes: '',
  });

  const [deleteContactOpen, setDeleteContactOpen] = useState(false);
  const [deletingContact, setDeletingContact] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<string | null>(null);

  const openContactModal = (contact?: ClientContact) => {
    if (contact) {
      setContactForm({
        id: contact.id,
        name: contact.name,
        role: contact.role || '',
        email: contact.email || '',
        phone: contact.phone || '',
        isPrimary: contact.isPrimary || false,
        notes: contact.notes || '',
      });
    } else {
      setContactForm({
        id: '',
        name: '',
        role: '',
        email: '',
        phone: '',
        isPrimary: false,
        notes: '',
      });
    }
    setContactModalOpen(true);
  };

  const handleSaveContact = async () => {
    if (!client) return;
    const currentClientId = client.id;
    const currentSequence = requestSequenceRef.current;

    const trimmedName = contactForm.name?.trim() || '';
    if (!trimmedName) {
      toast.error('O nome do contato é obrigatório.');
      return;
    }
    const trimmedEmail = contactForm.email?.trim() || '';
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error('O e-mail informado é inválido.');
      return;
    }

    setContactSaving(true);
    try {
      const payload = {
        name: trimmedName,
        role: contactForm.role?.trim() || null,
        email: trimmedEmail || null,
        phone: contactForm.phone?.trim() || null,
        isPrimary: contactForm.isPrimary,
        notes: contactForm.notes?.trim() || null,
      };

      if (contactForm.id) {
        await clientsService.updateClientContact(currentClientId, contactForm.id, payload);
        if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
          toast.success('Contato atualizado com sucesso.');
        }
      } else {
        await clientsService.createClientContact(currentClientId, payload);
        if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
          toast.success('Contato adicionado com sucesso.');
        }
      }
      
      if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
        setContactSaving(false);
        setContactModalOpen(false);
        loadData(currentClientId);
      }
    } catch (err: any) {
      if (currentSequence !== requestSequenceRef.current || client.id !== currentClientId) return;
      if (err?.response?.status === 403 || err?.status === 403) {
        toast.error('Você não tem permissão para gerenciar contatos.');
      } else {
        toast.error(err?.response?.data?.message || err?.message || 'Erro ao salvar contato.');
      }
    } finally {
      if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
        setContactSaving(false);
      }
    }
  };

  const confirmDeleteContact = (contactId: string) => {
    const contactExists = client?.contacts?.some(c => c.id === contactId);
    if (!contactExists) return;
    setContactToDelete(contactId);
    setDeleteContactOpen(true);
  };

  const handleDeleteContact = async () => {
    if (!client || !contactToDelete) return;
    const currentClientId = client.id;
    const currentSequence = requestSequenceRef.current;

    setDeletingContact(true);
    try {
      await clientsService.deleteClientContact(currentClientId, contactToDelete);
      
      if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
        toast.success('Contato excluído com sucesso.');
        setDeletingContact(false);
        setDeleteContactOpen(false);
        setContactToDelete(null);
        loadData(currentClientId);
      }
    } catch (err: any) {
      if (currentSequence !== requestSequenceRef.current || client.id !== currentClientId) return;
      if (err?.response?.status === 403 || err?.status === 403) {
        toast.error('Você não tem permissão para excluir contatos.');
      } else {
        toast.error(err?.response?.data?.message || err?.message || 'Erro ao excluir contato.');
      }
    } finally {
      if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
        setDeletingContact(false);
      }
    }
  };

  // --- Reuniões ---
  type MeetingFormState = {
    id: string;
    title: string;
    meetingDate: string;
    originalIsoDate: string | null;
    summary: string;
    actionItems: string;
    externalLink: string;
  };

  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [meetingSaving, setMeetingSaving] = useState(false);
  const [meetingForm, setMeetingForm] = useState<MeetingFormState>({
    id: '',
    title: '',
    meetingDate: '',
    originalIsoDate: null,
    summary: '',
    actionItems: '',
    externalLink: '',
  });
  const [deleteMeetingOpen, setDeleteMeetingOpen] = useState(false);
  const [deletingMeeting, setDeletingMeeting] = useState(false);
  const [meetingToDelete, setMeetingToDelete] = useState<string | null>(null);

  const formatDatetimeLocal = (isoString?: string) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const parseLocalDatetime = (localString: string): Date | null => {
    const d = new Date(localString);
    if (isNaN(d.getTime())) return null;
    
    const pad = (n: number) => n.toString().padStart(2, '0');
    const reconstructed = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    
    // Se a reconstrução local divergir da entrada original (considerando o formato datetime-local Padrão),
    // significa que o horário é inválido ou foi shiftado pelo JS (ex: pulo de horário de verão).
    if (localString !== reconstructed) {
      return null;
    }
    return d;
  };

  const openMeetingModal = (meeting?: ClientMeetingNote) => {
    if (meeting) {
      setMeetingForm({
        id: meeting.id,
        title: meeting.title,
        meetingDate: formatDatetimeLocal(meeting.meetingDate),
        originalIsoDate: meeting.meetingDate || null,
        summary: meeting.summary || '',
        actionItems: meeting.actionItems || '',
        externalLink: meeting.externalLink || '',
      });
    } else {
      setMeetingForm({
        id: '',
        title: '',
        meetingDate: '',
        originalIsoDate: null,
        summary: '',
        actionItems: '',
        externalLink: '',
      });
    }
    setMeetingModalOpen(true);
  };

  const handleSaveMeeting = async () => {
    if (!client) return;
    const currentClientId = client.id;
    const currentSequence = requestSequenceRef.current;

    const trimmedTitle = meetingForm.title?.trim() || '';
    if (!trimmedTitle) {
      toast.error('O título da reunião é obrigatório.');
      return;
    }
    
    const trimmedSummary = meetingForm.summary?.trim() || '';
    if (!trimmedSummary) {
      toast.error('O resumo da reunião é obrigatório.');
      return;
    }

    if (!meetingForm.meetingDate) {
      toast.error('A data e horário são obrigatórios.');
      return;
    }

    let finalDate: Date;
    if (meetingForm.originalIsoDate && meetingForm.meetingDate === formatDatetimeLocal(meetingForm.originalIsoDate)) {
      finalDate = new Date(meetingForm.originalIsoDate);
    } else {
      const parsed = parseLocalDatetime(meetingForm.meetingDate);
      if (!parsed) {
        toast.error('Data ou horário inexistente.');
        return;
      }
      finalDate = parsed;
    }
    
    let formattedExternalLink = meetingForm.externalLink?.trim() || null;
    if (formattedExternalLink) {
      try {
        const url = new URL(formattedExternalLink);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          toast.error('O link da ata deve usar protocolo http: ou https:');
          return;
        }
      } catch (e) {
        toast.error('O link da ata é inválido.');
        return;
      }
    }

    setMeetingSaving(true);
    try {
      const payload: CreateClientMeetingNoteRequest = {
        title: trimmedTitle,
        meetingDate: finalDate,
        summary: trimmedSummary,
        actionItems: meetingForm.actionItems?.trim() || null,
        externalLink: formattedExternalLink,
      };

      if (meetingForm.id) {
        await clientsService.updateClientMeeting(currentClientId, meetingForm.id, payload);
        if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
          toast.success('Ata atualizada com sucesso.');
        }
      } else {
        await clientsService.createClientMeeting(currentClientId, payload);
        if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
          toast.success('Ata registrada com sucesso.');
        }
      }
      
      if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
        setMeetingSaving(false);
        setMeetingModalOpen(false);
        loadData(currentClientId);
      }
    } catch (err: any) {
      if (currentSequence !== requestSequenceRef.current || client.id !== currentClientId) return;
      if (err?.response?.status === 403 || err?.status === 403) {
        toast.error('Você não tem permissão para gerenciar atas.');
      } else {
        toast.error(err?.response?.data?.message || err?.message || 'Erro ao salvar ata.');
      }
    } finally {
      if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
        setMeetingSaving(false);
      }
    }
  };

  const confirmDeleteMeeting = (meetingId: string) => {
    const meetingExists = client?.meetingNotes?.some(m => m.id === meetingId);
    if (!meetingExists) return;
    setMeetingToDelete(meetingId);
    setDeleteMeetingOpen(true);
  };

  const handleDeleteMeeting = async () => {
    if (!client || !meetingToDelete) return;
    const currentClientId = client.id;
    const currentSequence = requestSequenceRef.current;

    setDeletingMeeting(true);
    try {
      await clientsService.deleteClientMeeting(currentClientId, meetingToDelete);
      
      if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
        toast.success('Ata excluída com sucesso.');
        setDeletingMeeting(false);
        setDeleteMeetingOpen(false);
        setMeetingToDelete(null);
        loadData(currentClientId);
      }
    } catch (err: any) {
      if (currentSequence !== requestSequenceRef.current || client.id !== currentClientId) return;
      if (err?.response?.status === 403 || err?.status === 403) {
        toast.error('Você não tem permissão para excluir atas.');
      } else {
        toast.error(err?.response?.data?.message || err?.message || 'Erro ao excluir ata.');
      }
    } finally {
      if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
        setDeletingMeeting(false);
      }
    }
  };

  // --- Briefing ---
  const [briefingModalOpen, setBriefingModalOpen] = useState(false);
  const [briefingSaving, setBriefingSaving] = useState(false);
  const [briefingForm, setBriefingForm] = useState({
    objective: '',
    targetAudience: '',
    positioning: '',
    competitors: '',
    toneOfVoice: '',
    notes: '',
  });

  const openBriefingModal = () => {
    const b = client?.briefing;
    setBriefingForm({
      objective: b?.objective || '',
      targetAudience: b?.targetAudience || '',
      positioning: b?.positioning || '',
      competitors: b?.competitors || '',
      toneOfVoice: b?.toneOfVoice || '',
      notes: b?.notes || '',
    });
    setBriefingModalOpen(true);
  };

  const handleSaveBriefing = async () => {
    if (!client) return;
    const currentClientId = client.id;
    const currentSequence = requestSequenceRef.current;

    const payload: ClientBriefing = { version: 1 };
    
    if (briefingForm.objective.trim()) payload.objective = briefingForm.objective.trim();
    if (briefingForm.targetAudience.trim()) payload.targetAudience = briefingForm.targetAudience.trim();
    if (briefingForm.positioning.trim()) payload.positioning = briefingForm.positioning.trim();
    if (briefingForm.competitors.trim()) payload.competitors = briefingForm.competitors.trim();
    if (briefingForm.toneOfVoice.trim()) payload.toneOfVoice = briefingForm.toneOfVoice.trim();
    if (briefingForm.notes.trim()) payload.notes = briefingForm.notes.trim();

    setBriefingSaving(true);
    try {
      await clientsService.updateClient(currentClientId, { briefing: payload });
      
      if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
        toast.success('Briefing atualizado com sucesso.');
        setBriefingSaving(false);
        setBriefingModalOpen(false);
        loadData(currentClientId);
      }
    } catch (err: any) {
      if (currentSequence !== requestSequenceRef.current || client.id !== currentClientId) return;
      if (err?.response?.status === 403 || err?.status === 403) {
        toast.error('Você não tem permissão para editar o briefing.');
      } else {
        toast.error(err?.response?.data?.message || err?.message || 'Erro ao atualizar briefing.');
      }
      setBriefingSaving(false);
    }
  };

  // --- Brand Kit ---
  const [brandKitModalOpen, setBrandKitModalOpen] = useState(false);
  const [brandKitSaving, setBrandKitSaving] = useState(false);
  const [brandKitForm, setBrandKitForm] = useState<BrandKitFormState>({
    colors: [],
    typography: [],
    externalLinks: [],
    notes: '',
  });

  const openBrandKitModal = () => {
    const bk = client?.brandKit;
    setBrandKitForm({
      colors: bk?.colors
        ? bk.colors.map((c) => ({
            _localId: generateBrandKitLocalId('color'),
            name: c.name,
            hex: c.hex,
          }))
        : [],
      typography: bk?.typography
        ? bk.typography.map((t) => ({
            _localId: generateBrandKitLocalId('typo'),
            role: t.role,
            fontName: t.fontName,
          }))
        : [],
      externalLinks: bk?.externalLinks
        ? bk.externalLinks.map((l) => ({
            _localId: generateBrandKitLocalId('link'),
            label: l.label,
            url: l.url,
            type: l.type,
          }))
        : [],
      notes: bk?.notes || '',
    });
    setBrandKitModalOpen(true);
  };

  const handleSaveBrandKit = async () => {
    if (!client) return;
    const currentClientId = client.id;
    const currentSequence = requestSequenceRef.current;

    const payload: ClientBrandKit = {
      colors: [],
      typography: [],
      externalLinks: [],
    };

    for (const c of brandKitForm.colors) {
      const name = c.name.trim();
      const hex = c.hex.trim();
      if (!name) {
        toast.error('O nome da cor é obrigatório.');
        return;
      }
      if (!hex || !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex)) {
        toast.error(`A cor "${name}" deve ter um código HEX válido (ex: #FFFFFF).`);
        return;
      }
      payload.colors.push({ name, hex });
    }

    for (const t of brandKitForm.typography) {
      const role = t.role.trim();
      const fontName = t.fontName.trim();
      if (!role) {
        toast.error('A função da fonte é obrigatória.');
        return;
      }
      if (!fontName) {
        toast.error('O nome da fonte é obrigatório.');
        return;
      }
      payload.typography.push({ role, fontName });
    }

    for (const l of brandKitForm.externalLinks) {
      const label = l.label.trim();
      const url = l.url.trim();
      if (!label) {
        toast.error('A descrição do link é obrigatória.');
        return;
      }
      if (!url) {
        toast.error('A URL do link é obrigatória.');
        return;
      }
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          toast.error(`O link "${label}" deve usar protocolo HTTP ou HTTPS.`);
          return;
        }
      } catch {
        toast.error(`A URL do link "${label}" é inválida.`);
        return;
      }
      payload.externalLinks.push({
        label,
        url,
        ...(l.type && l.type.trim() ? { type: l.type.trim() } : {}),
      });
    }

    const notes = brandKitForm.notes.trim();
    if (notes) {
      payload.notes = notes;
    }

    setBrandKitSaving(true);
    try {
      await clientsService.updateClient(currentClientId, { brandKit: payload });
      if (currentSequence === requestSequenceRef.current && client.id === currentClientId) {
        toast.success('Brand Kit atualizado com sucesso.');
        setBrandKitSaving(false);
        setBrandKitModalOpen(false);
        loadData(currentClientId);
      }
    } catch (err: any) {
      if (currentSequence !== requestSequenceRef.current || client.id !== currentClientId) return;
      if (err?.response?.status === 403 || err?.status === 403) {
        toast.error('Você não tem permissão para editar o Brand Kit.');
      } else {
        toast.error(err?.response?.data?.message || err?.message || 'Erro ao atualizar Brand Kit.');
      }
      setBrandKitSaving(false);
    }
  };

  const openEditModal = () => {
    if (!client) return;
    setEditForm({
      name: client.name,
      legalName: client.legalName || '',
      document: client.document || '',
      email: client.email || '',
      phone: client.phone || '',
      status: client.status,
      startDate: client.startDate || '',
      endDate: client.endDate || '',
      notes: client.notes || '',
    });
    setAddressForm({
      street: client.address?.street || '',
      number: client.address?.number || '',
      complement: client.address?.complement || '',
      district: client.address?.district || '',
      city: client.address?.city || '',
      state: client.address?.state || '',
      postalCode: client.address?.postalCode || '',
      countryCode: client.address?.countryCode || '',
      latitude: client.address?.latitude !== undefined && client.address?.latitude !== null ? String(client.address.latitude) : '',
      longitude: client.address?.longitude !== undefined && client.address?.longitude !== null ? String(client.address.longitude) : '',
    });
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!client) return;
    setEditSaving(true);
    try {
      // Clean address
      let finalAddress: any = null;
      const hasAnyAddressField = Object.values(addressForm).some((v) => v !== '' && v !== null && v !== undefined);
      
      if (hasAnyAddressField) {
        finalAddress = {
          street: addressForm.street ? addressForm.street : null,
          number: addressForm.number ? addressForm.number : null,
          complement: addressForm.complement ? addressForm.complement : null,
          district: addressForm.district ? addressForm.district : null,
          city: addressForm.city ? addressForm.city : null,
          state: addressForm.state ? addressForm.state : null,
          postalCode: addressForm.postalCode ? addressForm.postalCode : null,
          countryCode: addressForm.countryCode ? addressForm.countryCode.toUpperCase() : null,
          latitude: addressForm.latitude !== '' ? Number(addressForm.latitude) : null,
          longitude: addressForm.longitude !== '' ? Number(addressForm.longitude) : null,
        };
      }

      const payload: UpdateClientDTO = {
        name: editForm.name || undefined,
        legalName: editForm.legalName || null,
        // Só envia document se foi carregado para evitar overwrite destructivo
        ...(client.document !== undefined && client.document !== null ? { document: editForm.document || null } : {}),
        email: editForm.email || null,
        phone: editForm.phone || null,
        status: editForm.status,
        startDate: editForm.startDate || null,
        endDate: editForm.endDate || null,
        notes: editForm.notes || null,
        address: finalAddress,
      };

      await clientsService.updateClient(client.id, payload);
      toast.success('Cliente atualizado com sucesso.');
      setEditOpen(false);
      // Reload completo
      loadData(client.id);
    } catch (err: any) {
      if (err?.response?.status === 403 || err?.status === 403) {
        toast.error('Você não tem permissão para editar este cliente.');
      } else {
        toast.error(err?.response?.data?.message || err?.message || 'Erro ao atualizar.');
      }
    } finally {
      setEditSaving(false);
    }
  };

  if (loading) return <LoadingState message="Carregando cockpit do cliente..." />;
  
  if (error) {
    if (error.status === 403) {
      return (
        <PermissionState
          title="Acesso Restrito"
          description="Você não possui permissão para visualizar este cliente."
        />
      );
    }
    if (error.status === 404) {
      return (
        <ErrorState
          title="Cliente não encontrado"
          description="Este cliente não existe ou foi removido."
          onRetry={() => navigate('/clientes')}
        />
      );
    }
    return (
      <ErrorState
        title="Falha no carregamento"
        description={error.message}
        onRetry={() => id && loadData(id)}
      />
    );
  }

  if (!client) return null;

  // Formaters
  const formatDate = (iso?: string | null) => {
    if (!iso) return null;
    try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return null; }
  };

  const getBadgeVariant = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'success';
      case 'PAUSED': return 'warning';
      case 'LEAD': return 'info';
      default: return 'neutral';
    }
  };

  const hasLatitude = typeof client.address?.latitude === 'number' && Number.isFinite(client.address.latitude);
  const hasLongitude = typeof client.address?.longitude === 'number' && Number.isFinite(client.address.longitude);
  const hasCoordinates = hasLatitude && hasLongitude;
  const hasPartialCoordinates = hasLatitude !== hasLongitude;
  
  let mapUrl = '';
  if (hasCoordinates) {
    const delta = 0.01;
    const west = Math.max(-180, client.address!.longitude! - delta);
    const east = Math.min(180, client.address!.longitude! + delta);
    const south = Math.max(-90, client.address!.latitude! - delta);
    const north = Math.min(90, client.address!.latitude! + delta);
    mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${west},${south},${east},${north}&layer=mapnik&marker=${client.address!.latitude},${client.address!.longitude}`;
  }

  const getAddressText = () => {
    if (!client.address) return null;
    const parts = [
      client.address.street,
      client.address.number,
      client.address.complement,
      client.address.district,
      client.address.city,
      client.address.state,
      client.address.countryCode,
      client.address.postalCode,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  const addressText = getAddressText();

  const getPartnershipDuration = (startDate: string) => {
    const start = new Date(startDate);
    const now = new Date();
    if (start > now) return null;
    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (now.getDate() < start.getDate()) months--;
    if (months <= 0) return null;
    const years = Math.floor(months / 12);
    const remMonths = months % 12;
    if (years > 0 && remMonths > 0) return `${years} ${years === 1 ? 'ano' : 'anos'} e ${remMonths} ${remMonths === 1 ? 'mês' : 'meses'}`;
    if (years > 0) return `${years} ${years === 1 ? 'ano' : 'anos'}`;
    return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  };

  const renderHeaderSquads = () => {
    if (!client.squads || client.squads.length === 0) return null;
    const firstTwo = client.squads.slice(0, 2).map((s: any) => s.name).join(', ');
    const rest = client.squads.length - 2;
    return `${firstTwo}${rest > 0 ? ` +${rest}` : ''}`;
  };

  const sortedContacts = [...(client.contacts || [])].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return 0;
  });

  const latestMeeting = [...(client.meetingNotes || [])].sort(
    (a, b) => new Date(b.meetingDate).getTime() - new Date(a.meetingDate).getTime()
  )[0];

  return (
    <div className={styles.container}>
      {/* HEADER */}
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.identityBlock}>
            <div className={styles.identityAvatar}>
              {client.name.substring(0, 2).toUpperCase()}
            </div>
            <div className={styles.identityText}>
              <h1 className={styles.identityName}>{client.name}</h1>
              {client.legalName && <div className={styles.identityLegal}>{client.legalName}</div>}
              {client.document !== undefined && client.document !== null && (
                <div className={styles.identityDocument}>{client.document}</div>
              )}
            </div>
          </div>
          <div className={styles.headerActions}>
            <Badge variant={getBadgeVariant(client.status)}>
              {statusLabels[client.status] || client.status}
            </Badge>
            <Button variant="secondary" size="sm" onClick={openEditModal}>
              <Edit2 size={14} className="mr-2" />
              Editar cadastro
            </Button>
          </div>
        </div>

        <div className={styles.headerMeta}>
          {client.startDate && (
            <div className={styles.metaItem}>
              <Calendar size={14} className={styles.metaIcon} />
              <span>Parceria desde {formatDate(client.startDate)} {getPartnershipDuration(client.startDate) ? `(${getPartnershipDuration(client.startDate)})` : ''}</span>
            </div>
          )}
          {client.responsibleUser && (
            <div className={styles.metaItem}>
              <Users size={14} className={styles.metaIcon} />
              <span>Resp: {client.responsibleUser.name}</span>
            </div>
          )}
          {client.squads && client.squads.length > 0 && (
            <div className={styles.metaItem}>
              <Layers size={14} className={styles.metaIcon} />
              <span>Squads: <Badge variant="neutral" size="sm" style={{ marginLeft: '4px' }}>{renderHeaderSquads()}</Badge></span>
            </div>
          )}
        </div>
      </header>

      {/* TABS */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className={styles.tabsContainer}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className={styles.tabContent}>
          {/* 1. VISÃO GERAL */}
          <TabsContent value="visao-geral">
            <div className={styles.gridSection}>
              <div className={styles.grid3}>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base"><Building2 size={16} className="inline mr-2" /> Identidade da Conta</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={styles.infoList}>
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Status</span>
                        <span className={styles.infoValue}>{statusLabels[client.status] || client.status}</span>
                      </div>
                      {client.startDate && (
                        <div className={styles.infoItem}>
                          <span className={styles.infoLabel}>Início da parceria</span>
                          <span className={styles.infoValue}>{formatDate(client.startDate)}</span>
                        </div>
                      )}
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Responsável</span>
                        <span className={styles.infoValue}>{client.responsibleUser?.name || 'Não atribuído'}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base"><Users size={16} className="inline mr-2" /> Atendimento</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={styles.infoList}>
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Contato Principal</span>
                        <span className={styles.infoValue}>
                          {sortedContacts[0] ? sortedContacts[0].name : (client.email || client.phone || 'Sem contato')}
                        </span>
                      </div>
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Total de Contatos</span>
                        <span className={styles.infoValue}>{client.contacts?.length || 0} cadastrados</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base"><Activity size={16} className="inline mr-2" /> Relacionamento</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={styles.infoList}>
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Última Reunião</span>
                        <span className={styles.infoValue}>
                          {latestMeeting ? `${latestMeeting.title} (${formatDate(latestMeeting.meetingDate)})` : 'Nenhuma reunião'}
                        </span>
                      </div>
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Integrações Ativas</span>
                        <span className={styles.infoValue}>{client.activeIntegrations?.length || 0} conectadas</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* 2. EMPRESA & MARCA */}
          <TabsContent value="empresa-marca">
            <div className={styles.gridSection}>
              <div className={styles.grid2}>
                {/* Cadastro Base */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base"><Building2 size={16} className="inline mr-2" /> Dados Cadastrais</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={styles.infoList}>
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Nome Fantasia</span>
                        <span className={styles.infoValue}>{client.name}</span>
                      </div>
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Razão Social</span>
                        <span className={styles.infoValue}>{client.legalName || <span className={styles.infoValueMuted}>Não informado</span>}</span>
                      </div>
                      {client.document !== undefined && client.document !== null && (
                        <div className={styles.infoItem}>
                          <span className={styles.infoLabel}>Documento</span>
                          <span className={styles.infoValue}>{client.document || <span className={styles.infoValueMuted}>Não informado</span>}</span>
                        </div>
                      )}
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>E-mail Principal</span>
                        <span className={styles.infoValue}>{client.email || <span className={styles.infoValueMuted}>Não informado</span>}</span>
                      </div>
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Telefone Principal</span>
                        <span className={styles.infoValue}>{client.phone || <span className={styles.infoValueMuted}>Não informado</span>}</span>
                      </div>
                      {client.notes && (
                        <div className={styles.infoItem}>
                          <span className={styles.infoLabel}>Observações</span>
                          <span className={styles.infoValue}>{client.notes}</span>
                        </div>
                      )}
                      <div className={styles.infoItem} style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed var(--z-border-subtle)' }}>
                        <span className={styles.infoLabel}>Status</span>
                        <span className={styles.infoValue}>{statusLabels[client.status] || client.status}</span>
                      </div>
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Início da parceria</span>
                        <span className={styles.infoValue}>{formatDate(client.startDate) || <span className={styles.infoValueMuted}>Não especificada</span>}</span>
                      </div>
                      {client.endDate && (
                        <div className={styles.infoItem}>
                          <span className={styles.infoLabel}>Data final</span>
                          <span className={styles.infoValue}>{formatDate(client.endDate)}</span>
                        </div>
                      )}
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Responsável</span>
                        <span className={styles.infoValue}>{client.responsibleUser?.name || <span className={styles.infoValueMuted}>Não atribuído</span>}</span>
                      </div>
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Squads</span>
                        <span className={styles.infoValue}>
                          {client.squads && client.squads.length > 0 
                            ? client.squads.map((s: any) => s.name).join(', ') 
                            : <span className={styles.infoValueMuted}>Sem squad vinculada.</span>}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Endereço & Mapa */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base"><MapPin size={16} className="inline mr-2" /> Endereço & Localização</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={styles.infoList}>
                      <div className={styles.infoItem}>
                        <span className={styles.infoLabel}>Endereço Completo</span>
                        <span className={styles.infoValue}>{addressText || <span className={styles.infoValueMuted}>Endereço não cadastrado.</span>}</span>
                      </div>
                      
                      <div className={styles.mapContainer} style={{ marginTop: '1rem' }}>
                        {!client.address ? (
                           <div className={styles.mapFallback}>Endereço não cadastrado.</div>
                        ) : hasCoordinates ? (
                           <>
                             <iframe
                               className={styles.mapIframe}
                               title={`Localização de ${client.name}`}
                               loading="lazy"
                               referrerPolicy="no-referrer"
                               src={mapUrl}
                             />
                             <div className={styles.mapAttribution}>
                               <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className={styles.mapAttributionLink}>© OpenStreetMap contributors</a>
                             </div>
                             <a 
                               href={`https://www.openstreetmap.org/?mlat=${client.address!.latitude}&mlon=${client.address!.longitude}#map=16/${client.address!.latitude}/${client.address!.longitude}`}
                               target="_blank"
                               rel="noopener noreferrer"
                               className={styles.mapLink}
                             >
                               Abrir no OpenStreetMap
                             </a>
                           </>
                        ) : hasPartialCoordinates ? (
                           <div className={styles.mapFallback}>Coordenadas incompletas para exibir o mapa.</div>
                        ) : addressText ? (
                           <div className={styles.mapFallback}>Endereço cadastrado. Localização no mapa ainda não definida.</div>
                        ) : (
                           <div className={styles.mapFallback}>Endereço não cadastrado.</div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Contatos */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base"><Users size={16} className="inline mr-2" /> Lista de Contatos</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => openContactModal()}>
                      <Plus size={14} className="mr-1" /> Adicionar contato
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {sortedContacts.length > 0 ? (
                      <div className={styles.gridSection}>
                        {sortedContacts.map(c => (
                          <div key={c.id} className={styles.contactCard}>
                            <div className={styles.contactHeader}>
                              <span className={styles.contactName}>{c.name} {c.isPrimary && <Badge variant="info" size="sm">Principal</Badge>}</span>
                              {c.role && <span className={styles.contactRole}>{c.role}</span>}
                            </div>
                            <div className={styles.contactDetails}>
                              {c.email && <span><Mail size={12} className="inline mr-1" /> {c.email}</span>}
                              {c.phone && <span><Phone size={12} className="inline mr-1" /> {c.phone}</span>}
                            </div>
                            {c.notes && <div className={styles.contactNotes}>{c.notes}</div>}
                            <div className="mt-4 flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => openContactModal(c)}>
                                <Edit2 size={14} className="mr-1" /> Editar
                              </Button>
                              <Button variant="ghost" size="sm" className={styles.contactDeleteBtn} onClick={() => confirmDeleteContact(c.id)}>
                                <Trash2 size={14} className="mr-1" /> Excluir
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.infoValueMuted}>
                        Nenhum contato cadastrado.
                        <div className="mt-2">
                          <Button variant="secondary" size="sm" onClick={() => openContactModal()}>
                            <Plus size={14} className="mr-1" /> Adicionar contato
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Briefing */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base"><FileText size={16} className="inline mr-2" /> Briefing</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => openBriefingModal()}>
                      {hasBriefingContent(client.briefing) ? (
                        <><Edit2 size={14} className="mr-1" /> Editar briefing</>
                      ) : (
                        <><Plus size={14} className="mr-1" /> Preencher briefing</>
                      )}
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {hasBriefingContent(client.briefing) ? (
                      <div className={styles.infoList}>
                        {client.briefing.objective && (
                          <div className={styles.infoItem}>
                            <span className={styles.infoLabel}>Objetivo do cliente</span>
                            <span className={styles.infoValue}>{client.briefing.objective}</span>
                          </div>
                        )}
                        {client.briefing.targetAudience && (
                          <div className={styles.infoItem}>
                            <span className={styles.infoLabel}>Público-alvo</span>
                            <span className={styles.infoValue}>{client.briefing.targetAudience}</span>
                          </div>
                        )}
                        {client.briefing.positioning && (
                          <div className={styles.infoItem}>
                            <span className={styles.infoLabel}>Posicionamento</span>
                            <span className={styles.infoValue}>{client.briefing.positioning}</span>
                          </div>
                        )}
                        {client.briefing.competitors && (
                          <div className={styles.infoItem}>
                            <span className={styles.infoLabel}>Concorrentes</span>
                            <span className={styles.infoValue}>{client.briefing.competitors}</span>
                          </div>
                        )}
                        {client.briefing.toneOfVoice && (
                          <div className={styles.infoItem}>
                            <span className={styles.infoLabel}>Tom de voz</span>
                            <span className={styles.infoValue}>{client.briefing.toneOfVoice}</span>
                          </div>
                        )}
                        {client.briefing.notes && (
                          <div className={styles.infoItem}>
                            <span className={styles.infoLabel}>Anotações gerais</span>
                            <span className={styles.infoValue}>{client.briefing.notes}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={styles.infoValueMuted}>Briefing não preenchido.</div>
                    )}
                  </CardContent>
                </Card>

                {/* Brand Kit */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base"><Palette size={16} className="inline mr-2" /> Brand Kit</CardTitle>
                    <Button variant="ghost" size="sm" onClick={openBrandKitModal}>
                      {hasBrandKitContent(client.brandKit) ? (
                        <><Edit2 size={14} className="mr-1" /> Editar Brand Kit</>
                      ) : (
                        <><Plus size={14} className="mr-1" /> Preencher Brand Kit</>
                      )}
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {hasBrandKitContent(client.brandKit) ? (
                      <div className={styles.infoList}>
                        {client.brandKit.colors && client.brandKit.colors.length > 0 && (
                          <div className={styles.infoItem}>
                            <span className={styles.infoLabel}>Cores</span>
                            <div className={styles.swatchList}>
                              {client.brandKit.colors.map((color, idx) => (
                                <div key={idx} className={styles.swatchItem}>
                                  <div className={styles.swatchCircle} style={{ backgroundColor: color.hex }} />
                                  <span>{color.name} ({color.hex})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {client.brandKit.typography && client.brandKit.typography.length > 0 && (
                          <div className={styles.infoItem}>
                            <span className={styles.infoLabel}>Tipografia</span>
                            <span className={styles.infoValue}>
                              {client.brandKit.typography.map(t => `${t.role}: ${t.fontName}`).join(' | ')}
                            </span>
                          </div>
                        )}
                        {client.brandKit.externalLinks && client.brandKit.externalLinks.length > 0 && (
                          <div className={styles.infoItem}>
                            <span className={styles.infoLabel}>Links e Assets Externos</span>
                            <div className={styles.infoList}>
                              {client.brandKit.externalLinks.map((link, idx) => {
                                const isSafeLink = isValidWebProtocol(link.url);
                                return isSafeLink ? (
                                  <a key={idx} href={link.url} target="_blank" rel="noopener noreferrer" className={styles.infoValue} style={{ color: 'var(--z-color-primary)', textDecoration: 'underline' }}>
                                    <LinkIcon size={12} className="inline mr-1" />
                                    {link.label} {link.type ? `(${link.type})` : ''}
                                  </a>
                                ) : (
                                  <span key={idx} className={styles.infoValue}>
                                    <LinkIcon size={12} className="inline mr-1" />
                                    {link.label} {link.type ? `(${link.type})` : ''} ({link.url})
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {client.brandKit.notes && (
                          <div className={styles.infoItem}>
                            <span className={styles.infoLabel}>Diretrizes</span>
                            <span className={styles.infoValue}>{client.brandKit.notes}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={styles.infoValueMuted}>Brand Kit não cadastrado.</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* 3. OPERAÇÃO */}
          <TabsContent value="operacao">
            <div className={styles.gridSection}>
              {/* Contexto Operacional — Readiness */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base"><Layers size={16} className="inline mr-2" /> Contexto Operacional</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={styles.infoList}>
                    <div className={styles.infoItem}>
                      <span className={styles.infoLabel}>Readiness Asana</span>
                      <span className={styles.infoValue}>
                        {client.activeIntegrations?.some(i => i.provider === 'ASANA' && i.status === 'ACTIVE') ? 'Conectado' : 'Não conectado'}
                      </span>
                    </div>
                    <div className={styles.infoItem}>
                      <span className={styles.infoLabel}>Readiness BrightBean</span>
                      <span className={styles.infoValue}>
                        {client.activeIntegrations?.some(i => i.provider === 'BRIGHTBEAN' && i.status === 'ACTIVE') ? 'Conectado' : 'Não conectado'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Resumo Contextual de Projetos — Asana */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">
                    <Briefcase size={16} className="inline mr-2" /> Projetos do cliente — Asana
                  </CardTitle>
                  {!asanaProjectsLoading && !asanaProjectsError && asanaProjects.length > 0 && (
                    <Badge variant="info" size="sm">
                      {asanaProjects.length} {asanaProjects.length === 1 ? 'projeto vinculado' : 'projetos vinculados'}
                    </Badge>
                  )}
                </CardHeader>
                <CardContent>
                  {asanaProjectsLoading ? (
                    <div className={styles.infoValueMuted}>Carregando projetos do Asana...</div>
                  ) : asanaProjectsError ? (
                    asanaProjectsError.status === 403 ? (
                      <div className={styles.asanaRestrictedNotice}>
                        <span className="font-semibold">Acesso restrito:</span> Você não possui a permissão &apos;projects.view&apos; para visualizar os projetos deste cliente.
                      </div>
                    ) : (
                      <div className={styles.asanaWarningNotice}>
                        {asanaProjectsError.message}
                      </div>
                    )
                  ) : asanaProjects.length > 0 ? (
                    <div className={styles.asanaProjectsList}>
                      {asanaProjects.map((proj) => {
                        const isLive = proj.metricsStatus === 'LIVE';
                        const isError = proj.metricsStatus === 'ERROR';
                        const isUnavailable =
                          proj.metricsStatus === 'UNAVAILABLE' ||
                          (!proj.metricsStatus &&
                            !client.activeIntegrations?.some(
                              (i) => i.provider === 'ASANA' && i.status === 'ACTIVE'
                            ));

                        const formattedTime = proj.metricsUpdatedAt
                          ? new Date(proj.metricsUpdatedAt).toLocaleTimeString('pt-BR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : null;

                        return (
                          <div key={proj.projectGid || proj.integrationId} className={styles.asanaProjectCard}>
                            <div className={styles.asanaProjectHeader}>
                              <span className={styles.asanaProjectName}>{proj.projectName}</span>
                              {proj.projectGid && (
                                <span className={styles.asanaProjectGid}>GID: {proj.projectGid}</span>
                              )}
                            </div>

                            {isLive && proj.totalTasks !== null ? (
                              <div>
                                <div className={styles.asanaMetricsList}>
                                  <span className={styles.asanaMetricBadge}>
                                    Total: <strong>{proj.totalTasks}</strong>
                                  </span>
                                  <span className={styles.asanaMetricBadge}>
                                    Concluídas: <strong>{proj.completedTasks ?? 0}</strong>
                                  </span>
                                  <span className={styles.asanaMetricBadge}>
                                    Pendentes: <strong>{proj.pendingTasks ?? 0}</strong>
                                  </span>
                                  {(proj.overdueTasks ?? 0) > 0 && (
                                    <span className={`${styles.asanaMetricBadge} ${styles.asanaMetricOverdue}`}>
                                      Em atraso: <strong>{proj.overdueTasks}</strong>
                                    </span>
                                  )}
                                </div>
                                {proj.totalTasks === 0 ? (
                                  <div className="mt-1 text-[11px] text-muted-foreground">
                                    0 tarefas confirmadas pelo Asana{formattedTime ? ` às ${formattedTime}` : ''}
                                  </div>
                                ) : formattedTime ? (
                                  <div className="mt-1 text-[11px] text-muted-foreground">
                                    Consulta confirmada às {formattedTime}
                                  </div>
                                ) : null}
                              </div>
                            ) : isError ? (
                              <div className={styles.asanaWarningNotice}>
                                Falha ao consultar métricas deste projeto no Asana. Métricas não zeradas.
                              </div>
                            ) : isUnavailable ? (
                              <div className={styles.asanaNotice}>
                                Métricas detalhadas de tarefas indisponíveis (integração Asana inativa ou não configurada).
                              </div>
                            ) : (
                              <div className={styles.asanaNotice}>
                                Métricas de tarefas aguardando verificação.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={styles.infoValueMuted}>
                      Nenhum projeto do Asana vinculado a este cliente.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 4. CONTRATO & FINANCEIRO */}
          <TabsContent value="contrato-financeiro">
            <Card>
              <CardHeader>
                <CardTitle className="text-base"><Briefcase size={16} className="inline mr-2" /> Resumo Contratual</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={styles.infoList}>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>Data de Início</span>
                    <span className={styles.infoValue}>{formatDate(client.startDate) || <span className={styles.infoValueMuted}>Não especificada</span>}</span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>Data Final</span>
                    <span className={styles.infoValue}>{formatDate(client.endDate) || <span className={styles.infoValueMuted}>Indeterminada</span>}</span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>Valor Financeiro</span>
                    <span className={styles.infoValue}>
                      {client.contractValue !== undefined && client.contractValue !== null 
                        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(client.contractValue)
                        : <span className={styles.infoValueMuted}>Valor financeiro não disponível.</span>}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 5. RELACIONAMENTO & MEMÓRIA */}
          <TabsContent value="relacionamento-memoria">
            <div className={styles.grid2}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base"><Calendar size={16} className="inline mr-2" /> Atas de Reunião</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => openMeetingModal()}>
                    <Plus size={14} className="mr-1" /> Registrar reunião
                  </Button>
                </CardHeader>
                <CardContent>
                  {client.meetingNotes && client.meetingNotes.length > 0 ? (
                    <div className={styles.gridSection}>
                      {client.meetingNotes.map(meeting => (
                        <div key={meeting.id} className={styles.meetingCard}>
                          <div className={styles.meetingHeader}>
                            <span className={styles.meetingTitle}>{meeting.title}</span>
                            <span className={styles.meetingDate}>{formatDate(meeting.meetingDate)}</span>
                          </div>
                          {meeting.authorUserName && <span className={styles.infoValueMuted} style={{ fontSize: '0.75rem' }}>Por {meeting.authorUserName}</span>}
                          <p className={styles.meetingSummary}>{meeting.summary}</p>
                          {meeting.actionItems && (
                            <div style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
                              <strong style={{ color: 'var(--z-text-primary)' }}>Ações definidas:</strong>
                              <p style={{ color: 'var(--z-text-secondary)', whiteSpace: 'pre-wrap', marginTop: '4px' }}>{meeting.actionItems}</p>
                            </div>
                          )}
                          {meeting.externalLink && (
                            isValidWebProtocol(meeting.externalLink) ? (
                              <a
                                href={meeting.externalLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--z-color-primary)', fontSize: '0.75rem', marginTop: '0.5rem', textDecoration: 'underline', display: 'inline-block' }}
                              >
                                Ver ata completa
                              </a>
                            ) : (
                              <span
                                className={styles.infoValueMuted}
                                style={{ fontSize: '0.75rem', marginTop: '0.5rem', display: 'inline-block' }}
                              >
                                Link externo ({meeting.externalLink})
                              </span>
                            )
                          )}
                          <div className="mt-4 flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openMeetingModal(meeting)}>
                              <Edit2 size={14} className="mr-1" /> Editar
                            </Button>
                            <Button variant="ghost" size="sm" className={styles.contactDeleteBtn} onClick={() => confirmDeleteMeeting(meeting.id)}>
                              <Trash2 size={14} className="mr-1" /> Excluir
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.infoValueMuted}>
                      Nenhuma ata registrada.
                      <div className="mt-2">
                        <Button variant="secondary" size="sm" onClick={() => openMeetingModal()}>
                          <Plus size={14} className="mr-1" /> Registrar reunião
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base"><Activity size={16} className="inline mr-2" /> Timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  {timelineLoading ? (
                    <div className={styles.infoValueMuted}>Carregando timeline...</div>
                  ) : timelineError ? (
                    <div className={styles.infoValueMuted}>Não foi possível carregar a timeline.</div>
                  ) : timeline.length > 0 ? (
                    <div className={styles.timeline}>
                      {timeline.map(ev => (
                        <div key={ev.id} className={styles.timelineItem}>
                          <div className={styles.timelineDot} />
                          <div className={styles.timelineTitle}>{ev.title}</div>
                          <div className={styles.timelineDescription}>{ev.description}</div>
                          <div className={styles.timelineMeta}>
                            <Clock size={12} />
                            {new Date(ev.timestamp).toLocaleString('pt-BR')}
                            {ev.actorName && ` • Por ${ev.actorName}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.infoValueMuted}>Nenhuma atividade registrada.</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 6. INTEGRAÇÕES */}
          <TabsContent value="integracoes">
            <Card>
              <CardHeader>
                <CardTitle className="text-base"><Layers size={16} className="inline mr-2" /> Integrações Ativas</CardTitle>
              </CardHeader>
              <CardContent>
                {client.activeIntegrations && client.activeIntegrations.length > 0 ? (
                  <div className={styles.integrationList}>
                    {client.activeIntegrations.filter(i => i.provider !== 'POSTIZ').map(integ => (
                      <div key={integ.id} className={styles.integrationChip} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div className={`${styles.integrationDot} ${integ.status === 'ACTIVE' ? styles.integrationDotActive : styles.integrationDotInactive}`} />
                          <strong>{integ.provider}</strong>
                        </div>
                        {integ.displayName && <div style={{ fontSize: '0.875rem', color: 'var(--z-text-secondary)' }}>Nome: {integ.displayName}</div>}
                        <div style={{ fontSize: '0.875rem', color: 'var(--z-text-secondary)' }}>Status: {getIntegrationStatusLabel(integ.status)}</div>
                        {integ.lastValidatedAt && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--z-text-muted)' }}>
                            Última validação: {formatDate(integ.lastValidatedAt)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.infoValueMuted}>Nenhuma integração conectada.</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>

      {/* MODAL EDITAR CADASTRO */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Editar Cadastro do Cliente</DialogTitle>
          </DialogHeader>

          <div className={styles.formGrid}>
            <div className={styles.formFieldFull}>
              <Label>Nome Fantasia</Label>
              <Input value={editForm.name || ''} onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))} />
            </div>
            
            <div>
              <Label>Razão Social</Label>
              <Input value={editForm.legalName || ''} onChange={e => setEditForm(prev => ({ ...prev, legalName: e.target.value }))} />
            </div>

            {client.document !== undefined && client.document !== null && (
              <div>
                <Label>Documento</Label>
                <Input value={editForm.document || ''} onChange={e => setEditForm(prev => ({ ...prev, document: e.target.value }))} />
              </div>
            )}

            <div>
              <Label>E-mail</Label>
              <Input type="email" value={editForm.email || ''} onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))} />
            </div>

            <div>
              <Label>Telefone</Label>
              <Input value={editForm.phone || ''} onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))} />
            </div>

            <div>
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(val: ApiClientStatus) => setEditForm(prev => ({ ...prev, status: val }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Ativo</SelectItem>
                  <SelectItem value="PAUSED">Pausado</SelectItem>
                  <SelectItem value="LEAD">Lead</SelectItem>
                  <SelectItem value="INACTIVE">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Data de Início</Label>
              <Input type="date" value={editForm.startDate ? editForm.startDate.split('T')[0] : ''} onChange={e => setEditForm(prev => ({ ...prev, startDate: e.target.value || null }))} />
            </div>

            <div>
              <Label>Data Final</Label>
              <Input type="date" value={editForm.endDate ? editForm.endDate.split('T')[0] : ''} onChange={e => setEditForm(prev => ({ ...prev, endDate: e.target.value || null }))} />
            </div>

            <div className={styles.formFieldFull}>
              <Label>Observações</Label>
              <Textarea value={editForm.notes || ''} onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))} />
            </div>

            {/* ENDEREÇO */}
            <div className={styles.formFieldFull} style={{ marginTop: '1rem', borderTop: '1px solid var(--z-border-subtle)', paddingTop: '1rem' }}>
              <h4 style={{ fontWeight: 600, marginBottom: '1rem' }}>Endereço e Localização</h4>
            </div>

            <div className={styles.formFieldFull}>
              <Label>Rua</Label>
              <Input value={addressForm.street || ''} onChange={e => setAddressForm((prev: any) => ({ ...prev, street: e.target.value }))} />
            </div>

            <div>
              <Label>Número</Label>
              <Input value={addressForm.number || ''} onChange={e => setAddressForm((prev: any) => ({ ...prev, number: e.target.value }))} />
            </div>

            <div>
              <Label>Complemento</Label>
              <Input value={addressForm.complement || ''} onChange={e => setAddressForm((prev: any) => ({ ...prev, complement: e.target.value }))} />
            </div>

            <div>
              <Label>Bairro</Label>
              <Input value={addressForm.district || ''} onChange={e => setAddressForm((prev: any) => ({ ...prev, district: e.target.value }))} />
            </div>

            <div>
              <Label>Cidade</Label>
              <Input value={addressForm.city || ''} onChange={e => setAddressForm((prev: any) => ({ ...prev, city: e.target.value }))} />
            </div>

            <div>
              <Label>Estado</Label>
              <Input value={addressForm.state || ''} onChange={e => setAddressForm((prev: any) => ({ ...prev, state: e.target.value }))} />
            </div>

            <div>
              <Label>CEP / Código Postal</Label>
              <Input value={addressForm.postalCode || ''} onChange={e => setAddressForm((prev: any) => ({ ...prev, postalCode: e.target.value }))} />
            </div>

            <div>
              <Label>País (ex: BR)</Label>
              <Input maxLength={2} value={addressForm.countryCode || ''} onChange={e => setAddressForm((prev: any) => ({ ...prev, countryCode: e.target.value }))} />
            </div>

            <div className={styles.formFieldMapHint}>
              Coordenadas do mapa — opcionais
            </div>

            <div>
              <Label>Latitude</Label>
              <Input type="number" step="any" min="-90" max="90" value={addressForm.latitude || ''} onChange={e => setAddressForm((prev: any) => ({ ...prev, latitude: e.target.value }))} />
            </div>

            <div>
              <Label>Longitude</Label>
              <Input type="number" step="any" min="-180" max="180" value={addressForm.longitude || ''} onChange={e => setAddressForm((prev: any) => ({ ...prev, longitude: e.target.value }))} />
            </div>
          </div>

          <DialogFooter style={{ marginTop: '1.5rem' }}>
            <DialogClose asChild>
              <Button variant="secondary" disabled={editSaving}>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" onClick={handleSaveEdit} disabled={editSaving || !editForm.name}>
              {editSaving ? 'Salvando...' : 'Salvar Alterações'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteContactOpen} onOpenChange={(val) => !deletingContact && setDeleteContactOpen(val)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contato?</AlertDialogTitle>
            <AlertDialogDescription>
              Você está prestes a excluir o contato <strong>{client?.contacts?.find(c => c.id === contactToDelete)?.name}</strong>.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingContact}>Cancelar</AlertDialogCancel>
            <Button variant="danger" onClick={handleDeleteContact} disabled={deletingContact}>
              {deletingContact ? 'Excluindo...' : 'Excluir contato'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog Adicionar/Editar Contato */}
      <Dialog open={contactModalOpen} onOpenChange={(val) => !contactSaving && setContactModalOpen(val)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{contactForm.id ? 'Editar Contato' : 'Adicionar Contato'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="contactName">Nome *</Label>
              <Input
                id="contactName"
                value={contactForm.name}
                onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                placeholder="Nome do contato"
              />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="contactRole">Cargo/Função</Label>
              <Input
                id="contactRole"
                value={contactForm.role}
                onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
                placeholder="Ex: Diretor de Marketing"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="contactEmail">E-mail</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  placeholder="email@empresa.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contactPhone">Telefone</Label>
                <Input
                  id="contactPhone"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                  placeholder="(00) 00000-0000"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="contactPrimary"
                checked={contactForm.isPrimary}
                onCheckedChange={(checked) => setContactForm({ ...contactForm, isPrimary: !!checked })}
              />
              <Label htmlFor="contactPrimary">Contato principal</Label>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="contactNotes">Observações</Label>
              <Textarea
                id="contactNotes"
                value={contactForm.notes}
                onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                placeholder="Anotações sobre este contato..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={contactSaving}>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" onClick={handleSaveContact} disabled={contactSaving}>
              {contactSaving ? 'Salvando...' : 'Salvar contato'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Adicionar/Editar Reunião */}
      <Dialog open={meetingModalOpen} onOpenChange={(val) => !meetingSaving && setMeetingModalOpen(val)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{meetingForm.id ? 'Editar Reunião' : 'Registrar Reunião'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="meetingTitle">Título *</Label>
              <Input
                id="meetingTitle"
                value={meetingForm.title}
                onChange={(e) => setMeetingForm({ ...meetingForm, title: e.target.value })}
                placeholder="Ex: Alinhamento Mensal"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="meetingDate">Data e horário *</Label>
              <Input
                id="meetingDate"
                type="datetime-local"
                value={meetingForm.meetingDate}
                onChange={(e) => setMeetingForm({ ...meetingForm, meetingDate: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="meetingSummary">Resumo *</Label>
              <Textarea
                id="meetingSummary"
                value={meetingForm.summary}
                onChange={(e) => setMeetingForm({ ...meetingForm, summary: e.target.value })}
                placeholder="Principais pontos discutidos..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="meetingActionItems">Ações definidas</Label>
              <Textarea
                id="meetingActionItems"
                value={meetingForm.actionItems}
                onChange={(e) => setMeetingForm({ ...meetingForm, actionItems: e.target.value })}
                placeholder="Ex: 1. Aprovar campanha..."
                rows={2}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="meetingLink">Link do documento/ata</Label>
              <Input
                id="meetingLink"
                type="url"
                value={meetingForm.externalLink}
                onChange={(e) => setMeetingForm({ ...meetingForm, externalLink: e.target.value })}
                placeholder="https://docs.google.com/..."
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={meetingSaving}>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" onClick={handleSaveMeeting} disabled={meetingSaving}>
              {meetingSaving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog Excluir Reunião */}
      <AlertDialog open={deleteMeetingOpen} onOpenChange={(val) => !deletingMeeting && setDeleteMeetingOpen(val)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ata?</AlertDialogTitle>
            <AlertDialogDescription>
              Você está prestes a excluir a ata <strong>{client?.meetingNotes?.find(m => m.id === meetingToDelete)?.title}</strong>.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingMeeting}>Cancelar</AlertDialogCancel>
            <Button variant="danger" onClick={handleDeleteMeeting} disabled={deletingMeeting}>
              {deletingMeeting ? 'Excluindo...' : 'Excluir ata'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog Editar Briefing */}
      <Dialog open={briefingModalOpen} onOpenChange={(val) => !briefingSaving && setBriefingModalOpen(val)}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Briefing</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="briefingObjective">Objetivo do cliente</Label>
              <Textarea
                id="briefingObjective"
                value={briefingForm.objective}
                onChange={(e) => setBriefingForm({ ...briefingForm, objective: e.target.value })}
                placeholder="Objetivos de comunicação e marketing..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="briefingTargetAudience">Público-alvo</Label>
              <Textarea
                id="briefingTargetAudience"
                value={briefingForm.targetAudience}
                onChange={(e) => setBriefingForm({ ...briefingForm, targetAudience: e.target.value })}
                placeholder="Descrição do público e suas características..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="briefingPositioning">Posicionamento</Label>
              <Textarea
                id="briefingPositioning"
                value={briefingForm.positioning}
                onChange={(e) => setBriefingForm({ ...briefingForm, positioning: e.target.value })}
                placeholder="Como a marca deseja ser percebida..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="briefingCompetitors">Concorrentes</Label>
              <Textarea
                id="briefingCompetitors"
                value={briefingForm.competitors}
                onChange={(e) => setBriefingForm({ ...briefingForm, competitors: e.target.value })}
                placeholder="Principais concorrentes e referências..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="briefingToneOfVoice">Tom de voz</Label>
              <Textarea
                id="briefingToneOfVoice"
                value={briefingForm.toneOfVoice}
                onChange={(e) => setBriefingForm({ ...briefingForm, toneOfVoice: e.target.value })}
                placeholder="Personalidade e estilo da comunicação..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="briefingNotes">Anotações gerais</Label>
              <Textarea
                id="briefingNotes"
                value={briefingForm.notes}
                onChange={(e) => setBriefingForm({ ...briefingForm, notes: e.target.value })}
                placeholder="Outras informações relevantes..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={briefingSaving}>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" onClick={handleSaveBriefing} disabled={briefingSaving}>
              {briefingSaving ? 'Salvando...' : 'Salvar briefing'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Editar Brand Kit */}
      <Dialog open={brandKitModalOpen} onOpenChange={(val) => !brandKitSaving && setBrandKitModalOpen(val)}>
        <DialogContent className="w-full sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Brand Kit</DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            
            {/* A. Cores da marca */}
            <div className={styles.brandKitSection}>
              <div className={styles.brandKitSectionHeader}>
                <Label className="text-base font-medium">Cores da marca</Label>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setBrandKitForm((prev) => ({
                    ...prev,
                    colors: [...prev.colors, { _localId: generateBrandKitLocalId('color'), name: '', hex: '' }],
                  }))}
                >
                  <Plus size={14} className="mr-1" /> Adicionar Cor
                </Button>
              </div>
              {brandKitForm.colors.map((color) => (
                <div key={color._localId} className={styles.brandKitColorRow}>
                  <div className={styles.brandKitColorInputs}>
                    <Input 
                      placeholder="Ex: Roxo principal" 
                      value={color.name}
                      onChange={(e) => {
                        const val = e.target.value;
                        setBrandKitForm((prev) => ({
                          ...prev,
                          colors: prev.colors.map((c) =>
                            c._localId === color._localId ? { ...c, name: val } : c
                          ),
                        }));
                      }}
                      className={styles.brandKitColorName}
                    />
                    <div className={styles.brandKitColorDetails}>
                      <Input 
                        placeholder="HEX: #6D28D9" 
                        value={color.hex}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBrandKitForm((prev) => ({
                            ...prev,
                            colors: prev.colors.map((c) =>
                              c._localId === color._localId ? { ...c, hex: val } : c
                            ),
                          }));
                        }}
                        className={styles.brandKitColorHex}
                      />
                      <div 
                        className={styles.brandKitColorSwatch} 
                        style={{ backgroundColor: /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color.hex.trim()) ? color.hex.trim() : 'transparent' }}
                      />
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => {
                          setBrandKitForm((prev) => ({
                            ...prev,
                            colors: prev.colors.filter((c) => c._localId !== color._localId),
                          }));
                        }}
                      >
                        <Trash2 size={16} className={styles.brandKitDeleteIcon} />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {brandKitForm.colors.length === 0 && (
                <div className="text-sm text-muted-foreground italic">Nenhuma cor cadastrada.</div>
              )}
            </div>

            {/* B. Tipografia */}
            <div className={styles.brandKitSection}>
              <div className={styles.brandKitSectionHeader}>
                <Label className="text-base font-medium">Tipografia</Label>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setBrandKitForm((prev) => ({
                    ...prev,
                    typography: [...prev.typography, { _localId: generateBrandKitLocalId('typo'), role: '', fontName: '' }],
                  }))}
                >
                  <Plus size={14} className="mr-1" /> Adicionar Tipografia
                </Button>
              </div>
              {brandKitForm.typography.map((typo) => (
                <div key={typo._localId} className={styles.brandKitTypographyRow}>
                  <div className={styles.brandKitTypographyInputs}>
                    <Input 
                      placeholder="Função (Ex: Títulos)" 
                      value={typo.role}
                      onChange={(e) => {
                        const val = e.target.value;
                        setBrandKitForm((prev) => ({
                          ...prev,
                          typography: prev.typography.map((t) =>
                            t._localId === typo._localId ? { ...t, role: val } : t
                          ),
                        }));
                      }}
                      className={styles.brandKitTypographyField}
                    />
                    <div className={styles.brandKitTypographyBottomRow}>
                      <Input 
                        placeholder="Nome da fonte (Ex: Inter)" 
                        value={typo.fontName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBrandKitForm((prev) => ({
                            ...prev,
                            typography: prev.typography.map((t) =>
                              t._localId === typo._localId ? { ...t, fontName: val } : t
                            ),
                          }));
                        }}
                        className={styles.brandKitTypographyField}
                      />
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => {
                          setBrandKitForm((prev) => ({
                            ...prev,
                            typography: prev.typography.filter((t) => t._localId !== typo._localId),
                          }));
                        }}
                      >
                        <Trash2 size={16} className={styles.brandKitDeleteIcon} />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {brandKitForm.typography.length === 0 && (
                <div className="text-sm text-muted-foreground italic">Nenhuma tipografia cadastrada.</div>
              )}
            </div>

            {/* C. Links e arquivos externos */}
            <div className={styles.brandKitSection}>
              <div className={styles.brandKitSectionHeader}>
                <Label className="text-base font-medium">Links e Arquivos Externos</Label>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setBrandKitForm((prev) => ({
                    ...prev,
                    externalLinks: [...prev.externalLinks, { _localId: generateBrandKitLocalId('link'), label: '', url: '', type: '' }],
                  }))}
                >
                  <Plus size={14} className="mr-1" /> Adicionar Link
                </Button>
              </div>
              {brandKitForm.externalLinks.map((link) => (
                <div key={link._localId} className={styles.brandKitLinkRow}>
                  <div className={styles.brandKitLinkInputs}>
                    <div className={styles.brandKitLinkTopFields}>
                      <Input 
                        placeholder="Descrição (Ex: Logotipo oficial)" 
                        value={link.label}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBrandKitForm((prev) => ({
                            ...prev,
                            externalLinks: prev.externalLinks.map((l) =>
                              l._localId === link._localId ? { ...l, label: val } : l
                            ),
                          }));
                        }}
                        className={styles.brandKitLinkLabel}
                      />
                      <Input 
                        placeholder="Tipo (Ex: Logo)" 
                        value={link.type || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBrandKitForm((prev) => ({
                            ...prev,
                            externalLinks: prev.externalLinks.map((l) =>
                              l._localId === link._localId ? { ...l, type: val } : l
                            ),
                          }));
                        }}
                        className={styles.brandKitLinkType}
                      />
                    </div>
                    <div className={styles.brandKitLinkBottomRow}>
                      <Input 
                        placeholder="URL: https://..." 
                        value={link.url}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBrandKitForm((prev) => ({
                            ...prev,
                            externalLinks: prev.externalLinks.map((l) =>
                              l._localId === link._localId ? { ...l, url: val } : l
                            ),
                          }));
                        }}
                        className={styles.brandKitLinkUrl}
                      />
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => {
                          setBrandKitForm((prev) => ({
                            ...prev,
                            externalLinks: prev.externalLinks.filter((l) => l._localId !== link._localId),
                          }));
                        }}
                      >
                        <Trash2 size={16} className={styles.brandKitDeleteIcon} />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {brandKitForm.externalLinks.length === 0 && (
                <div className="text-sm text-muted-foreground italic">Nenhum link externo cadastrado.</div>
              )}
            </div>

            {/* D. Diretrizes da marca */}
            <div className={styles.brandKitSection}>
              <Label htmlFor="brandKitNotes" className="text-base font-medium">Diretrizes gerais da marca</Label>
              <Textarea
                id="brandKitNotes"
                value={brandKitForm.notes}
                onChange={(e) => setBrandKitForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Orientações de identidade visual, restrições de uso, padrões de comunicação..."
                rows={4}
              />
            </div>
            
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={brandKitSaving}>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" onClick={handleSaveBrandKit} disabled={brandKitSaving}>
              {brandKitSaving ? 'Salvando...' : 'Salvar Brand Kit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
