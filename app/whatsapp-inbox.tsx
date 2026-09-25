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

type QuickReply = {
  id: string;
  title: string;
  shortcut: string;
  body: string;
  is_active: boolean;
  sort_order: number;
};

type InboxToast = {
  conversationId: string | null;
  title: string;
  preview: string;
};

type InboxMetrics = {
  period_days: number;
  inbound_messages: number;
  outbound_messages: number;
  active_conversations: number;
  inbound_media: number;
  outbound_media: number;
  avg_response_minutes: number | null;
  answered_inbound: number;
  new_count: number;
  in_progress_count: number;
  waiting_count: number;
  resolved_count: number;
  overdue_count: number;
  daily: Array<{ date: string; inbound: number; outbound: number }>;
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
type ServicePriority = "low" | "normal" | "high" | "urgent";
type ChannelHealth = "checking" | "connected" | "connecting" | "disconnected" | "unknown";

type InboxSettings = {
  organization_id: string;
  sla_low_minutes: number;
  sla_normal_minutes: number;
  sla_high_minutes: number;
  sla_urgent_minutes: number;
};

const servicePriorityMeta: Record<ServicePriority, { label: string; short: string }> = {
  low: { label: "Baixa", short: "Baixa" },
  normal: { label: "Normal", short: "Normal" },
  high: { label: "Alta", short: "Alta" },
  urgent: { label: "Urgente", short: "Urgente" },
};

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
  service_priority: ServicePriority;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  awaiting_response_since: string | null;
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

const WEB_PUSH_VAPID_PUBLIC_KEY = "BGy9OhMGvMYkszyUfDUaxMNk6lFqbRZ0MGTNPFvdn0Teq5wVBstG9ZM5wt2p2tfjzqVDpcSmViauY5ihIXGosk4";

const urlBase64ToUint8Array = (value: string) => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
};

const commonEmojis = [
  "😀","😃","😄","😁","😂","🤣","😊","😍",
  "🥰","😘","😎","🤩","🥳","😅","😉","🤔",
  "👍","👎","👏","🙌","🙏","💪","🤝","👌",
  "❤️","💜","💙","💚","💛","🔥","✨","🎉",
  "✅","❌","⚠️","📌","📞","💬","📅","🚀",
  "👋","🙂","😢","😭","😡","🤯","💡","⭐"
];

