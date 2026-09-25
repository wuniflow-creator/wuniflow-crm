"use client";

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type LeadSummary = {
  id: string;
  name: string;
  company_name: string | null;
  whatsapp: string | null;
  phone: string | null;
  pipeline_stages: { name: string; color: string | null } | null;
};
type TeamMember = {
  user_id: string;
  role: string;
  full_name: string;
  avatar_url: string | null;
};

type WhatsAppTag = {
  id: string;
  name: string;
  color: string;
};

type InternalNote = {
  id: string;
  conversation_id: string;
  body: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ServiceStatus = "new" | "in_progress" | "waiting_customer" | "resolved";

const serviceStatusMeta: Record<ServiceStatus, { label: string; short: string }> = {
  new: { label: "Novo", short: "Novo" },
  in_progress: { label: "Em atendimento", short: "Atendimento" },
  waiting_customer: { label: "Aguardando cliente", short: "Aguardando" },
  resolved: { label: "Resolvido", short: "Resolvido" },
};

type Conversation = {
  id: string;
  contact_name: string | null;
  contact_phone: string;
  contact_avatar_url: string | null;
  lead_id: string | null;
  lead: LeadSummary | null;
  assigned_to: string | null;
  assignee: TeamMember | null;
  tags: WhatsAppTag[];
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  status: string;
  service_status: ServiceStatus;
  service_status_updated_at: string;
};
type Message = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  body: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_filename: string | null;
  status: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
};

const fmtTime = (value: string | null) =>
  value ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";

const normalizePhone = (value: string | null | undefined) => (value || "").replace(/\D/g, "");

const normalizeOutboundPhone = (value: string | null | undefined) => {
  const digits = normalizePhone(value);
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return digits;
};

const fmtListTime = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return fmtTime(value);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
};

const fmtMessageDay = (value: string) => {
  const date = new Date(value);
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === today) return "HOJE";
  if (date.toDateString() === yesterday.toDateString()) return "ONTEM";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined })
    .format(date)
    .replace(".", "")
    .toUpperCase();
};

const messageStatusTitle = (message: Message) => {
  if (message.status === "failed") return "Falha no envio";
  if (message.status === "read" || message.read_at) return "Lida";
  if (message.status === "delivered" || message.delivered_at) return "Entregue";
  return "Enviada";
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  return (bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1) + " MB";
};

const attachmentKind = (file: File) => {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
};

const documentLabel = (mime: string | null) => {
  if (mime === "application/pdf") return "PDF";
  if (mime?.includes("word")) return "DOC";
  if (mime?.includes("sheet") || mime?.includes("excel")) return "XLS";
  if (mime === "text/plain") return "TXT";
  return "DOC";
};

const commonEmojis = [
  "😀","😃","😄","😁","😂","🤣","😊","😍",
  "🥰","😘","😎","🤩","🥳","😅","😉","🤔",
  "👍","👎","👏","🙌","🙏","💪","🤝","👌",
  "❤️","💜","💙","💚","💛","🔥","✨","🎉",
  "✅","❌","⚠️","📌","📞","💬","📅","🚀",
  "👋","🙂","😢","😭","😡","🤯","💡","⭐"
];

const messageState = (m: Message) => {
  if (m.direction === "inbound") return "";
  if (m.status === "read" || m.read_at) return "✓✓";
  if (m.status === "delivered" || m.delivered_at) return "✓✓";
  if (m.status === "failed") return "!";
  return "✓";
};

function Avatar({ name, url, size = "normal" }: { name: string; url: string | null; size?: "normal" | "large" }) {
  const [broken, setBroken] = useState(false);
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <span className={"wa-avatar " + (size === "large" ? "large" : "")}>
      {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : <span>{initial}</span>}
    </span>
  );
}

