"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type LeadSummary = {
  id: string;
  name: string;
  company_name: string | null;
  whatsapp: string | null;
  phone: string | null;
  priority: string;
  status: string;
  stage_id: string;
  pipeline_stages: { name: string; color: string | null } | null;
};

type Conversation = {
  id: string;
  contact_name: string | null;
  contact_phone: string;
  contact_avatar_url: string | null;
  lead_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  status: string;
  lead?: LeadSummary | null;
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

type SyncProfile = { id: string; url: string | null };

const normalizePhone = (value: string | null | undefined) => (value || "").replace(/\D/g, "");
const fmt = (value: string | null) =>
  value ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";

const messageState = (message: Message) => {
  if (message.direction === "inbound") return "";
  if (message.status === "read" || message.read_at) return "✓✓";
  if (message.status === "delivered" || message.delivered_at) return "✓✓";
  if (message.status === "failed") return "!";
  return "✓";
};

const messageFallback: Record<string, string> = {
  image: "📷 Imagem",
  audio: "🎵 Áudio",
  video: "🎥 Vídeo",
  document: "📄 Documento",
  sticker: "🏷️ Figurinha",
  location: "📍 Localização",
  contact: "👤 Contato",
};

export default function WhatsAppInbox({
  organizationId,
  onOpenMenu,
  onOpenLead,
}: {
  organizationId: string;
  onOpenMenu?: () => void;
  onOpenLead?: (leadId: string) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [attachment, setAttachment] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [avatarErrors, setAvatarErrors] = useState<Record<string, boolean>>({});
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 800px)").matches : false,
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const profileSyncRef = useRef<Set<string>>(new Set());

  const loadConversations = useCallback(async () => {
    if (!supabase) return;

    const [{ data: conversationData }, { data: leadData }] = await Promise.all([
      supabase
        .from("whatsapp_conversations")
        .select("id,contact_name,contact_phone,contact_avatar_url,lead_id,last_message_at,last_message_preview,unread_count,status")
        .eq("organization_id", organizationId)
        .neq("status", "archived")
        .order("last_message_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("leads")
        .select("id,name,company_name,whatsapp,phone,priority,status,stage_id,pipeline_stages(name,color)")
        .eq("organization_id", organizationId)
        .neq("status", "archived")
        .limit(1000),
    ]);

    const leads = (leadData || []) as unknown as LeadSummary[];
    const leadById = new Map(leads.map((lead) => [lead.id, lead]));
    const leadByPhone = new Map<string, LeadSummary>();

    for (const lead of leads) {
      const numbers = [normalizePhone(lead.whatsapp), normalizePhone(lead.phone)].filter(Boolean);
      for (const number of numbers) {
        if (!leadByPhone.has(number)) leadByPhone.set(number, lead);
      }
    }

    const rows = ((conversationData || []) as Omit<Conversation, "lead">[]).map((conversation) => ({
      ...conversation,
      lead: (conversation.lead_id ? leadById.get(conversation.lead_id) : null) || leadByPhone.get(normalizePhone(conversation.contact_phone)) || null,
    }));

    setConversations(rows);
    setSelectedId((current) => (current && rows.some((row) => row.id === current) ? current : null));
  }, [organizationId]);

  const loadMessages = useCallback(
    async (id: string) => {
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
    },
    [organizationId],
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!isMobile && !selectedId && conversations[0]?.id) setSelectedId(conversations[0].id);
  }, [isMobile, selectedId, conversations]);

  useEffect(() => {
    if (!supabase) return;
    const missing = conversations
      .filter((conversation) => !conversation.contact_avatar_url && !profileSyncRef.current.has(conversation.id))
      .slice(0, 20);

    if (!missing.length) return;
    missing.forEach((conversation) => profileSyncRef.current.add(conversation.id));

    void supabase.functions
      .invoke("whatsapp-sync-profiles", { body: { conversation_ids: missing.map((conversation) => conversation.id) } })
      .then(({ data }) => {
        const profiles = (data?.profiles || []) as SyncProfile[];
        if (!profiles.length) return;
        const profileMap = new Map(profiles.filter((profile) => profile.url).map((profile) => [profile.id, profile.url!]));
        if (!profileMap.size) return;
        setConversations((current) =>
          current.map((conversation) =>
            profileMap.has(conversation.id)
              ? { ...conversation, contact_avatar_url: profileMap.get(conversation.id)! }
              : conversation,
          ),
        );
      });
  }, [conversations]);

  useEffect(
    () => () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, selectedId]);

  useEffect(() => {
    if (selectedId) {
      void loadMessages(selectedId);
      if (supabase) {
        void supabase.rpc("mark_whatsapp_conversation_read", { p_conversation_id: selectedId }).then(() => loadConversations());
      }
    } else {
      setMessages([]);
      setAttachment(null);
      setDraft("");
    }
  }, [selectedId, loadMessages, loadConversations]);

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
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [organizationId, selectedId, loadConversations, loadMessages]);

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
        const extension =
          normalized === "audio/ogg" ? "ogg" : normalized === "audio/mp4" ? "m4a" : normalized === "audio/mpeg" ? "mp3" : "webm";
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
        const type = mime.startsWith("image/")
          ? "image"
          : mime.startsWith("video/")
            ? "video"
            : mime.startsWith("audio/")
              ? "audio"
              : "document";

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
        const code = data?.error || error?.message || "send_failed";
        setSendError("Falha no envio: " + code);
        return;
      }

      setDraft("");
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

  const selected = conversations.find((conversation) => conversation.id === selectedId) || null;
  const selectedLead = selected?.lead || null;
  const recordLabel =
    Math.floor(recordSeconds / 60).toString().padStart(2, "0") + ":" + (recordSeconds % 60).toString().padStart(2, "0");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) =>
      [
        conversation.contact_name,
        conversation.contact_phone,
        conversation.last_message_preview,
        conversation.lead?.name,
        conversation.lead?.company_name,
        conversation.lead?.pipeline_stages?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [conversations, search]);

  const renderAvatar = (conversation: Conversation, extraClass = "") => {
    const name = conversation.lead?.name || conversation.contact_name || conversation.contact_phone;
    const canShowImage = Boolean(conversation.contact_avatar_url && !avatarErrors[conversation.id]);

    return (
      <span className={"wa-avatar " + extraClass}>
        {canShowImage ? (
          <img
            src={conversation.contact_avatar_url!}
            alt={"Foto de " + name}
            onError={() => setAvatarErrors((current) => ({ ...current, [conversation.id]: true }))}
          />
        ) : (
          <span>{name.slice(0, 1).toUpperCase()}</span>
        )}
      </span>
    );
  };

  return (
    <section className={"wa-shell " + (isMobile && selectedId ? "mobile-chat-open" : "")}>
      <div className="wa-list">
        <div className="wa-list-toolbar">
          <button type="button" className="wa-global-menu" onClick={onOpenMenu} aria-label="Abrir menu do CRM">
            ☰
          </button>
          <div>
            <strong>WhatsApp</strong>
            <small>{conversations.reduce((total, conversation) => total + conversation.unread_count, 0)} não lidas</small>
          </div>
          <button type="button" className="wa-refresh" onClick={() => void loadConversations()} title="Atualizar conversas">
            ↻
          </button>
        </div>

        <div className="wa-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar ou iniciar nova conversa" />
        </div>

        <div className="wa-conversations">
          {filtered.length ? (
            filtered.map((conversation) => {
              const displayName = conversation.lead?.name || conversation.contact_name || conversation.contact_phone;
              const context = conversation.lead?.company_name || conversation.lead?.pipeline_stages?.name || null;
              return (
                <button
                  key={conversation.id}
                  className={"wa-conversation " + (conversation.id === selectedId ? "active" : "")}
                  onClick={() => setSelectedId(conversation.id)}
                >
                  {renderAvatar(conversation)}
                  <span className="wa-copy">
                    <span className="wa-row-title">
                      <strong>{displayName}</strong>
                      {conversation.lead && <em>Lead</em>}
                    </span>
                    <small>{context ? context + " · " : ""}{conversation.last_message_preview || "Sem mensagem"}</small>
                  </span>
                  <span className="wa-meta">
                    <small>{fmt(conversation.last_message_at)}</small>
                    {conversation.unread_count > 0 && <b>{conversation.unread_count}</b>}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="wa-empty">Nenhuma conversa encontrada.</p>
          )}
        </div>
      </div>

      <div className="wa-chat">
        {selected ? (
          <>
            <div className="wa-chat-head">
              <button type="button" className="wa-back" onClick={() => setSelectedId(null)} aria-label="Voltar para conversas">
                ‹
              </button>
              {renderAvatar(selected, "wa-avatar-chat")}
              <div className="wa-chat-contact">
                <strong>{selectedLead?.name || selected.contact_name || selected.contact_phone}</strong>
                <small>
                  {selectedLead?.company_name
                    ? selectedLead.company_name + (selectedLead.pipeline_stages?.name ? " · " + selectedLead.pipeline_stages.name : "")
                    : selected.contact_phone}
                </small>
              </div>
              {selectedLead && onOpenLead && (
                <button type="button" className="wa-open-lead" onClick={() => onOpenLead(selectedLead.id)}>
                  Ver lead
                </button>
              )}
            </div>

            <div className="wa-messages">
              <div className="wa-encryption-note">🔒 Atendimento protegido no Wuniflow CRM</div>
              {messages.map((message) => (
                <article key={message.id} className={"wa-bubble " + message.direction}>
                  {message.media_url && mediaUrls[message.media_url] && message.message_type === "image" && (
                    <img className="wa-media-image" src={mediaUrls[message.media_url]} alt={message.body || "Imagem"} />
                  )}
                  {message.media_url && mediaUrls[message.media_url] && message.message_type === "audio" && (
                    <audio className="wa-media-audio" controls src={mediaUrls[message.media_url]} />
                  )}
                  {message.media_url && mediaUrls[message.media_url] && message.message_type === "video" && (
                    <video className="wa-media-video" controls src={mediaUrls[message.media_url]} />
                  )}
                  {message.media_url && mediaUrls[message.media_url] && message.message_type === "document" && (
                    <a className="wa-media-link" href={mediaUrls[message.media_url]} target="_blank" rel="noreferrer">
                      📄 {message.media_filename || "Abrir documento"}
                    </a>
                  )}
                  {(message.body || !message.media_url) && (
                    <p>{message.body || message.media_filename || messageFallback[message.message_type] || "[" + message.message_type + "]"}</p>
                  )}
                  <small>
                    {fmt(message.created_at)}
                    {message.direction === "outbound" && (
                      <span className={"wa-message-status " + message.status}> {messageState(message)}</span>
                    )}
                  </small>
                </article>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="wa-compose-wrap">
              {recording && (
                <div className="wa-recording-status">
                  <span>● Gravando</span>
                  <strong>{recordLabel}</strong>
                  <small>Toque em ■ para finalizar</small>
                </div>
              )}
              {attachment && (
                <div className="wa-attachment">
                  <span>{attachment.type.startsWith("audio/") ? "🎙️" : "📎"} {attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachment(null);
                      setRecordingError(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    Remover
                  </button>
                </div>
              )}
              {recordingError && <p className="wa-send-error">{recordingError}</p>}
              {sendError && <p className="wa-send-error">{sendError}</p>}

              <div className="wa-compose">
                <input
                  ref={fileInputRef}
                  className="wa-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,audio/ogg,audio/mpeg,audio/mp4,audio/webm,application/pdf,text/plain,.doc,.docx,.xls,.xlsx"
                  onChange={(event) => {
                    setAttachment(event.target.files?.[0] || null);
                    setRecordingError(null);
                  }}
                />
                <button
                  type="button"
                  className="wa-attach"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || recording}
                  title="Anexar arquivo"
                >
                  ＋
                </button>
                <div className="wa-input-shell">
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
                  <button
                    type="button"
                    className="wa-send"
                    onClick={() => void sendMessage()}
                    disabled={sending || recording}
                    title="Enviar"
                  >
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
          </>
        ) : (
          <div className="wa-chat-empty">
            <div className="wa-empty-mark">W</div>
            <strong>Wuniflow WhatsApp</strong>
            <p>Selecione uma conversa para iniciar o atendimento.</p>
          </div>
        )}
      </div>
    </section>
  );
}
