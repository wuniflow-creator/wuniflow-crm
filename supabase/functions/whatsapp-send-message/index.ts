import { createClient } from "npm:@supabase/supabase-js@2.57.4";

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
    });

  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
  const evolutionUrl = (Deno.env.get("EVOLUTION_API_URL") || "https://evoapi.mandingamundo.shop").replace(/\/$/, "");

  if (!url || !anon) return respond({ error: "supabase_not_configured" }, 503);
  if (!evolutionKey) return respond({ error: "evolution_not_configured" }, 503);

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return respond({ error: "unauthorized" }, 401);

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return respond({ error: "unauthorized" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return respond({ error: "invalid_json" }, 400);
  }

  const conversationId = String(body?.conversation_id || "");
  const text = String(body?.text || "").trim();
  const media = body?.media && typeof body.media === "object" ? body.media : null;

  if (!conversationId || (!text && !media)) return respond({ error: "conversation_id_and_content_required" }, 400);
  if (text.length > 4096) return respond({ error: "message_too_long" }, 400);

  const { data: conversation, error: convError } = await supabase
    .from("whatsapp_conversations")
    .select("id,organization_id,contact_phone,channel_id,status")
    .eq("id", conversationId)
    .single();

  if (convError || !conversation) return respond({ error: "conversation_not_found" }, 404);
  if (conversation.status === "archived") return respond({ error: "conversation_archived" }, 409);

  const { data: channel, error: channelError } = await supabase
    .from("whatsapp_channels")
    .select("id,provider,instance_name,is_active")
    .eq("id", conversation.channel_id)
    .eq("organization_id", conversation.organization_id)
    .single();

  if (channelError || !channel || !channel.is_active || channel.provider !== "evolution") {
    return respond({ error: "channel_unavailable" }, 409);
  }

  const phone = String(conversation.contact_phone).replace(/\D/g, "");
  let endpoint: string;
  let providerBody: Record<string, unknown>;
  let messageType = "text";
  let mediaPath: string | null = null;
  let mediaMime: string | null = null;
  let mediaFilename: string | null = null;

  if (media) {
    messageType = String(media.type || "");
    mediaPath = String(media.path || "");
    mediaMime = String(media.mime_type || "").toLowerCase().split(";")[0].trim();
    mediaFilename = String(media.filename || "").slice(0, 180);

    if (!["image", "video", "document", "audio"].includes(messageType)) {
      return respond({ error: "unsupported_media_type" }, 400);
    }

    const expectedPrefix = conversation.organization_id + "/" + conversation.id + "/outbound/";
    if (!mediaPath.startsWith(expectedPrefix)) return respond({ error: "invalid_media_path" }, 400);

    const allowedMime: Record<string, string[]> = {
      image: ["image/jpeg", "image/png", "image/webp"],
      video: ["video/mp4"],
      document: [
        "application/pdf",
        "application/octet-stream",
        "text/plain",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      audio: ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm"],
    };

    if (!allowedMime[messageType]?.includes(mediaMime)) {
      return respond({ error: "unsupported_media_mime" }, 400);
    }

    const { data: file, error: fileError } = await supabase.storage.from("whatsapp-media").download(mediaPath);
    if (fileError || !file) return respond({ error: "media_not_found" }, 404);
    if (file.size > 25 * 1024 * 1024) return respond({ error: "media_too_large" }, 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    const base64 = btoa(binary);

    if (messageType === "audio") {
      endpoint = evolutionUrl + "/message/sendWhatsAppAudio/" + encodeURIComponent(channel.instance_name);
      providerBody = { number: phone, audio: base64, encoding: true };
    } else {
      endpoint = evolutionUrl + "/message/sendMedia/" + encodeURIComponent(channel.instance_name);
      providerBody = {
        number: phone,
        mediatype: messageType,
        mimetype: mediaMime,
        media: base64,
        fileName: mediaFilename || undefined,
        caption: text || undefined,
      };

      // Evolution API 2.3.7 has a known filename casing inconsistency for images.
      if (messageType === "image" && mediaFilename) {
        providerBody.filename = mediaFilename;
      }
    }
  } else {
    endpoint = evolutionUrl + "/message/sendText/" + encodeURIComponent(channel.instance_name);
    providerBody = { number: phone, text };
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: evolutionKey },
      body: JSON.stringify(providerBody),
    });
  } catch {
    return respond({ error: "evolution_unreachable" }, 502);
  }

  let provider: any = null;
  try {
    provider = await response.json();
  } catch {}

  if (!response.ok) {
    return respond({ error: "send_failed", provider_status: response.status }, 502);
  }

  const providerMessageId = provider?.key?.id ?? provider?.response?.key?.id ?? null;
  const { data: stored, error: storeError } = await supabase
    .from("whatsapp_messages")
    .insert({
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      provider_message_id: providerMessageId,
      direction: "outbound",
      sender_type: "user",
      sender_user_id: user.id,
      message_type: messageType,
      body: text || null,
      media_url: mediaPath,
      media_mime_type: mediaMime,
      media_filename: mediaFilename,
      status: "sent",
      sent_at: new Date().toISOString(),
      created_by: user.id,
      metadata: { provider: "evolution", source: "crm" },
    })
    .select("id")
    .single();

  if (storeError) {
    if (providerMessageId) {
      const existing = await supabase
        .from("whatsapp_messages")
        .select("id")
        .eq("organization_id", conversation.organization_id)
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();

      if (existing.data) {
        return respond({ ok: true, message_id: existing.data.id, provider_message_id: providerMessageId });
      }
    }
    return respond({ error: "message_store_failed" }, 500);
  }

  return respond({ ok: true, message_id: stored.id, provider_message_id: providerMessageId });
});
