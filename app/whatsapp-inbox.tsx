"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type LeadSummary = { name: string; company_name: string | null };
type Conversation = {
  id: string;
  contact_name: string | null;
  contact_phone: string;
  contact_avatar_url: string | null;
  lead_id: string | null;
  leads: LeadSummary | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  status: string;
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
  const [emojiOpen, setEmojiOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const avatarTriedRef = useRef<Set<string>>(new Set());

  const loadConversations = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("id,contact_name,contact_phone,contact_avatar_url,lead_id,last_message_at,last_message_preview,unread_count,status,leads(name,company_name)")
      .eq("organization_id", organizationId)
      .neq("status", "archived")
      .order("last_message_at", { ascending: false, nullsFirst: false });

    setConversations((data || []) as unknown as Conversation[]);
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

    const paths = rows.filter((message) => message.media_url).map((message) => message.media_url!);
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

  const refreshAvatar = useCallback(async (conversation: Conversation) => {
    if (!supabase || conversation.contact_avatar_url || avatarTriedRef.current.has(conversation.id)) return;
    avatarTriedRef.current.add(conversation.id);
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) return;

    const { data, error } = await supabase.functions.invoke("whatsapp-contact-profile", {
      body: { conversation_id: conversation.id },
      headers: { Authorization: "Bearer " + token },
    });
    if (error || !data?.profile_picture_url) return;

    setConversations((current) =>
      current.map((item) =>
        item.id === conversation.id ? { ...item, contact_avatar_url: data.profile_picture_url as string } : item,
      ),
    );
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    conversations.slice(0, 25).forEach((conversation) => {
      if (!conversation.contact_avatar_url) void refreshAvatar(conversation);
    });
  }, [conversations, refreshAvatar]);

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
    if (!selectedId) {
      setMessages([]);
      setEmojiOpen(false);
      return;
    }
    void loadMessages(selectedId);
    if (supabase) {
      void supabase.rpc("mark_whatsapp_conversation_read", { p_conversation_id: selectedId }).then(() => loadConversations());
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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((item) =>
      [
        item.contact_name,
        item.contact_phone,
        item.last_message_preview,
        item.leads?.name,
        item.leads?.company_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [conversations, search]);

  const previewIcon = (conversation: Conversation) => {
    const preview = conversation.last_message_preview || "Sem mensagens";
    return preview;
  };

  const renderMessageContent = (message: Message) => {
    const signedUrl = message.media_url ? mediaUrls[message.media_url] : null;
    return (
      <>
        {signedUrl && message.message_type === "image" && (
          <img className="wa-media-image" src={signedUrl} alt={message.body || "Imagem"} />
        )}
        {signedUrl && message.message_type === "video" && (
          <video className="wa-media-video" controls playsInline src={signedUrl} />
        )}
        {signedUrl && message.message_type === "audio" && (
          <audio className="wa-media-audio" controls preload="metadata" src={signedUrl} />
        )}
        {signedUrl && message.message_type === "document" && (
          <a className="wa-document-card" href={signedUrl} target="_blank" rel="noreferrer">
            <span className="wa-document-icon">PDF</span>
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
              title={message.status}
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
          <span className="wa-topbar-spacer" />
        </div>

        <div className="wa-list-head">
          <div>
            <h2>Conversas</h2>
            <small>{conversations.reduce((count, item) => count + item.unread_count, 0)} não lidas</small>
          </div>
        </div>

        <div className="wa-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar ou iniciar nova conversa" />
        </div>

        <div className="wa-conversations">
          {filtered.length ? (
            filtered.map((conversation) => {
              const displayName = conversation.contact_name || conversation.leads?.name || conversation.contact_phone;
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
                    {conversation.lead_id && (
                      <span
                        className="wa-lead-context"
                        role={onOpenLead ? "button" : undefined}
                        onClick={(event) => {
                          if (!onOpenLead) return;
                          event.stopPropagation();
                          onOpenLead(conversation.lead_id!);
                        }}
                      >
                        Lead{conversation.leads?.company_name ? " · " + conversation.leads.company_name : ""}
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
              <Avatar name={selected.contact_name || selected.contact_phone} url={selected.contact_avatar_url} />
              <div className="wa-chat-contact">
                <strong>{selected.contact_name || selected.leads?.name || selected.contact_phone}</strong>
                <small>{selected.leads?.company_name || selected.contact_phone}</small>
              </div>
              <span className="wa-chat-actions">⋮</span>
            </header>

            <div className="wa-messages">
              <div className="wa-day-divider"><span>HOJE</span></div>
              {messages.map((message) => (
                <article key={message.id} className={"wa-bubble " + message.direction}>
                  {renderMessageContent(message)}
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
                    setAttachment(event.target.files?.[0] || null);
                    setRecordingError(null);
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
    </section>
  );
}
