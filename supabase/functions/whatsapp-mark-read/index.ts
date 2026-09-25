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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
  const evolutionUrl = (Deno.env.get("EVOLUTION_API_URL") || "https://evoapi.mandingamundo.shop").replace(/\/$/, "");

  if (!supabaseUrl || !anonKey) return respond({ error: "supabase_not_configured" }, 503);

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return respond({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, anonKey, {
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
  if (!conversationId) return respond({ error: "conversation_id_required" }, 400);

  const { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select("id,organization_id,contact_phone,provider_conversation_id,channel_id")
    .eq("id", conversationId)
    .single();

  if (conversationError || !conversation) return respond({ error: "conversation_not_found" }, 404);

  // CRM unread state must never depend on provider availability.
  const readResult = await supabase.rpc("mark_whatsapp_conversation_read", {
    p_conversation_id: conversationId,
  });

  if (readResult.error) return respond({ error: "crm_mark_read_failed" }, 500);

  if (!evolutionKey || !conversation.channel_id) {
    return respond({ ok: true, crm_read: true, provider_synced: false, reason: "provider_not_configured" });
  }

  const { data: channel, error: channelError } = await supabase
    .from("whatsapp_channels")
    .select("provider,instance_name,is_active")
    .eq("id", conversation.channel_id)
    .eq("organization_id", conversation.organization_id)
    .single();

  if (channelError || !channel || !channel.is_active || channel.provider !== "evolution") {
    return respond({ ok: true, crm_read: true, provider_synced: false, reason: "channel_unavailable" });
  }

  const { data: inboundMessages, error: messagesError } = await supabase
    .from("whatsapp_messages")
    .select("provider_message_id")
    .eq("organization_id", conversation.organization_id)
    .eq("conversation_id", conversation.id)
    .eq("direction", "inbound")
    .is("read_at", null)
    .not("provider_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (messagesError) {
    return respond({ ok: true, crm_read: true, provider_synced: false, reason: "messages_lookup_failed" });
  }

  const remoteJid =
    String(conversation.provider_conversation_id || "").includes("@")
      ? String(conversation.provider_conversation_id)
      : String(conversation.contact_phone || "").replace(/\D/g, "") + "@s.whatsapp.net";

  const readMessages = (inboundMessages || [])
    .map((message) => String(message.provider_message_id || ""))
    .filter(Boolean)
    .map((id) => ({ id, fromMe: false, remoteJid }));

  if (!readMessages.length) {
    return respond({ ok: true, crm_read: true, provider_synced: true, marked: 0 });
  }

  try {
    const providerResponse = await fetch(
      evolutionUrl + "/chat/markMessageAsRead/" + encodeURIComponent(channel.instance_name),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: evolutionKey,
        },
        body: JSON.stringify({ readMessages }),
      },
    );

    if (!providerResponse.ok) {
      const providerText = await providerResponse.text().catch(() => "");
      return respond({
        ok: true,
        crm_read: true,
        provider_synced: false,
        provider_status: providerResponse.status,
        provider_message: providerText.slice(0, 500),
      });
    }

    const now = new Date().toISOString();
    const providerIds = readMessages.map((message) => message.id);
    const { error: messageReadError } = await supabase
      .from("whatsapp_messages")
      .update({ status: "read", read_at: now })
      .eq("organization_id", conversation.organization_id)
      .eq("conversation_id", conversation.id)
      .eq("direction", "inbound")
      .in("provider_message_id", providerIds);

    return respond({
      ok: true,
      crm_read: true,
      provider_synced: true,
      marked: readMessages.length,
      message_state_updated: !messageReadError,
    });
  } catch (error) {
    return respond({
      ok: true,
      crm_read: true,
      provider_synced: false,
      reason: "evolution_unreachable",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});