const formatWaitingTime = (milliseconds: number) => {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  if (minutes < 60) return minutes + " min";
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return hours + "h" + (restMinutes ? " " + restMinutes + "min" : "");
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return days + "d" + (restHours ? " " + restHours + "h" : "");
};

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
  initialConversationId,
  onConversationDeepLinkHandled,
  pwaInstalled = false,
  onInstallPwa,
  onOpenMenu,
  onOpenLead,
  onCreateLead,
}: {
  organizationId: string;
  initialConversationId?: string | null;
  onConversationDeepLinkHandled?: () => void;
  pwaInstalled?: boolean;
  onInstallPwa?: () => void;
  onOpenMenu?: () => void;
  onOpenLead?: (leadId: string) => void;
  onCreateLead?: (contact: { name: string; phone: string; conversationId: string }) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [conversationFilter, setConversationFilter] = useState<"all" | "mine" | "unread" | "leads" | "overdue" | "archived">("all");
  const [serviceStatusFilter, setServiceStatusFilter] = useState<"all" | ServiceStatus>("all");
  const [changingServiceStatus, setChangingServiceStatus] = useState(false);
  const [changingPriority, setChangingPriority] = useState(false);
  const [inboxSettings, setInboxSettings] = useState<InboxSettings | null>(null);
  const [slaSettingsOpen, setSlaSettingsOpen] = useState(false);
  const [slaSettingsSaving, setSlaSettingsSaving] = useState(false);
  const [slaDraft, setSlaDraft] = useState({
    low: 240,
    normal: 120,
    high: 60,
    urgent: 30,
  });
  const [nowTick, setNowTick] = useState(() => Date.now());
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
  const [channelHealth, setChannelHealth] = useState<ChannelHealth>("checking");
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
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [quickReplyTitle, setQuickReplyTitle] = useState("");
  const [quickReplyShortcut, setQuickReplyShortcut] = useState("");
  const [quickReplyBody, setQuickReplyBody] = useState("");
  const [quickReplySaving, setQuickReplySaving] = useState(false);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [messageSearchIndex, setMessageSearchIndex] = useState(0);
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<"default" | "granted" | "denied" | "unsupported">("default");
  const [inboxToast, setInboxToast] = useState<InboxToast | null>(null);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [metricsDays, setMetricsDays] = useState<7 | 30>(30);
  const [metrics, setMetrics] = useState<InboxMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const avatarTriedRef = useRef<Set<string>>(new Set());
  const avatarSyncBlockedRef = useRef(false);
  const conversationsRef = useRef<Conversation[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConversations = useCallback(async () => {
    if (!supabase) return;

    const [
      { data: conversationData, error: conversationError },
      { data: leadData },
      { data: channelData },
      { data: memberData },
      { data: tagData },
      { data: conversationTagData },
      { data: inboxSettingsData },
      { data: quickReplyData },
      userResult,
    ] = await Promise.all([
      supabase
        .from("whatsapp_conversations")
        .select("id,contact_name,contact_phone,contact_avatar_url,lead_id,assigned_to,last_message_at,last_message_preview,unread_count,status,service_status,service_status_updated_at,service_priority,last_inbound_at,last_outbound_at,awaiting_response_since")
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
      supabase
        .from("whatsapp_inbox_settings")
        .select("organization_id,sla_low_minutes,sla_normal_minutes,sla_high_minutes,sla_urgent_minutes")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabase
        .from("whatsapp_quick_replies")
        .select("id,title,shortcut,body,is_active,sort_order")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("sort_order")
        .order("title"),
      supabase.auth.getUser(),
    ]);

    if (conversationError) return;

    const leads = (leadData || []) as unknown as LeadSummary[];
    setAvailableLeads(leads);
    setActiveChannelId(channelData?.id || null);
    setCurrentUserId(userResult.data.user?.id || null);
    setQuickReplies((quickReplyData || []) as QuickReply[]);

    if (inboxSettingsData) {
      const settings = inboxSettingsData as InboxSettings;
      setInboxSettings(settings);
      setSlaDraft({
        low: settings.sla_low_minutes,
        normal: settings.sla_normal_minutes,
        high: settings.sla_high_minutes,
        urgent: settings.sla_urgent_minutes,
      });
    }

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

  const checkChannelHealth = useCallback(async () => {
    if (!supabase || !activeChannelId) {
      setChannelHealth(activeChannelId ? "unknown" : "disconnected");
      return;
    }

    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) {
      setChannelHealth("unknown");
      return;
    }

    const { data, error } = await supabase.functions.invoke("whatsapp-channel-health", {
      body: { channel_id: activeChannelId },
      headers: { Authorization: "Bearer " + token },
    });

    if (error || !data?.ok) {
      setChannelHealth("unknown");
      return;
    }

    const next = String(data.state || "unknown") as ChannelHealth;
    setChannelHealth(["connected", "connecting", "disconnected", "unknown"].includes(next) ? next : "unknown");
  }, [activeChannelId]);

  const loadMessages = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("id,conversation_id,direction,message_type,body,media_url,media_mime_type,media_filename,status,created_at,delivered_at,read_at")
      .eq("organization_id", organizationId)
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(1000);

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
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setNotificationPermission("unsupported");
      setNotificationEnabled(false);
      return;
    }

    const permission = Notification.permission as "default" | "granted" | "denied";
    setNotificationPermission(permission);

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setNotificationEnabled(permission === "granted" && Boolean(subscription));

        if (permission === "granted" && subscription && currentUserId && supabase) {
          const serialized = subscription.toJSON();
          if (serialized.keys?.p256dh && serialized.keys?.auth) {
            await supabase.from("web_push_subscriptions").upsert({
              organization_id: organizationId,
              user_id: currentUserId,
              endpoint: subscription.endpoint,
              p256dh: serialized.keys.p256dh,
              auth: serialized.keys.auth,
              user_agent: navigator.userAgent.slice(0, 500),
              device_name: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "Celular / tablet" : "Computador",
              is_active: true,
              failure_count: 0,
              last_error: null,
              last_seen_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, { onConflict: "endpoint" });
          }
        }
      } catch {
        setNotificationEnabled(false);
      }
    })();
  }, [organizationId, currentUserId]);

  useEffect(() => {
    if (!initialConversationId || !conversations.some((conversation) => conversation.id === initialConversationId)) return;
    setSelectedId(initialConversationId);
    onConversationDeepLinkHandled?.();
  }, [initialConversationId, conversations, onConversationDeepLinkHandled]);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeChannelId) {
      setChannelHealth("disconnected");
      return;
    }

    setChannelHealth("checking");
    void checkChannelHealth();
    const timer = setInterval(() => void checkChannelHealth(), 60000);
    return () => clearInterval(timer);
  }, [activeChannelId, checkChannelHealth]);

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
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
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

  const showInboundNotification = useCallback((message: Message) => {
    if (message.direction !== "inbound") return;

    const conversation = conversationsRef.current.find((item) => item.id === message.conversation_id);
    const title = conversation?.lead?.name || conversation?.contact_name || conversation?.contact_phone || "Nova mensagem";
    const preview =
      message.body ||
      ({
        image: "📷 Imagem",
        audio: "🎵 Áudio",
        video: "🎥 Vídeo",
        document: "📄 Documento",
        sticker: "🏷️ Figurinha",
        location: "📍 Localização",
        contact: "👤 Contato",
      }[message.message_type] || "Nova mensagem");

    if (message.conversation_id !== selectedIdRef.current) {
      setInboxToast({ conversationId: message.conversation_id, title, preview });
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setInboxToast(null), 6500);
    }

  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setNotes([]);
      setEmojiOpen(false);
      setNotesOpen(false);
      setTagMenuOpen(false);
      setQuickReplyOpen(false);
      setMessageSearchOpen(false);
      setMessageSearch("");
      setMessageSearchIndex(0);
      return;
    }
    void loadMessages(selectedId);
    void loadNotes(selectedId);
    if (supabase) {
      void (async () => {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        let providerCallFailed = !token;

        if (token) {
          const { error } = await supabase.functions.invoke("whatsapp-mark-read", {
            body: { conversation_id: selectedId },
            headers: { Authorization: "Bearer " + token },
          });
          providerCallFailed = Boolean(error);
        }

        // Provider read sync is best-effort; never leave the CRM unread if it fails.
        if (providerCallFailed) {
          await supabase.rpc("mark_whatsapp_conversation_read", {
            p_conversation_id: selectedId,
          });
        }

        await loadConversations();
      })();
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
          if (payload.eventType === "INSERT" && row?.direction === "inbound") showInboundNotification(row);
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_inbox_settings", filter: "organization_id=eq." + organizationId },
        () => void loadConversations(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_quick_replies", filter: "organization_id=eq." + organizationId },
        () => void loadConversations(),
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [organizationId, selectedId, loadConversations, loadMessages, loadNotes, showInboundNotification]);

  const toggleNotifications = async () => {
    if (!supabase || !currentUserId || typeof window === "undefined") {
      setInboxToast({
        conversationId: null,
        title: "Ainda carregando",
        preview: "Aguarde alguns segundos e tente ativar o Web Push novamente.",
      });
      return;
    }

    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setNotificationPermission("unsupported");
      setInboxToast({
        conversationId: null,
        title: "Este navegador não oferece Web Push",
        preview: "Abra o CRM no Google Chrome. Se estiver dentro de outro aplicativo, use “Abrir no Chrome”.",
      });
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setInboxToast(null), 8000);
      return;
    }

    if (notificationBusy) return;
    setNotificationBusy(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (notificationEnabled) {
        if (subscription) {
          await supabase
            .from("web_push_subscriptions")
            .delete()
            .eq("user_id", currentUserId)
            .eq("endpoint", subscription.endpoint);
          await subscription.unsubscribe();
        }
        setNotificationEnabled(false);
        return;
      }

      let permission = Notification.permission as "default" | "granted" | "denied";
      if (permission !== "granted") {
        permission = await Notification.requestPermission() as "default" | "granted" | "denied";
        setNotificationPermission(permission);
      }

      if (permission !== "granted") {
        setNotificationEnabled(false);
        return;
      }

      subscription = subscription || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(WEB_PUSH_VAPID_PUBLIC_KEY),
      });

      const serialized = subscription.toJSON();
      if (!serialized.keys?.p256dh || !serialized.keys?.auth) {
        throw new Error("push_keys_missing");
      }

      const { error } = await supabase.from("web_push_subscriptions").upsert({
        organization_id: organizationId,
        user_id: currentUserId,
        endpoint: subscription.endpoint,
        p256dh: serialized.keys.p256dh,
        auth: serialized.keys.auth,
        user_agent: navigator.userAgent.slice(0, 500),
        device_name: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "Celular / tablet" : "Computador",
        is_active: true,
        failure_count: 0,
        last_error: null,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });

      if (error) {
        await subscription.unsubscribe().catch(() => false);
        throw error;
      }

      setNotificationPermission("granted");
      setNotificationEnabled(true);
      setInboxToast({
        conversationId: null,
        title: "Web Push ativado",
        preview: "Você receberá novas mensagens mesmo com o CRM fechado.",
      });
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setInboxToast(null), 5000);
    } catch {
      setNotificationEnabled(false);
      setInboxToast({
        conversationId: null,
        title: "Não foi possível ativar o Web Push",
        preview: "No iPhone/iPad, instale o Wuniflow CRM na Tela de Início antes de ativar as notificações.",
      });
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setInboxToast(null), 7000);
    } finally {
      setNotificationBusy(false);
    }
  };

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
  const currentMember = teamMembers.find((member) => member.user_id === currentUserId) || null;
  const canManageSla = ["owner", "admin", "manager"].includes(currentMember?.role || "");
  const canManageQuickReplies = ["owner", "admin", "manager"].includes(currentMember?.role || "");
  const canViewMetrics = ["owner", "admin", "manager"].includes(currentMember?.role || "");

  const messageSearchMatches = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();
    if (!query) return [] as Message[];
    return messages.filter((message) =>
      [message.body, message.media_filename, message.message_type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [messages, messageSearch]);

  useEffect(() => {
    setMessageSearchIndex(0);
  }, [messageSearch, selectedId]);

  const goToSearchResult = useCallback((index: number) => {
    if (!messageSearchMatches.length) return;
    const normalized = ((index % messageSearchMatches.length) + messageSearchMatches.length) % messageSearchMatches.length;
    setMessageSearchIndex(normalized);
    requestAnimationFrame(() => {
      document.getElementById("wa-message-" + messageSearchMatches[normalized].id)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [messageSearchMatches]);

  const expandQuickReply = (body: string) =>
    body
      .replaceAll("{{nome}}", selected?.lead?.name || selected?.contact_name || selected?.contact_phone || "")
      .replaceAll("{{empresa}}", selected?.lead?.company_name || "")
      .replaceAll("{{responsavel}}", currentMember?.full_name || "");

  const filteredQuickReplies = useMemo(() => {
    const slash = draft.trim().startsWith("/") ? draft.trim().toLowerCase() : "";
    if (!slash) return quickReplies;
    return quickReplies.filter((reply) =>
      reply.shortcut.toLowerCase().startsWith(slash) ||
      reply.title.toLowerCase().includes(slash.slice(1)),
    );
  }, [quickReplies, draft]);

  const loadMetrics = useCallback(async (days: 7 | 30) => {
    if (!supabase) return;
    setMetricsLoading(true);
    setMetricsError(null);

    const { data, error } = await supabase.rpc("get_whatsapp_inbox_metrics", {
      p_organization_id: organizationId,
      p_days: days,
    });

    if (error || !data) {
      setMetricsError("Não foi possível carregar as métricas do Inbox.");
      setMetricsLoading(false);
      return;
    }

    setMetrics(data as InboxMetrics);
    setMetricsLoading(false);
  }, [organizationId]);

  const openMetrics = () => {
    setMetricsOpen(true);
    void loadMetrics(metricsDays);
  };

  const formatMetricMinutes = (value: number | null) => {
    if (value === null || !Number.isFinite(value)) return "—";
    if (value < 60) return Math.round(value) + " min";
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value % 60);
    if (hours < 24) return hours + "h" + (minutes ? " " + minutes + "min" : "");
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return days + "d" + (restHours ? " " + restHours + "h" : "");
  };

  const getSlaLimitMinutes = useCallback((priority: ServicePriority) => {
    if (!inboxSettings) {
      return priority === "low" ? 240 : priority === "normal" ? 120 : priority === "high" ? 60 : 30;
    }
    if (priority === "low") return inboxSettings.sla_low_minutes;
    if (priority === "high") return inboxSettings.sla_high_minutes;
    if (priority === "urgent") return inboxSettings.sla_urgent_minutes;
    return inboxSettings.sla_normal_minutes;
  }, [inboxSettings]);

  const getSlaState = useCallback((conversation: Conversation) => {
    const active =
      Boolean(conversation.awaiting_response_since) &&
      conversation.status !== "archived" &&
      conversation.service_status !== "waiting_customer" &&
      conversation.service_status !== "resolved";

    if (!active || !conversation.awaiting_response_since) {
      return { active: false, overdue: false, elapsedMs: 0, limitMinutes: getSlaLimitMinutes(conversation.service_priority) };
    }

    const elapsedMs = Math.max(0, nowTick - new Date(conversation.awaiting_response_since).getTime());
    const limitMinutes = getSlaLimitMinutes(conversation.service_priority);
    return {
      active: true,
      overdue: elapsedMs >= limitMinutes * 60000,
      elapsedMs,
      limitMinutes,
    };
  }, [getSlaLimitMinutes, nowTick]);

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

  const createQuickReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !currentUserId || !canManageQuickReplies || quickReplySaving) return;

    const title = quickReplyTitle.trim();
    let shortcut = quickReplyShortcut.trim().toLowerCase();
    const body = quickReplyBody.trim();
    if (!shortcut.startsWith("/")) shortcut = "/" + shortcut;
    shortcut = shortcut.replace(/[^/a-z0-9_-]/g, "");

    if (!title || !body || !/^\/[a-z0-9_-]{1,32}$/.test(shortcut)) {
      setSendError("Informe título, mensagem e um atalho válido, como /orcamento.");
      return;
    }

    setQuickReplySaving(true);
    const { error } = await supabase.from("whatsapp_quick_replies").insert({
      organization_id: organizationId,
      title,
      shortcut,
      body,
      created_by: currentUserId,
    });

    if (error) {
      setSendError(error.code === "23505" ? "Esse atalho já existe." : "Não foi possível criar a resposta rápida.");
      setQuickReplySaving(false);
      return;
    }

    setQuickReplyTitle("");
    setQuickReplyShortcut("");
    setQuickReplyBody("");
    setQuickReplySaving(false);
    await loadConversations();
  };

  const deleteQuickReply = async (replyId: string) => {
    if (!supabase || !canManageQuickReplies || quickReplySaving) return;
    setQuickReplySaving(true);
    const { error } = await supabase
      .from("whatsapp_quick_replies")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", replyId);
    if (error) setSendError("Não foi possível excluir a resposta rápida.");
    setQuickReplySaving(false);
    await loadConversations();
  };

  const useQuickReply = (reply: QuickReply) => {
    setDraft(expandQuickReply(reply.body));
    setQuickReplyOpen(false);
    setEmojiOpen(false);
  };

  const updateServicePriority = async (nextPriority: ServicePriority) => {
    if (!supabase || !selected || changingPriority || selected.service_priority === nextPriority) return;
    setChangingPriority(true);
    setSendError(null);

    const { error } = await supabase
      .from("whatsapp_conversations")
      .update({
        service_priority: nextPriority,
        updated_at: new Date().toISOString(),
      })
      .eq("id", selected.id)
      .eq("organization_id", organizationId);

    if (error) {
      setSendError("Não foi possível alterar a prioridade do atendimento.");
      setChangingPriority(false);
      return;
    }

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === selected.id
          ? { ...conversation, service_priority: nextPriority }
          : conversation,
      ),
    );

    setChangingPriority(false);
    await loadConversations();
  };

  const saveSlaSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !currentUserId || !canManageSla || slaSettingsSaving) return;

    const values = [slaDraft.low, slaDraft.normal, slaDraft.high, slaDraft.urgent];
    if (values.some((value) => !Number.isFinite(value) || value < 5 || value > 10080)) {
      setSendError("Os tempos de SLA devem ficar entre 5 minutos e 7 dias.");
      return;
    }

    setSlaSettingsSaving(true);
    setSendError(null);

    const payload = {
      organization_id: organizationId,
      sla_low_minutes: Math.round(slaDraft.low),
      sla_normal_minutes: Math.round(slaDraft.normal),
      sla_high_minutes: Math.round(slaDraft.high),
      sla_urgent_minutes: Math.round(slaDraft.urgent),
      created_by: currentUserId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("whatsapp_inbox_settings")
      .upsert(payload, { onConflict: "organization_id" })
      .select("organization_id,sla_low_minutes,sla_normal_minutes,sla_high_minutes,sla_urgent_minutes")
      .single();

    if (error || !data) {
      setSendError("Não foi possível salvar as configurações de SLA.");
      setSlaSettingsSaving(false);
      return;
    }

    setInboxSettings(data as InboxSettings);
    setSlaSettingsOpen(false);
    setSlaSettingsSaving(false);
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
    const priorityRank: Record<ServicePriority, number> = { urgent: 4, high: 3, normal: 2, low: 1 };

    return conversations
      .filter((item) => {
        if (conversationFilter === "archived") {
          if (item.status !== "archived") return false;
        } else if (item.status === "archived") {
          return false;
        }
        if (conversationFilter === "mine" && item.assigned_to !== currentUserId) return false;
        if (conversationFilter === "unread" && item.unread_count <= 0) return false;
        if (conversationFilter === "overdue" && !getSlaState(item).overdue) return false;
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
          servicePriorityMeta[item.service_priority].label,
          ...item.tags.map((tag) => tag.name),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => {
        const aSla = getSlaState(a);
        const bSla = getSlaState(b);
        if (aSla.overdue !== bSla.overdue) return aSla.overdue ? -1 : 1;

        const priorityDiff = priorityRank[b.service_priority] - priorityRank[a.service_priority];
        if (priorityDiff !== 0) return priorityDiff;

        if (aSla.active !== bSla.active) return aSla.active ? -1 : 1;
        if (aSla.active && bSla.active && aSla.elapsedMs !== bSla.elapsedMs) {
          return bSla.elapsedMs - aSla.elapsedMs;
        }

        return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime();
      });
  }, [conversations, search, conversationFilter, serviceStatusFilter, currentUserId, getSlaState]);

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
      {inboxToast && (
        <button
          type="button"
          className="wa-inbox-toast"
          onClick={() => {
            if (inboxToast.conversationId) setSelectedId(inboxToast.conversationId);
            setInboxToast(null);
          }}
        >
          <span>💬</span>
          <span>
            <strong>{inboxToast.title}</strong>
            <small>{inboxToast.preview}</small>
          </span>
          <i>→</i>
        </button>
      )}
      <aside className="wa-list">
        <div className="wa-mobile-topbar">
          <button type="button" className="wa-mobile-menu" onClick={onOpenMenu} aria-label="Abrir menu do CRM">☰</button>
          <span className="wa-mobile-title">
            <strong>WhatsApp</strong>
            <i className={"wa-health-dot " + channelHealth} title={"Canal " + channelHealth} />
          </span>
          <span className="wa-mobile-top-actions">
            {!pwaInstalled && onInstallPwa && (
              <button type="button" className="wa-mobile-install" onClick={onInstallPwa} aria-label="Instalar Wuniflow CRM" title="Instalar Wuniflow CRM">⬇</button>
            )}
            {canViewMetrics && (
              <button type="button" className="wa-mobile-metrics" onClick={openMetrics} aria-label="Métricas do Inbox" title="Métricas do Inbox">▦</button>
            )}
            {canManageSla && (
              <button type="button" className="wa-mobile-sla" onClick={() => setSlaSettingsOpen(true)} aria-label="Configurar SLA" title="Configurar SLA">⏱</button>
            )}
            <button type="button" className="wa-new-chat-mobile" onClick={() => startNewChat()} aria-label="Nova conversa" title="Nova conversa">＋</button>
          </span>
        </div>

        <div className="wa-list-head">
          <div>
            <h2>Conversas</h2>
            <small>{conversations.filter((item) => item.status !== "archived").reduce((count, item) => count + item.unread_count, 0)} não lidas</small>
            <button
              type="button"
              className={"wa-channel-health " + channelHealth}
              onClick={() => void checkChannelHealth()}
              title="Verificar conexão do WhatsApp"
            >
              <i />
              {channelHealth === "connected"
                ? "Conectado"
                : channelHealth === "connecting"
                  ? "Conectando"
                  : channelHealth === "disconnected"
                    ? "Desconectado"
                    : channelHealth === "checking"
                      ? "Verificando"
                      : "Status indisponível"}
            </button>
          </div>
          <div className="wa-list-head-actions">
            {canViewMetrics && (
              <button type="button" className="wa-metrics-button" onClick={openMetrics}>Métricas</button>
            )}
            <button
              type="button"
              className={"wa-notification-toggle " + (notificationEnabled ? "active" : "")}
              onClick={() => void toggleNotifications()}
              title={
                notificationPermission === "unsupported"
                  ? "Notificações não suportadas neste navegador"
                  : notificationEnabled
                    ? "Desativar Web Push neste dispositivo"
                    : "Ativar Web Push neste dispositivo"
              }
              disabled={notificationBusy}
            >
              {notificationBusy ? "…" : notificationEnabled ? "🔔" : "🔕"}
            </button>
            {canManageSla && (
              <button type="button" className="wa-sla-settings-button" onClick={() => setSlaSettingsOpen(true)}>SLA</button>
            )}
            <button type="button" className="wa-new-chat-button" onClick={() => startNewChat()}>+ Nova</button>
          </div>
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
          <button className={conversationFilter === "overdue" ? "active" : ""} onClick={() => setConversationFilter("overdue")}>
            Atrasadas
            {conversations.filter((item) => item.status !== "archived" && getSlaState(item).overdue).length > 0 && (
              <b>{conversations.filter((item) => item.status !== "archived" && getSlaState(item).overdue).length}</b>
            )}
          </button>
          <button className={conversationFilter === "archived" ? "active" : ""} onClick={() => setConversationFilter("archived")}>Arquivadas</button>
        </div>

        <div className="wa-queue-summary">
          <button type="button" onClick={() => { setConversationFilter("all"); setServiceStatusFilter("new"); }}>
            <strong>{conversations.filter((item) => item.status !== "archived" && item.service_status === "new").length}</strong>
            <span>Novos</span>
          </button>
          <button type="button" onClick={() => { setConversationFilter("all"); setServiceStatusFilter("in_progress"); }}>
            <strong>{conversations.filter((item) => item.status !== "archived" && item.service_status === "in_progress").length}</strong>
            <span>Atendimento</span>
          </button>
          <button type="button" onClick={() => { setConversationFilter("all"); setServiceStatusFilter("waiting_customer"); }}>
            <strong>{conversations.filter((item) => item.status !== "archived" && item.service_status === "waiting_customer").length}</strong>
            <span>Aguardando</span>
          </button>
          <button type="button" className={conversations.some((item) => item.status !== "archived" && getSlaState(item).overdue) ? "alert" : ""} onClick={() => { setConversationFilter("overdue"); setServiceStatusFilter("all"); }}>
            <strong>{conversations.filter((item) => item.status !== "archived" && getSlaState(item).overdue).length}</strong>
            <span>Atrasadas</span>
          </button>
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
                    <span className="wa-operational-line">
                      <span className={"wa-service-pill " + conversation.service_status}>
                        {serviceStatusMeta[conversation.service_status].short}
                      </span>
                      <span className={"wa-priority-pill " + conversation.service_priority}>
                        {servicePriorityMeta[conversation.service_priority].short}
                      </span>
                      {getSlaState(conversation).active && (
                        <span className={"wa-sla-pill " + (getSlaState(conversation).overdue ? "overdue" : "running")}>
                          {getSlaState(conversation).overdue ? "SLA atrasado · " : "Aguardando · "}
                          {formatWaitingTime(getSlaState(conversation).elapsedMs)}
                        </span>
                      )}
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
                className={"wa-chat-search-toggle " + (messageSearchOpen ? "active" : "")}
                onClick={() => setMessageSearchOpen((value) => !value)}
                title="Buscar nesta conversa"
                aria-label="Buscar nesta conversa"
              >
                ⌕
              </button>
              <button
                type="button"
                className="wa-archive-action"
                onClick={() => void toggleConversationArchive()}
                title={selected.status === "archived" ? "Reabrir conversa" : "Arquivar conversa"}
              >
                {selected.status === "archived" ? "Reabrir" : "Arquivar"}
              </button>
            </header>

            {messageSearchOpen && (
              <div className="wa-message-search">
                <span>⌕</span>
                <input
                  value={messageSearch}
                  onChange={(event) => setMessageSearch(event.target.value)}
                  placeholder="Buscar texto ou arquivo nesta conversa"
                  autoFocus
                />
                <small>
                  {messageSearch.trim()
                    ? messageSearchMatches.length
                      ? (messageSearchIndex + 1) + "/" + messageSearchMatches.length
                      : "0 resultados"
                    : "Digite para buscar"}
                </small>
                <button type="button" onClick={() => goToSearchResult(messageSearchIndex - 1)} disabled={!messageSearchMatches.length} title="Resultado anterior">↑</button>
                <button type="button" onClick={() => goToSearchResult(messageSearchIndex + 1)} disabled={!messageSearchMatches.length} title="Próximo resultado">↓</button>
                <button type="button" onClick={() => { setMessageSearchOpen(false); setMessageSearch(""); }} title="Fechar busca">×</button>
              </div>
            )}

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

            <div className="wa-priority-bar">
              <div>
                <span>Prioridade</span>
                <select
                  value={selected.service_priority}
                  onChange={(event) => void updateServicePriority(event.target.value as ServicePriority)}
                  disabled={changingPriority}
                  aria-label="Prioridade do atendimento"
                >
                  <option value="low">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>
              {getSlaState(selected).active ? (
                <strong className={getSlaState(selected).overdue ? "overdue" : ""}>
                  {getSlaState(selected).overdue ? "SLA atrasado" : "Aguardando resposta"} · {formatWaitingTime(getSlaState(selected).elapsedMs)}
                  <small>Meta: {getSlaState(selected).limitMinutes} min</small>
                </strong>
              ) : (
                <strong className="idle">Sem SLA correndo</strong>
              )}
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
                    <article
                      id={"wa-message-" + message.id}
                      className={
                        "wa-bubble " + message.direction +
                        (messageSearchMatches.some((item) => item.id === message.id) ? " search-match" : "") +
                        (messageSearchMatches[messageSearchIndex]?.id === message.id && messageSearch.trim() ? " search-current" : "")
                      }
                    >
                      {renderMessageContent(message)}
                    </article>
                  </Fragment>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {channelHealth === "disconnected" && selected.status !== "archived" && (
              <div className="wa-channel-warning">
                <span>WhatsApp desconectado. As mensagens podem não ser enviadas até a sessão voltar.</span>
                <button type="button" onClick={() => void checkChannelHealth()}>Verificar novamente</button>
              </div>
            )}

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

              {quickReplyOpen && (
                <div className="wa-quick-replies" role="dialog" aria-label="Respostas rápidas">
                  <header>
                    <div>
                      <strong>Respostas rápidas</strong>
                      <small>Use um atalho como /orcamento ou toque na resposta.</small>
                    </div>
                    <button type="button" onClick={() => setQuickReplyOpen(false)} aria-label="Fechar">×</button>
                  </header>
                  <div className="wa-quick-reply-list">
                    {filteredQuickReplies.length ? filteredQuickReplies.map((reply) => (
                      <div key={reply.id} className="wa-quick-reply-item">
                        <button type="button" onClick={() => useQuickReply(reply)}>
                          <span><strong>{reply.title}</strong><i>{reply.shortcut}</i></span>
                          <small>{reply.body}</small>
                        </button>
                        {canManageQuickReplies && (
                          <button
                            type="button"
                            className="wa-quick-reply-delete"
                            onClick={() => void deleteQuickReply(reply.id)}
                            disabled={quickReplySaving}
                            title="Excluir resposta rápida"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    )) : (
                      <div className="wa-quick-reply-empty">Nenhuma resposta rápida encontrada.</div>
                    )}
                  </div>
                  {canManageQuickReplies && (
                    <form className="wa-quick-reply-create" onSubmit={createQuickReply}>
                      <strong>Nova resposta</strong>
                      <div>
                        <input value={quickReplyTitle} onChange={(event) => setQuickReplyTitle(event.target.value)} placeholder="Título" maxLength={80} />
                        <input value={quickReplyShortcut} onChange={(event) => setQuickReplyShortcut(event.target.value)} placeholder="/atalho" maxLength={33} />
                      </div>
                      <textarea
                        value={quickReplyBody}
                        onChange={(event) => setQuickReplyBody(event.target.value)}
                        placeholder="Mensagem. Variáveis: {{nome}}, {{empresa}}, {{responsavel}}"
                        maxLength={4096}
                        rows={3}
                      />
                      <button type="submit" disabled={quickReplySaving || !quickReplyTitle.trim() || !quickReplyShortcut.trim() || !quickReplyBody.trim()}>
                        {quickReplySaving ? "Salvando…" : "Criar resposta rápida"}
                      </button>
                    </form>
                  )}
                </div>
              )}

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
                <button
                  type="button"
                  className={"wa-quick-reply-trigger " + (quickReplyOpen ? "active" : "")}
                  onClick={() => { setQuickReplyOpen((value) => !value); setEmojiOpen(false); }}
                  disabled={sending || recording}
                  title="Respostas rápidas"
                  aria-label="Respostas rápidas"
                >
                  ⚡
                </button>

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
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft(value);
                      if (value.trim().startsWith("/")) {
                        setQuickReplyOpen(true);
                        setEmojiOpen(false);
                      }
                    }}
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

      {metricsOpen && (
        <div className="wa-new-chat-backdrop" onMouseDown={() => !metricsLoading && setMetricsOpen(false)}>
          <section className="wa-new-chat-modal wa-metrics-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <strong>Métricas do WhatsApp Inbox</strong>
                <small>Visão operacional do atendimento da organização.</small>
              </div>
              <button type="button" onClick={() => setMetricsOpen(false)} aria-label="Fechar métricas">×</button>
            </header>

            <div className="wa-metrics-toolbar">
              <div>
                <button
                  type="button"
                  className={metricsDays === 7 ? "active" : ""}
                  onClick={() => { setMetricsDays(7); void loadMetrics(7); }}
                >
                  7 dias
                </button>
                <button
                  type="button"
                  className={metricsDays === 30 ? "active" : ""}
                  onClick={() => { setMetricsDays(30); void loadMetrics(30); }}
                >
                  30 dias
                </button>
              </div>
              <button type="button" onClick={() => void loadMetrics(metricsDays)} disabled={metricsLoading}>Atualizar</button>
            </div>

            {metricsLoading && !metrics ? (
              <div className="wa-metrics-loading">Carregando métricas…</div>
            ) : metricsError ? (
              <div className="wa-metrics-error">{metricsError}</div>
            ) : metrics ? (
              <div className="wa-metrics-content">
                <div className="wa-metrics-cards">
                  <article><span>Recebidas</span><strong>{metrics.inbound_messages}</strong><small>mensagens no período</small></article>
                  <article><span>Enviadas</span><strong>{metrics.outbound_messages}</strong><small>mensagens no período</small></article>
                  <article><span>Conversas</span><strong>{metrics.active_conversations}</strong><small>movimentadas no período</small></article>
                  <article><span>Resposta média</span><strong>{formatMetricMinutes(metrics.avg_response_minutes)}</strong><small>{metrics.answered_inbound} mensagens respondidas</small></article>
                </div>

                <div className="wa-metrics-queue">
                  <article><strong>{metrics.new_count}</strong><span>Novos</span></article>
                  <article><strong>{metrics.in_progress_count}</strong><span>Em atendimento</span></article>
                  <article><strong>{metrics.waiting_count}</strong><span>Aguardando cliente</span></article>
                  <article className={metrics.overdue_count ? "alert" : ""}><strong>{metrics.overdue_count}</strong><span>SLA atrasado</span></article>
                  <article><strong>{metrics.resolved_count}</strong><span>Resolvidos</span></article>
                </div>

                <section className="wa-metrics-volume">
                  <header>
                    <div>
                      <strong>Volume diário</strong>
                      <small>Recebidas e enviadas por dia.</small>
                    </div>
                    <span>{metrics.inbound_media + metrics.outbound_media} mídias no período</span>
                  </header>
                  <div>
                    {metrics.daily.slice(-14).map((day) => {
                      const max = Math.max(1, ...metrics.daily.map((item) => item.inbound + item.outbound));
                      const inboundWidth = Math.max(2, Math.round((day.inbound / max) * 100));
                      const outboundWidth = Math.max(2, Math.round((day.outbound / max) * 100));
                      return (
                        <article key={day.date}>
                          <time>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(day.date + "T12:00:00"))}</time>
                          <span className="wa-metric-bars">
                            <i className="inbound" style={{ width: inboundWidth + "%" }} title={day.inbound + " recebidas"} />
                            <i className="outbound" style={{ width: outboundWidth + "%" }} title={day.outbound + " enviadas"} />
                          </span>
                          <small>{day.inbound} / {day.outbound}</small>
                        </article>
                      );
                    })}
                  </div>
                  <footer><span>Recebidas / Enviadas</span></footer>
                </section>
              </div>
            ) : null}
          </section>
        </div>
      )}

      {slaSettingsOpen && (
        <div className="wa-new-chat-backdrop" onMouseDown={() => !slaSettingsSaving && setSlaSettingsOpen(false)}>
          <section className="wa-new-chat-modal wa-sla-settings-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <strong>Configuração de SLA</strong>
                <small>Tempo máximo para a equipe responder uma nova mensagem do cliente.</small>
              </div>
              <button type="button" onClick={() => setSlaSettingsOpen(false)} disabled={slaSettingsSaving} aria-label="Fechar">×</button>
            </header>
            <form onSubmit={saveSlaSettings}>
              <div className="wa-sla-grid">
                <label>
                  Prioridade baixa
                  <input type="number" min={5} max={10080} value={slaDraft.low} onChange={(event) => setSlaDraft((current) => ({ ...current, low: Number(event.target.value) }))} />
                  <small>minutos</small>
                </label>
                <label>
                  Prioridade normal
                  <input type="number" min={5} max={10080} value={slaDraft.normal} onChange={(event) => setSlaDraft((current) => ({ ...current, normal: Number(event.target.value) }))} />
                  <small>minutos</small>
                </label>
                <label>
                  Prioridade alta
                  <input type="number" min={5} max={10080} value={slaDraft.high} onChange={(event) => setSlaDraft((current) => ({ ...current, high: Number(event.target.value) }))} />
                  <small>minutos</small>
                </label>
                <label>
                  Prioridade urgente
                  <input type="number" min={5} max={10080} value={slaDraft.urgent} onChange={(event) => setSlaDraft((current) => ({ ...current, urgent: Number(event.target.value) }))} />
                  <small>minutos</small>
                </label>
              </div>
              <p className="wa-sla-hint">O relógio para quando a Wuniflow responde ou quando o atendimento fica em “Aguardando cliente”/“Resolvido”.</p>
              <footer>
                <button type="button" className="secondary" onClick={() => setSlaSettingsOpen(false)} disabled={slaSettingsSaving}>Cancelar</button>
                <button type="submit" disabled={slaSettingsSaving}>{slaSettingsSaving ? "Salvando…" : "Salvar SLA"}</button>
              </footer>
            </form>
          </section>
        </div>
      )}

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
