import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const key = raw ? JSON.parse(raw)?.default : legacy;
  if (!url || !key) throw new Error("Supabase server credentials unavailable");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function dispatchWebPush(input: {
  secret: string;
  organizationId: string;
  conversationId: string;
  contactName: string | null;
  text: string | null;
  messageType: string;
}) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) return;

  try {
    await fetch(supabaseUrl.replace(/\/$/, "") + "/functions/v1/web-push-dispatch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-secret": input.secret,
      },
      body: JSON.stringify({
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        contact_name: input.contactName,
        text: input.text,
        message_type: input.messageType,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Push delivery is best-effort and must never block WhatsApp ingestion.
  }
}

function extract(payload: any) {
  const data = payload?.data ?? payload ?? {};
  const key = data?.key ?? {};
  const instance =
    payload?.instance ??
    payload?.instanceName ??
    data?.instance ??
    data?.instanceName ??
    null;
  const remoteJid = key?.remoteJid ?? data?.remoteJid ?? null;
  const fromMe = Boolean(key?.fromMe ?? data?.fromMe ?? false);
  const providerMessageId = key?.id ?? data?.keyId ?? data?.id ?? payload?.keyId ?? payload?.id ?? null;
  const message = data?.message ?? payload?.message ?? {};
  const text =
    message?.conversation ??
    message?.extendedTextMessage?.text ??
    data?.body ??
    data?.text ??
    null;
  const pushName = data?.pushName ?? payload?.senderName ?? null;
  const messageStatus = data?.status ?? data?.update?.status ?? payload?.status ?? null;
  const event = String(payload?.event ?? payload?.type ?? "").toLowerCase();

  let messageType = "text";
  let mediaMimeType: string | null = null;
  let mediaFilename: string | null = null;

  if (message?.imageMessage) {
    messageType = "image";
    mediaMimeType = message.imageMessage.mimetype ?? null;
  } else if (message?.audioMessage) {
    messageType = "audio";
    mediaMimeType = message.audioMessage.mimetype ?? null;
  } else if (message?.videoMessage) {
    messageType = "video";
    mediaMimeType = message.videoMessage.mimetype ?? null;
  } else if (message?.documentMessage) {
    messageType = "document";
    mediaMimeType = message.documentMessage.mimetype ?? null;
    mediaFilename = message.documentMessage.fileName ?? null;
  } else if (message?.stickerMessage) {
    messageType = "sticker";
  } else if (message?.locationMessage) {
    messageType = "location";
  } else if (message?.contactMessage || message?.contactsArrayMessage) {
    messageType = "contact";
  }

  const phone = remoteJid ? String(remoteJid).split("@")[0].replace(/\D/g, "") : null;
  return { instance, remoteJid, phone, fromMe, providerMessageId, text, pushName, event, messageStatus, messageType, mediaMimeType, mediaFilename };
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return json({ ok: true, service: "whatsapp-inbound-webhook" });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const configuredSecret = Deno.env.get("WHATSAPP_WEBHOOK_SECRET");
  if (!configuredSecret) return json({ error: "webhook_not_configured" }, 503);

  const suppliedSecret =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("x-evolution-webhook-secret") ??
    new URL(req.url).searchParams.get("secret");

  if (!suppliedSecret || suppliedSecret !== configuredSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = extract(payload);

  // Inbox only: no bot, AI, autoresponder, or outbound send occurs here.
  if (!parsed.instance) return json({ ignored: true, reason: "missing_instance" }, 202);

  const supported =
    parsed.event.includes("message") ||
    Boolean(parsed.providerMessageId) ||
    Boolean(parsed.remoteJid);
  if (!supported) return json({ ignored: true, reason: "unsupported_event" }, 202);

  if (!parsed.phone || !parsed.providerMessageId) {
    return json({ ignored: true, reason: "missing_message_identity" }, 202);
  }

  const supabase = adminClient();

  const { data: channel, error: channelError } = await supabase
    .from("whatsapp_channels")
    .select("id, organization_id")
    .eq("provider", "evolution")
    .eq("instance_name", parsed.instance)
    .eq("is_active", true)
    .maybeSingle();

  if (channelError) return json({ error: "channel_lookup_failed" }, 500);
  if (!channel) return json({ ignored: true, reason: "unknown_instance" }, 202);

  const isStatusUpdate = parsed.event.includes("message") && parsed.event.includes("update") && Boolean(parsed.providerMessageId);
  if (isStatusUpdate) {
    const raw = String(parsed.messageStatus ?? "").toUpperCase();
    const nextStatus =
      raw.includes("READ") || raw.includes("PLAYED") || raw === "4"
        ? "read"
        : raw.includes("DELIVERY_ACK") || raw.includes("DELIVER") || raw === "3"
          ? "delivered"
          : raw.includes("SERVER_ACK") || raw.includes("SENT") || raw.includes("PENDING") || raw === "2"
            ? "sent"
            : raw.includes("ERROR") || raw.includes("FAIL")
              ? "failed"
              : null;
    if (!nextStatus) return json({ ignored: true, reason: "unsupported_status" }, 202);

    const current = await supabase
      .from("whatsapp_messages")
      .select("id,status,delivered_at,read_at")
      .eq("organization_id", channel.organization_id)
      .eq("provider_message_id", parsed.providerMessageId)
      .eq("direction", "outbound")
      .maybeSingle();

    if (current.error) return json({ error: "message_status_lookup_failed" }, 500);
    if (!current.data) return json({ ignored: true, reason: "message_not_found_for_status" }, 202);

    const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
    const currentStatus =
      current.data.read_at ? "read" :
      current.data.delivered_at ? "delivered" :
      String(current.data.status || "sent");
    const currentRank = rank[currentStatus] ?? 0;
    const nextRank = rank[nextStatus] ?? 0;

    // ACK events may arrive out of order. Never regress sent <- delivered <- read.
    if (nextStatus !== "failed" && nextRank <= currentRank) {
      return json({ ok: true, status_updated: false, reason: "status_not_advanced", current_status: currentStatus });
    }

    const patch: Record<string, unknown> = { status: nextStatus };
    const now = new Date().toISOString();
    if (nextStatus === "delivered") patch.delivered_at = current.data.delivered_at ?? now;
    if (nextStatus === "read") {
      patch.delivered_at = current.data.delivered_at ?? now;
      patch.read_at = current.data.read_at ?? now;
    }

    const updated = await supabase.from("whatsapp_messages").update(patch)
      .eq("id", current.data.id)
      .select("id,status,delivered_at,read_at").maybeSingle();
    if (updated.error) return json({ error: "message_status_update_failed" }, 500);
    return json({ ok: true, status_updated: Boolean(updated.data), status: updated.data?.status ?? currentStatus });
  }

  const conversationKey = parsed.remoteJid ?? parsed.phone;

  let { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select("id")
    .eq("organization_id", channel.organization_id)
    .eq("provider", "whatsapp")
    .eq("provider_conversation_id", conversationKey)
    .maybeSingle();

  if (conversationError) return json({ error: "conversation_lookup_failed" }, 500);

  if (!conversation) {
    const created = await supabase
      .from("whatsapp_conversations")
      .insert({
        organization_id: channel.organization_id,
        channel_id: channel.id,
        contact_name: parsed.pushName,
        contact_phone: parsed.phone,
        provider: "whatsapp",
        provider_conversation_id: conversationKey,
        status: "open",
      })
      .select("id")
      .single();

    if (created.error) {
      // A concurrent webhook may have created it first.
      const retry = await supabase
        .from("whatsapp_conversations")
        .select("id")
        .eq("organization_id", channel.organization_id)
        .eq("provider", "whatsapp")
        .eq("provider_conversation_id", conversationKey)
        .single();
      if (retry.error) return json({ error: "conversation_create_failed" }, 500);
      conversation = retry.data;
    } else {
      conversation = created.data;
    }
  }

  const direction = parsed.fromMe ? "outbound" : "inbound";
  const status = parsed.fromMe ? "sent" : "received";

  const existing = await supabase.from("whatsapp_messages").select("id").eq("organization_id", channel.organization_id).eq("provider_message_id", parsed.providerMessageId).maybeSingle();
  if (existing.error) return json({ error: "message_lookup_failed" }, 500);

  const inserted = await supabase
    .from("whatsapp_messages")
    .upsert(
      {
        organization_id: channel.organization_id,
        conversation_id: conversation.id,
        provider_message_id: parsed.providerMessageId,
        direction,
        sender_type: parsed.fromMe ? "system" : "contact",
        message_type: parsed.messageType,
        body: parsed.text,
        media_mime_type: parsed.mediaMimeType,
        media_filename: parsed.mediaFilename,
        status,
        sent_at: new Date().toISOString(),
        metadata: { provider: "evolution" },
      },
      { onConflict: "organization_id,provider_message_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (inserted.error) return json({ error: "message_store_failed" }, 500);

  const messageId = inserted.data?.id ?? existing.data?.id ?? null;
  const isMedia = ["image","audio","video","document","sticker"].includes(parsed.messageType);
  if (messageId && isMedia && !existing.data) {
    const evolutionUrl = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/$/,"");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
    if (evolutionUrl && evolutionKey) {
      try {
        const mediaRes = await fetch(evolutionUrl + "/chat/getBase64FromMediaMessage/" + encodeURIComponent(parsed.instance), {
          method: "POST",
          headers: { "content-type": "application/json", "apikey": evolutionKey },
          body: JSON.stringify({ message: { key: payload?.data?.key ?? payload?.key, message: payload?.data?.message ?? payload?.message }, convertToMp4: false })
        });
        if (mediaRes.ok) {
          const mediaJson:any = await mediaRes.json();
          const raw = String(mediaJson?.base64 ?? mediaJson?.data?.base64 ?? "");
          const base64 = raw.includes(",") ? raw.split(",").pop()! : raw;
          if (base64) {
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            if (bytes.byteLength <= 26214400) {
              const extMap:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","audio/ogg":"ogg","audio/mpeg":"mp3","audio/mp4":"m4a","video/mp4":"mp4","application/pdf":"pdf"};
              const ext = extMap[parsed.mediaMimeType ?? ""] ?? "bin";
              const path = channel.organization_id + "/" + conversation.id + "/" + parsed.providerMessageId + "." + ext;
              const uploaded = await supabase.storage.from("whatsapp-media").upload(path, bytes, { contentType: parsed.mediaMimeType ?? "application/octet-stream", upsert: false });
              if (!uploaded.error) {
                await supabase.from("whatsapp_messages").update({ media_url: path }).eq("id", messageId);
              }
            }
          }
        }
      } catch {
        // Media enrichment is best-effort. The message itself remains stored.
      }
    }
  }

  if (inserted.data && direction === "inbound") {
    await dispatchWebPush({
      secret: configuredSecret,
      organizationId: channel.organization_id,
      conversationId: conversation.id,
      contactName: parsed.pushName ?? parsed.phone,
      text: parsed.text,
      messageType: parsed.messageType,
    });
  }

  return json({ ok: true, stored: Boolean(inserted.data) });
});