export default function WhatsAppInbox({
  organizationId,
  onOpenMenu,
  onOpenLead,
  onCreateLead,
}: {
  organizationId: string;
  onOpenMenu?: () => void;
  onOpenLead?: (leadId: string) => void;
  onCreateLead?: (contact: { name: string; phone: string; conversationId: string }) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [conversationFilter, setConversationFilter] = useState<"all" | "mine" | "unread" | "leads" | "archived">("all");
  const [serviceStatusFilter, setServiceStatusFilter] = useState<"all" | ServiceStatus>("all");
  const [changingServiceStatus, setChangingServiceStatus] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [assigningConversation, setAssigningConversation] = useState(false);
  const [availableTags, setAvailableTags] = useState<WhatsAppTag[]>([]);
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#8b5cf6");
  const [tagSaving, setTagSaving] = useState(false);
  const [availableLeads, setAvailableLeads] = useState<LeadSummary[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatName, setNewChatName] = useState("");
  const [newChatPhone, setNewChatPhone] = useState("");
  const [newChatLeadId, setNewChatLeadId] = useState("");
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const avatarTriedRef = useRef<Set<string>>(new Set());
  const avatarSyncBlockedRef = useRef(false);

  const loadConversations = useCallback(async () => {
    if (!supabase) return;

    const [
      { data: conversationData, error: conversationError },
      { data: leadData },
      { data: channelData },
      { data: memberData },
      { data: tagData },
      { data: conversationTagData },
      userResult,
    ] = await Promise.all([
      supabase
        .from("whatsapp_conversations")
        .select("id,contact_name,contact_phone,contact_avatar_url,lead_id,assigned_to,last_message_at,last_message_preview,unread_count,status,service_status,service_status_updated_at")
        .eq("organization_id", organizationId)
        .order("last_message_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("leads")
        .select("id,name,company_name,whatsapp,phone,pipeline_stages(name,color)")
        .eq("organization_id", organizationId)
        .neq("status", "archived")
        .limit(1000),
      supabase
        .from("whatsapp_channels")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("provider", "evolution")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("organization_members")
        .select("user_id,role")
        .eq("organization_id", organizationId)
        .eq("is_active", true),
      supabase
        .from("whatsapp_tags")
        .select("id,name,color")
        .eq("organization_id", organizationId)
        .order("name"),
      supabase
        .from("whatsapp_conversation_tags")
        .select("conversation_id,tag_id")
        .eq("organization_id", organizationId)
        .limit(5000),
      supabase.auth.getUser(),
    ]);

    if (conversationError) return;

    const leads = (leadData || []) as unknown as LeadSummary[];
    setAvailableLeads(leads);
    setActiveChannelId(channelData?.id || null);
    setCurrentUserId(userResult.data.user?.id || null);

    const memberRows = (memberData || []) as { user_id: string; role: string }[];
    const memberIds = memberRows.map((member) => member.user_id);
    let members: TeamMember[] = [];
    if (memberIds.length) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id,full_name,avatar_url,is_active")
        .in("id", memberIds)
        .eq("is_active", true);

      const profileMap = new Map(
        (profileData || []).map((profile) => [profile.id, profile]),
      );
      members = memberRows
        .map((member) => {
          const profile = profileMap.get(member.user_id);
          return {
            user_id: member.user_id,
            role: member.role,
            full_name: profile?.full_name || "Usuário",
            avatar_url: profile?.avatar_url || null,
          };
        })
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"));
    }
    setTeamMembers(members);
    const memberById = new Map(members.map((member) => [member.user_id, member]));

    const tags = (tagData || []) as WhatsAppTag[];
    setAvailableTags(tags);
    const tagById = new Map(tags.map((tag) => [tag.id, tag]));
    const tagsByConversation = new Map<string, WhatsAppTag[]>();
    for (const relation of (conversationTagData || []) as { conversation_id: string; tag_id: string }[]) {
      const tag = tagById.get(relation.tag_id);
      if (!tag) continue;
      const current = tagsByConversation.get(relation.conversation_id) || [];
      current.push(tag);
      tagsByConversation.set(relation.conversation_id, current);
    }

    const leadById = new Map(leads.map((lead) => [lead.id, lead]));
    const phoneMatches = new Map<string, LeadSummary | null>();

    for (const lead of leads) {
      const numbers = [...new Set([normalizePhone(lead.whatsapp), normalizePhone(lead.phone)].filter(Boolean))];
      for (const number of numbers) {
        if (phoneMatches.has(number)) phoneMatches.set(number, null);
        else phoneMatches.set(number, lead);
      }
    }

    const rows = ((conversationData || []) as Omit<Conversation, "lead" | "assignee" | "tags">[]).map((conversation) => ({
      ...conversation,
      lead:
        (conversation.lead_id ? leadById.get(conversation.lead_id) || null : null) ||
        phoneMatches.get(normalizePhone(conversation.contact_phone)) ||
        null,
      assignee: conversation.assigned_to ? memberById.get(conversation.assigned_to) || null : null,
      tags: tagsByConversation.get(conversation.id) || [],
    }));

    setConversations(rows);
  }, [organizationId]);

  const loadMessages = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("id,conversation_id,direction,message_type,body,media_url,media_mime_type,media_filename,status,created_at,delivered_at,read_at")
      .eq("organization_id", organizationId)
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(300);

    const rows = (data || []) as Message[];
    setMessages(rows);

    const paths = [...new Set(rows.filter((message) => message.media_url).map((message) => message.media_url!))];
    if (!paths.length) {
      setMediaUrls({});
      return;
    }

    const { data: signed } = await supabase.storage.from("whatsapp-media").createSignedUrls(paths, 3600);
    const next: Record<string, string> = {};
    signed?.forEach((item, index) => {
      if (item.signedUrl) next[paths[index]] = item.signedUrl;
    });
    setMediaUrls(next);
  }, [organizationId]);

  const loadNotes = useCallback(async (conversationId: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from("whatsapp_conversation_notes")
      .select("id,conversation_id,body,created_by,created_at,updated_at")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(100);
    setNotes((data || []) as InternalNote[]);
  }, [organizationId]);

  const refreshAvatar = useCallback(async (conversation: Conversation) => {
    if (!supabase || avatarSyncBlockedRef.current || conversation.contact_avatar_url || avatarTriedRef.current.has(conversation.id)) return false;
    avatarTriedRef.current.add(conversation.id);
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) return false;

    const { data, error } = await supabase.functions.invoke("whatsapp-contact-profile", {
      body: { conversation_id: conversation.id },
      headers: { Authorization: "Bearer " + token },
    });
    if (error) {
      avatarSyncBlockedRef.current = true;
      return false;
    }
    if (!data?.profile_picture_url) return false;

    setConversations((current) =>
      current.map((item) =>
        item.id === conversation.id ? { ...item, contact_avatar_url: data.profile_picture_url as string } : item,
      ),
    );
    return true;
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const missing = conversations.filter((conversation) => !conversation.contact_avatar_url).slice(0, 5);
    if (!missing.length || avatarSyncBlockedRef.current) return;
    void (async () => {
      for (const conversation of missing) {
        if (avatarSyncBlockedRef.current) break;
        await refreshAvatar(conversation);
      }
    })();
  }, [conversations, refreshAvatar]);

  useEffect(
    () => () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  useEffect(() => {
    if (!attachment) {
      setAttachmentPreviewUrl(null);
      return;
    }

    const kind = attachmentKind(attachment);
    if (kind !== "image" && kind !== "video") {
      setAttachmentPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(attachment);
    setAttachmentPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setNotes([]);
      setEmojiOpen(false);
      setNotesOpen(false);
      setTagMenuOpen(false);
      return;
    }
    void loadMessages(selectedId);
    void loadNotes(selectedId);
    if (supabase) {
      void supabase.rpc("mark_whatsapp_conversation_read", { p_conversation_id: selectedId }).then(() => loadConversations());
    }
  }, [selectedId, loadMessages, loadNotes, loadConversations]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("wa-inbox-" + organizationId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations", filter: "organization_id=eq." + organizationId },
        () => void loadConversations(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages", filter: "organization_id=eq." + organizationId },
        (payload) => {
          const row = payload.new as Message;
          void loadConversations();
          if (row?.conversation_id === selectedId && selectedId) void loadMessages(selectedId);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversation_tags", filter: "organization_id=eq." + organizationId },
        () => void loadConversations(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_tags", filter: "organization_id=eq." + organizationId },
        () => void loadConversations(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversation_notes", filter: "organization_id=eq." + organizationId },
        (payload) => {
          const row = (payload.new || payload.old) as InternalNote;
          if (selectedId && row?.conversation_id === selectedId) void loadNotes(selectedId);
        },
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [organizationId, selectedId, loadConversations, loadMessages, loadNotes]);

  const finishRecordingResources = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const startRecording = async () => {
    if (recording || sending) return;
    setRecordingError(null);
    setSendError(null);

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setRecordingError("Este navegador não oferece gravação de áudio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const preferred = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
      const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type)) || "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setRecordingError("Não foi possível gravar o áudio.");
        setRecording(false);
        finishRecordingResources();
      };
      recorder.onstop = () => {
        const normalized = (recorder.mimeType || mimeType || "audio/webm").toLowerCase().split(";")[0].trim();
        const extension = normalized === "audio/ogg" ? "ogg" : normalized === "audio/mp4" ? "m4a" : normalized === "audio/mpeg" ? "mp3" : "webm";
        const blob = new Blob(recordingChunksRef.current, { type: normalized });
        recordingChunksRef.current = [];
        finishRecordingResources();
        setRecording(false);

        if (!blob.size) {
          setRecordingError("A gravação ficou vazia. Tente novamente.");
          return;
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        setAttachment(new File([blob], "audio-" + stamp + "." + extension, { type: normalized }));
      };

      recorder.start(250);
      setRecordSeconds(0);
      setRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordSeconds((value) => value + 1), 1000);
    } catch (error) {
      finishRecordingResources();
      setRecording(false);
      setRecordingError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Permita o acesso ao microfone para gravar áudio."
          : "Não foi possível acessar o microfone.",
      );
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const recordLabel =
    Math.floor(recordSeconds / 60).toString().padStart(2, "0") +
    ":" +
    (recordSeconds % 60).toString().padStart(2, "0");

  const sendMessage = async () => {
    if (!supabase || !selectedId || (!draft.trim() && !attachment) || sending || recording) return;
    setSending(true);
    setSendError(null);
    const messageText = draft.trim();

    try {
      const sessionResult = await supabase.auth.getSession();
      const token = sessionResult.data.session?.access_token;
      if (!token) {
        setSendError("Sua sessão expirou. Entre novamente no CRM.");
        return;
      }

      let mediaPayload: null | { type: string; path: string; mime_type: string; filename: string } = null;

      if (attachment) {
        if (attachment.size > 25 * 1024 * 1024) {
          setSendError("O anexo deve ter no máximo 25 MB.");
          return;
        }

        const mime = (attachment.type || "application/octet-stream").toLowerCase().split(";")[0].trim();
        const type = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document";
        const allowedMime: Record<string, string[]> = {
          image: ["image/jpeg", "image/png", "image/webp"],
          video: ["video/mp4"],
          audio: ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm"],
          document: [
            "application/pdf",
            "application/octet-stream",
            "text/plain",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ],
        };

        if (!allowedMime[type]?.includes(mime)) {
          setSendError("Formato de anexo não suportado.");
          return;
        }

        const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "arquivo";
        const path = organizationId + "/" + selectedId + "/outbound/" + crypto.randomUUID() + "-" + safeName;
        const upload = await supabase.storage.from("whatsapp-media").upload(path, attachment, { contentType: mime, upsert: false });

        if (upload.error) {
          setSendError("Falha ao preparar anexo: " + upload.error.message);
          return;
        }

        mediaPayload = { type, path, mime_type: mime, filename: safeName };
      }

      const { data, error } = await supabase.functions.invoke("whatsapp-send-message", {
        body: { conversation_id: selectedId, text: messageText, media: mediaPayload },
        headers: { Authorization: "Bearer " + token },
      });

      if (error || !data?.ok) {
        let detail = data?.provider_message || data?.reason || data?.error || "";
        const context = (error as { context?: Response } | null)?.context;
        if (!detail && context) {
          try {
            const payload = await context.clone().json();
            detail = payload?.provider_message || payload?.reason || payload?.error || "";
          } catch {}
        }
        setSendError("Falha no envio" + (detail ? ": " + String(detail) : ". Tente novamente."));
        return;
      }

      setDraft("");
      setEmojiOpen(false);
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadMessages(selectedId);
      await loadConversations();
    } catch (error) {
      setSendError("Falha no envio: " + (error instanceof Error ? error.message : "erro inesperado"));
    } finally {
      setSending(false);
    }
  };

  const selected = conversations.find((item) => item.id === selectedId) || null;

  const startNewChat = (lead?: LeadSummary) => {
    setNewChatError(null);
    setNewChatLeadId(lead?.id || "");
    setNewChatName(lead?.name || "");
    setNewChatPhone(lead?.whatsapp || lead?.phone || "");
    setNewChatOpen(true);
  };

  const createConversation = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !activeChannelId || creatingChat) return;

    const phone = normalizeOutboundPhone(newChatPhone);
    if (phone.length < 10 || phone.length > 15) {
      setNewChatError("Informe um WhatsApp válido com DDD.");
      return;
    }

    const selectedLead = availableLeads.find((lead) => lead.id === newChatLeadId) || null;
    const uniquePhoneMatches = availableLeads.filter((lead) =>
      [lead.whatsapp, lead.phone].some((value) => normalizeOutboundPhone(value) === phone),
    );
    const matchedLead = selectedLead || (uniquePhoneMatches.length === 1 ? uniquePhoneMatches[0] : null);
    const providerConversationId = phone + "@s.whatsapp.net";
    const contactName = newChatName.trim() || matchedLead?.name || phone;

    setCreatingChat(true);
    setNewChatError(null);

    const existing = await supabase
      .from("whatsapp_conversations")
      .select("id,status")
      .eq("organization_id", organizationId)
      .eq("provider", "whatsapp")
      .eq("provider_conversation_id", providerConversationId)
      .maybeSingle();

    if (existing.error) {
      setNewChatError("Não foi possível verificar a conversa.");
      setCreatingChat(false);
      return;
    }

    let conversationId = existing.data?.id || null;

    if (conversationId) {
      const { error } = await supabase
        .from("whatsapp_conversations")
        .update({
          status: "open",
          contact_name: contactName,
          contact_phone: phone,
          lead_id: matchedLead?.id || null,
          channel_id: activeChannelId,
          assigned_to: currentUserId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId)
        .eq("organization_id", organizationId);

      if (error) {
        setNewChatError("Não foi possível reabrir a conversa.");
        setCreatingChat(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .insert({
          organization_id: organizationId,
          channel_id: activeChannelId,
          lead_id: matchedLead?.id || null,
          contact_name: contactName,
          contact_phone: phone,
          provider: "whatsapp",
          provider_conversation_id: providerConversationId,
          status: "open",
          assigned_to: currentUserId,
          metadata: { source: "crm_new_conversation" },
        })
        .select("id")
        .single();

      if (error || !data) {
        setNewChatError("Não foi possível criar a conversa.");
        setCreatingChat(false);
        return;
      }
      conversationId = data.id;
    }

    setNewChatOpen(false);
    setNewChatName("");
    setNewChatPhone("");
    setNewChatLeadId("");
    setCreatingChat(false);
    await loadConversations();
    setConversationFilter("all");
    setSelectedId(conversationId);
  };

  const assignConversation = async (userId: string | null) => {
    if (!supabase || !selected || assigningConversation) return;
    setAssigningConversation(true);
    setSendError(null);

    const { error } = await supabase
      .from("whatsapp_conversations")
      .update({ assigned_to: userId, updated_at: new Date().toISOString() })
      .eq("id", selected.id)
      .eq("organization_id", organizationId);

    if (error) {
      setSendError("Não foi possível alterar o responsável.");
      setAssigningConversation(false);
      return;
    }

    if (selected.lead_id && currentUserId) {
      const nextMember = userId ? teamMembers.find((member) => member.user_id === userId) || null : null;
      await supabase.from("lead_activities").insert({
        organization_id: organizationId,
        lead_id: selected.lead_id,
        activity_type: "assignment",
        title: "Responsável do WhatsApp alterado",
        description: nextMember ? "Atendimento atribuído a " + nextMember.full_name + "." : "Atendimento ficou sem responsável.",
        occurred_at: new Date().toISOString(),
        created_by: currentUserId,
      });
    }

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === selected.id
          ? {
              ...conversation,
              assigned_to: userId,
              assignee: userId ? teamMembers.find((member) => member.user_id === userId) || null : null,
            }
          : conversation,
      ),
    );
    setAssigningConversation(false);
    await loadConversations();
  };

  const saveInternalNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !selected || !currentUserId || noteSaving) return;
    const body = noteDraft.trim();
    if (!body) return;
    if (body.length > 4000) {
      setSendError("A nota interna deve ter no máximo 4.000 caracteres.");
      return;
    }

    setNoteSaving(true);
    const { error } = await supabase.from("whatsapp_conversation_notes").insert({
      organization_id: organizationId,
      conversation_id: selected.id,
      body,
      created_by: currentUserId,
    });

    if (error) {
      setSendError("Não foi possível salvar a nota interna.");
      setNoteSaving(false);
      return;
    }

    setNoteDraft("");
    await loadNotes(selected.id);
    setNoteSaving(false);
  };

  const createTag = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !currentUserId || tagSaving) return;
    const name = newTagName.trim();
    if (!name) return;

    setTagSaving(true);
    const { data, error } = await supabase
      .from("whatsapp_tags")
      .insert({
        organization_id: organizationId,
        name,
        color: newTagColor,
        created_by: currentUserId,
      })
      .select("id,name,color")
      .single();

    if (error || !data) {
      setSendError(error?.code === "23505" ? "Essa etiqueta já existe." : "Não foi possível criar a etiqueta.");
      setTagSaving(false);
      return;
    }

    setNewTagName("");
    setNewTagColor("#8b5cf6");
    await loadConversations();

    if (selected) {
      await supabase.from("whatsapp_conversation_tags").insert({
        organization_id: organizationId,
        conversation_id: selected.id,
        tag_id: data.id,
        created_by: currentUserId,
      });
      await loadConversations();
    }
    setTagSaving(false);
  };

  const toggleTag = async (tagId: string) => {
    if (!supabase || !selected || !currentUserId || tagSaving) return;
    const isAssigned = selected.tags.some((tag) => tag.id === tagId);
    setTagSaving(true);

    const result = isAssigned
      ? await supabase
          .from("whatsapp_conversation_tags")
          .delete()
          .eq("organization_id", organizationId)
          .eq("conversation_id", selected.id)
          .eq("tag_id", tagId)
      : await supabase.from("whatsapp_conversation_tags").insert({
          organization_id: organizationId,
          conversation_id: selected.id,
          tag_id: tagId,
          created_by: currentUserId,
        });

    if (result.error) {
      setSendError("Não foi possível alterar a etiqueta.");
      setTagSaving(false);
      return;
    }

    await loadConversations();
    setTagSaving(false);
  };

  const updateServiceStatus = async (nextStatus: ServiceStatus) => {
    if (!supabase || !selected || changingServiceStatus || selected.service_status === nextStatus) return;
    setChangingServiceStatus(true);
    setSendError(null);

    const { error } = await supabase
      .from("whatsapp_conversations")
      .update({
        service_status: nextStatus,
        service_status_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", selected.id)
      .eq("organization_id", organizationId);

    if (error) {
      setSendError("Não foi possível alterar o status do atendimento.");
      setChangingServiceStatus(false);
      return;
    }

    if (selected.lead_id && currentUserId) {
      await supabase.from("lead_activities").insert({
        organization_id: organizationId,
        lead_id: selected.lead_id,
        activity_type: "status_change",
        title: "Status do atendimento alterado",
        description: serviceStatusMeta[selected.service_status].label + " → " + serviceStatusMeta[nextStatus].label,
        occurred_at: new Date().toISOString(),
        created_by: currentUserId,
      });
    }

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === selected.id
          ? {
              ...conversation,
              service_status: nextStatus,
              service_status_updated_at: new Date().toISOString(),
            }
          : conversation,
      ),
    );

    setChangingServiceStatus(false);
    await loadConversations();
  };

  const toggleConversationArchive = async () => {
    if (!supabase || !selected) return;
    const nextStatus = selected.status === "archived" ? "open" : "archived";
    const { error } = await supabase
      .from("whatsapp_conversations")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", selected.id)
      .eq("organization_id", organizationId);

    if (error) {
      setSendError(nextStatus === "archived" ? "Não foi possível arquivar a conversa." : "Não foi possível reabrir a conversa.");
      return;
    }

    await loadConversations();
    if (nextStatus === "archived") {
      setSelectedId(null);
      setConversationFilter("all");
    }
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((item) => {
      if (conversationFilter === "archived") {
        if (item.status !== "archived") return false;
      } else if (item.status === "archived") {
        return false;
      }
      if (conversationFilter === "mine" && item.assigned_to !== currentUserId) return false;
      if (conversationFilter === "unread" && item.unread_count <= 0) return false;
      if (serviceStatusFilter !== "all" && item.service_status !== serviceStatusFilter) return false;
      if (conversationFilter === "leads" && !item.lead) return false;
      if (!query) return true;
      return [
        item.contact_name,
        item.contact_phone,
        item.last_message_preview,
        item.lead?.name,
        item.lead?.company_name,
        item.lead?.pipeline_stages?.name,
        item.assignee?.full_name,
        ...item.tags.map((tag) => tag.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [conversations, search, conversationFilter, serviceStatusFilter, currentUserId]);

  const previewIcon = (conversation: Conversation) => {
    const preview = conversation.last_message_preview || "Sem mensagens";
    return preview;
  };

  const renderMessageContent = (message: Message) => {
    const signedUrl = message.media_url ? mediaUrls[message.media_url] : null;
    return (
      <>
        {signedUrl && (message.message_type === "image" || message.message_type === "sticker") && (
          <a className="wa-media-open" href={signedUrl} target="_blank" rel="noreferrer" aria-label="Abrir imagem">
            <img className={"wa-media-image " + (message.message_type === "sticker" ? "sticker" : "")} src={signedUrl} alt={message.body || (message.message_type === "sticker" ? "Figurinha" : "Imagem")} />
          </a>
        )}
        {signedUrl && message.message_type === "video" && (
          <video className="wa-media-video" controls playsInline src={signedUrl} />
        )}
        {signedUrl && message.message_type === "audio" && (
          <audio className="wa-media-audio" controls preload="metadata" src={signedUrl} />
        )}
        {signedUrl && message.message_type === "document" && (
          <a className="wa-document-card" href={signedUrl} target="_blank" rel="noreferrer">
            <span className="wa-document-icon">{documentLabel(message.media_mime_type)}</span>
            <span><strong>{message.media_filename || "Documento"}</strong><small>Abrir documento</small></span>
          </a>
        )}
        {message.body && <p>{message.body}</p>}
        {!message.body && !signedUrl && (
          <p className="wa-media-placeholder">
            {message.media_filename ||
              ({
                image: "📷 Imagem",
                audio: "🎵 Áudio",
                video: "🎥 Vídeo",
                document: "📄 Documento",
                sticker: "🏷️ Figurinha",
                location: "📍 Localização",
                contact: "👤 Contato",
              }[message.message_type] || "[" + message.message_type + "]")}
          </p>
        )}
        <small className="wa-message-meta">
          {fmtTime(message.created_at)}
          {message.direction === "outbound" && (
            <span
              className={"wa-message-status " + (message.status === "read" || message.read_at ? "read" : message.status)}
              title={messageStatusTitle(message)}
            >
              {messageState(message)}
            </span>
          )}
        </small>
      </>
    );
  };

  return (
    <section className={"wa-shell " + (selectedId ? "chat-open" : "")}>
      <aside className="wa-list">
        <div className="wa-mobile-topbar">
          <button type="button" className="wa-mobile-menu" onClick={onOpenMenu} aria-label="Abrir menu do CRM">☰</button>
          <strong>WhatsApp</strong>
          <button type="button" className="wa-new-chat-mobile" onClick={() => startNewChat()} aria-label="Nova conversa" title="Nova conversa">＋</button>
        </div>

        <div className="wa-list-head">
          <div>
            <h2>Conversas</h2>
            <small>{conversations.filter((item) => item.status !== "archived").reduce((count, item) => count + item.unread_count, 0)} não lidas</small>
          </div>
          <button type="button" className="wa-new-chat-button" onClick={() => startNewChat()}>+ Nova</button>
        </div>

        <div className="wa-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar conversa" />
        </div>

        <div className="wa-filters" aria-label="Filtros de conversas">
          <button className={conversationFilter === "all" ? "active" : ""} onClick={() => setConversationFilter("all")}>Todas</button>
          <button className={conversationFilter === "mine" ? "active" : ""} onClick={() => setConversationFilter("mine")}>Minhas</button>
          <button className={conversationFilter === "unread" ? "active" : ""} onClick={() => setConversationFilter("unread")}>Não lidas</button>
          <button className={conversationFilter === "leads" ? "active" : ""} onClick={() => setConversationFilter("leads")}>Leads</button>
          <button className={conversationFilter === "archived" ? "active" : ""} onClick={() => setConversationFilter("archived")}>Arquivadas</button>
        </div>

        <div className="wa-service-filter">
          <span>Fila</span>
          <select
            value={serviceStatusFilter}
            onChange={(event) => setServiceStatusFilter(event.target.value as "all" | ServiceStatus)}
            aria-label="Filtrar por status do atendimento"
          >
            <option value="all">Todos os status</option>
            <option value="new">Novo</option>
            <option value="in_progress">Em atendimento</option>
            <option value="waiting_customer">Aguardando cliente</option>
            <option value="resolved">Resolvido</option>
          </select>
        </div>

        <div className="wa-conversations">
          {filtered.length ? (
            filtered.map((conversation) => {
              const displayName = conversation.lead?.name || conversation.contact_name || conversation.contact_phone;
              return (
                <button
                  key={conversation.id}
                  className={"wa-conversation " + (conversation.id === selectedId ? "active" : "")}
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <Avatar name={displayName} url={conversation.contact_avatar_url} size="large" />
                  <span className="wa-copy">
                    <span className="wa-contact-line">
                      <strong>{displayName}</strong>
                      <time>{fmtListTime(conversation.last_message_at)}</time>
                    </span>
                    <span className="wa-preview-line">
                      <small>{previewIcon(conversation)}</small>
                      {conversation.unread_count > 0 && <b>{conversation.unread_count}</b>}
                    </span>
                    <span className={"wa-service-pill " + conversation.service_status}>
                      {serviceStatusMeta[conversation.service_status].short}
                    </span>
                    {conversation.tags.length > 0 && (
                      <span className="wa-list-tags">
                        {conversation.tags.slice(0, 3).map((tag) => (
                          <i key={tag.id} style={{ borderColor: tag.color, color: tag.color }}>{tag.name}</i>
                        ))}
                        {conversation.tags.length > 3 && <i>+{conversation.tags.length - 3}</i>}
                      </span>
                    )}
                    {conversation.assignee && (
                      <span className="wa-assignee-context">👤 {conversation.assignee.full_name}</span>
                    )}
                    {conversation.lead && (
                      <span
                        className="wa-lead-context"
                        role={onOpenLead ? "button" : undefined}
                        onClick={(event) => {
                          if (!onOpenLead) return;
                          event.stopPropagation();
                          onOpenLead(conversation.lead!.id);
                        }}
                      >
                        Lead{conversation.lead.company_name ? " · " + conversation.lead.company_name : ""}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="wa-empty">
              <span>💬</span>
              <strong>Nenhuma conversa</strong>
              <p>As mensagens recebidas aparecerão aqui.</p>
            </div>
          )}
        </div>
      </aside>

      <div className="wa-chat">
        {selected ? (
          <>
            <header className="wa-chat-head">
              <button type="button" className="wa-back" onClick={() => setSelectedId(null)} aria-label="Voltar para conversas">‹</button>
              <Avatar name={selected.lead?.name || selected.contact_name || selected.contact_phone} url={selected.contact_avatar_url} />
              <div className="wa-chat-contact">
                <strong>{selected.lead?.name || selected.contact_name || selected.contact_phone}</strong>
                <small>
                  {selected.lead?.company_name
                    ? selected.lead.company_name + (selected.lead.pipeline_stages?.name ? " · " + selected.lead.pipeline_stages.name : "")
                    : selected.contact_phone}
                </small>
              </div>
              {selected.lead && onOpenLead ? (
                <button type="button" className="wa-lead-action" onClick={() => onOpenLead(selected.lead!.id)}>Ver lead</button>
              ) : onCreateLead ? (
                <button
                  type="button"
                  className="wa-lead-action"
                  onClick={() => onCreateLead({
                    name: selected.contact_name || selected.contact_phone,
                    phone: selected.contact_phone,
                    conversationId: selected.id,
                  })}
                >
                  + Lead
                </button>
              ) : null}
              <button
                type="button"
                className="wa-archive-action"
                onClick={() => void toggleConversationArchive()}
                title={selected.status === "archived" ? "Reabrir conversa" : "Arquivar conversa"}
              >
                {selected.status === "archived" ? "Reabrir" : "Arquivar"}
              </button>
            </header>

            <div className="wa-service-status-bar">
              <span>Status do atendimento</span>
              <div>
                {(Object.keys(serviceStatusMeta) as ServiceStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={(selected.service_status === status ? "active " : "") + status}
                    onClick={() => void updateServiceStatus(status)}
                    disabled={changingServiceStatus}
                  >
                    {serviceStatusMeta[status].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="wa-assignment-bar">
              <div className="wa-assignment-copy">
                <span>Responsável</span>
                <strong>{selected.assignee?.full_name || "Sem responsável"}</strong>
              </div>
              <div className="wa-assignment-actions">
                {!selected.assigned_to && currentUserId && (
                  <button
                    type="button"
                    onClick={() => void assignConversation(currentUserId)}
                    disabled={assigningConversation}
                  >
                    Assumir
                  </button>
                )}
                <select
                  value={selected.assigned_to || ""}
                  onChange={(event) => void assignConversation(event.target.value || null)}
                  disabled={assigningConversation}
                  aria-label="Responsável pela conversa"
                >
                  <option value="">Sem responsável</option>
                  {teamMembers.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.full_name}{member.user_id === currentUserId ? " (você)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="wa-context-bar">
              <div className="wa-context-tags">
                {selected.tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className="wa-tag-chip"
                    style={{ borderColor: tag.color, color: tag.color }}
                    onClick={() => void toggleTag(tag.id)}
                    title="Remover etiqueta"
                  >
                    {tag.name} ×
                  </button>
                ))}
                <button type="button" className="wa-context-add" onClick={() => setTagMenuOpen((value) => !value)}>
                  + Etiqueta
                </button>
              </div>
              <button
                type="button"
                className={"wa-notes-toggle " + (notesOpen ? "active" : "")}
                onClick={() => setNotesOpen((value) => !value)}
              >
                Nota interna{notes.length ? " · " + notes.length : ""}
              </button>

              {tagMenuOpen && (
                <div className="wa-tag-menu">
                  <strong>Etiquetas</strong>
                  <div className="wa-tag-options">
                    {availableTags.length ? availableTags.map((tag) => {
                      const active = selected.tags.some((item) => item.id === tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          className={active ? "active" : ""}
                          onClick={() => void toggleTag(tag.id)}
                          disabled={tagSaving}
                        >
                          <i style={{ background: tag.color }} />
                          {tag.name}
                          <span>{active ? "✓" : "+"}</span>
                        </button>
                      );
                    }) : <small>Nenhuma etiqueta criada.</small>}
                  </div>
                  <form onSubmit={createTag} className="wa-tag-create">
                    <input
                      value={newTagName}
                      onChange={(event) => setNewTagName(event.target.value)}
                      placeholder="Nova etiqueta"
                      maxLength={32}
                    />
                    <input
                      type="color"
                      value={newTagColor}
                      onChange={(event) => setNewTagColor(event.target.value)}
                      aria-label="Cor da etiqueta"
                    />
                    <button type="submit" disabled={tagSaving || !newTagName.trim()}>
                      {tagSaving ? "…" : "Criar"}
                    </button>
                  </form>
                </div>
              )}
            </div>

            {notesOpen && (
              <section className="wa-notes-panel">
                <header>
                  <div>
                    <strong>Notas internas</strong>
                    <small>Visíveis apenas para a equipe do CRM. Não são enviadas ao WhatsApp.</small>
                  </div>
                  <button type="button" onClick={() => setNotesOpen(false)} aria-label="Fechar notas">×</button>
                </header>
                <form onSubmit={saveInternalNote}>
                  <textarea
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder="Escreva uma observação interna sobre este atendimento…"
                    maxLength={4000}
                    rows={3}
                  />
                  <div>
                    <small>{noteDraft.length}/4000</small>
                    <button type="submit" disabled={noteSaving || !noteDraft.trim()}>
                      {noteSaving ? "Salvando…" : "Salvar nota"}
                    </button>
                  </div>
                </form>
                <div className="wa-notes-list">
                  {notes.length ? notes.map((note) => {
                    const author = teamMembers.find((member) => member.user_id === note.created_by);
                    return (
                      <article key={note.id}>
                        <header>
                          <strong>{author?.full_name || "Equipe"}</strong>
                          <time>
                            {new Intl.DateTimeFormat("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(note.created_at))}
                          </time>
                        </header>
                        <p>{note.body}</p>
                      </article>
                    );
                  }) : (
                    <div className="wa-notes-empty">Nenhuma nota interna neste atendimento.</div>
                  )}
                </div>
              </section>
            )}

            <div className="wa-messages">
              {messages.map((message, index) => {
                const previous = index > 0 ? messages[index - 1] : null;
                const showDay = !previous || new Date(previous.created_at).toDateString() !== new Date(message.created_at).toDateString();
                return (
                  <Fragment key={message.id}>
                    {showDay && <div className="wa-day-divider"><span>{fmtMessageDay(message.created_at)}</span></div>}
                    <article className={"wa-bubble " + message.direction}>
                      {renderMessageContent(message)}
                    </article>
                  </Fragment>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {selected.status === "archived" ? (
              <div className="wa-archived-banner">
                <span>Conversa arquivada</span>
                <button type="button" onClick={() => void toggleConversationArchive()}>Reabrir atendimento</button>
              </div>
            ) : (
            <div className="wa-compose-wrap">
              {recording && (
                <div className="wa-recording-status">
                  <span>● Gravando</span>
                  <strong>{recordLabel}</strong>
                  <small>Toque em ■ para finalizar</small>
                </div>
              )}

              {attachment && (
                <div className={"wa-attachment wa-attachment-" + attachmentKind(attachment)}>
                  {attachmentPreviewUrl && attachmentKind(attachment) === "image" && (
                    <img className="wa-attachment-preview" src={attachmentPreviewUrl} alt="" />
                  )}
                  {attachmentPreviewUrl && attachmentKind(attachment) === "video" && (
                    <video className="wa-attachment-preview" src={attachmentPreviewUrl} muted playsInline />
                  )}
                  {!attachmentPreviewUrl && (
                    <span className="wa-attachment-type">
                      {attachmentKind(attachment) === "audio" ? "🎙️" : attachment.type === "application/pdf" ? "PDF" : "📄"}
                    </span>
                  )}
                  <span className="wa-attachment-copy">
                    <strong>{attachment.name}</strong>
                    <small>
                      {attachmentKind(attachment) === "image"
                        ? "Imagem"
                        : attachmentKind(attachment) === "video"
                          ? "Vídeo"
                          : attachmentKind(attachment) === "audio"
                            ? "Áudio"
                            : attachment.type === "application/pdf"
                              ? "PDF"
                              : "Documento"} · {formatBytes(attachment.size)}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="wa-attachment-remove"
                    onClick={() => {
                      setAttachment(null);
                      setRecordingError(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    aria-label="Remover anexo"
                    title="Remover anexo"
                  >
                    ×
                  </button>
                </div>
              )}

              {(recordingError || sendError) && <p className="wa-send-error">{recordingError || sendError}</p>}

              {emojiOpen && (
                <div className="wa-emoji-picker" role="dialog" aria-label="Selecionar emoji">
                  {commonEmojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setDraft((current) => current + emoji)}
                      aria-label={"Inserir " + emoji}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              <div className="wa-compose">
                <input
                  ref={fileInputRef}
                  className="wa-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,audio/ogg,audio/mpeg,audio/mp4,audio/webm,application/pdf,text/plain,.doc,.docx,.xls,.xlsx"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setSendError(null);
                    setRecordingError(null);
                    if (file && file.size > 25 * 1024 * 1024) {
                      setAttachment(null);
                      setSendError("O anexo deve ter no máximo 25 MB.");
                      event.currentTarget.value = "";
                      return;
                    }
                    setAttachment(file);
                  }}
                />

                <button type="button" className="wa-attach" onClick={() => fileInputRef.current?.click()} disabled={sending || recording} title="Anexar arquivo">＋</button>

                <div className="wa-message-field">
                  <button
                    type="button"
                    className={"wa-emoji " + (emojiOpen ? "active" : "")}
                    onClick={() => setEmojiOpen((current) => !current)}
                    disabled={sending || recording}
                    aria-label="Abrir emojis"
                    title="Emojis"
                  >
                    ☺
                  </button>
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    disabled={sending || recording}
                    placeholder={recording ? "Gravando áudio…" : "Mensagem"}
                  />
                </div>

                {draft.trim() || attachment ? (
                  <button type="button" className="wa-send" onClick={() => void sendMessage()} disabled={sending || recording} title="Enviar">
                    {sending ? "…" : "➤"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={"wa-mic " + (recording ? "recording" : "")}
                    onClick={() => (recording ? stopRecording() : void startRecording())}
                    disabled={sending}
                    title={recording ? "Parar gravação" : "Gravar áudio"}
                  >
                    {recording ? "■" : "🎙"}
                  </button>
                )}
              </div>
            </div>
            )}
          </>
        ) : (
          <div className="wa-chat-empty">
            <div className="wa-empty-phone">W</div>
            <strong>WhatsApp Wuniflow</strong>
            <p>Selecione uma conversa para começar.</p>
            <small>Mensagens protegidas pelo acesso do CRM.</small>
          </div>
        )}
      </div>

      {newChatOpen && (
        <div className="wa-new-chat-backdrop" onMouseDown={() => !creatingChat && setNewChatOpen(false)}>
          <section className="wa-new-chat-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <strong>Nova conversa</strong>
                <small>Inicie um atendimento pelo WhatsApp conectado à Wuniflow.</small>
              </div>
              <button type="button" onClick={() => setNewChatOpen(false)} disabled={creatingChat} aria-label="Fechar">×</button>
            </header>
            <form onSubmit={createConversation}>
              <label>
                Lead do CRM
                <select
                  value={newChatLeadId}
                  onChange={(event) => {
                    const leadId = event.target.value;
                    setNewChatLeadId(leadId);
                    const lead = availableLeads.find((item) => item.id === leadId);
                    if (lead) {
                      setNewChatName(lead.name);
                      setNewChatPhone(lead.whatsapp || lead.phone || "");
                    }
                  }}
                >
                  <option value="">Contato avulso</option>
                  {availableLeads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name}{lead.company_name ? " · " + lead.company_name : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nome
                <input value={newChatName} onChange={(event) => setNewChatName(event.target.value)} placeholder="Nome do contato" />
              </label>
              <label>
                WhatsApp
                <input
                  value={newChatPhone}
                  onChange={(event) => setNewChatPhone(event.target.value)}
                  inputMode="tel"
                  placeholder="(61) 99999-9999"
                  required
                />
              </label>
              {newChatError && <p>{newChatError}</p>}
              {!activeChannelId && <p>Canal WhatsApp indisponível no momento.</p>}
              <footer>
                <button type="button" className="secondary" onClick={() => setNewChatOpen(false)} disabled={creatingChat}>Cancelar</button>
                <button type="submit" disabled={creatingChat || !activeChannelId}>{creatingChat ? "Abrindo…" : "Abrir conversa"}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
