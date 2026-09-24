import { createClient } from "npm:@supabase/supabase-js@2.57.4";

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const evolutionUrl = (Deno.env.get("EVOLUTION_API_URL") || "https://evoapi.mandingamundo.shop").replace(/\/$/, "");
  const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
  if (!url || !anon) return json({ error: "supabase_not_configured" }, 503);
  if (!evolutionKey) return json({ error: "evolution_not_configured" }, 503);

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const conversationId = String(body?.conversation_id || "");
  if (!conversationId) return json({ error: "conversation_id_required" }, 400);

  const { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select("id,organization_id,contact_phone,contact_name,contact_avatar_url,provider_conversation_id,channel_id")
    .eq("id", conversationId)
    .single();

  if (conversationError || !conversation) return json({ error: "conversation_not_found" }, 404);
  if (conversation.contact_avatar_url && !body?.force) {
    return json({ ok: true, profile_picture_url: conversation.contact_avatar_url, cached: true });
  }

  const { data: channel, error: channelError } = await supabase
    .from("whatsapp_channels")
    .select("id,instance_name,provider,is_active")
    .eq("id", conversation.channel_id)
    .eq("organization_id", conversation.organization_id)
    .single();

  if (channelError || !channel || !channel.is_active || channel.provider !== "evolution") {
    return json({ error: "channel_unavailable" }, 409);
  }

  let response: Response;
  try {
    response = await fetch(
      evolutionUrl + "/chat/fetchProfilePictureUrl/" + encodeURIComponent(channel.instance_name),
      {
        method: "POST",
        headers: { "content-type": "application/json", apikey: evolutionKey },
        body: JSON.stringify({ number: conversation.provider_conversation_id || conversation.contact_phone }),
      },
    );
  } catch {
    return json({ error: "evolution_unreachable" }, 502);
  }

  if (!response.ok) {
    if (response.status === 404) return json({ ok: true, profile_picture_url: null });
    return json({ error: "profile_picture_lookup_failed", provider_status: response.status }, 502);
  }

  let provider: any = null;
  try { provider = await response.json(); } catch {}
  const profilePictureUrl = provider?.profilePictureUrl ?? provider?.response?.profilePictureUrl ?? null;

  if (profilePictureUrl) {
    const { error: updateError } = await supabase
      .from("whatsapp_conversations")
      .update({ contact_avatar_url: profilePictureUrl, updated_at: new Date().toISOString() })
      .eq("id", conversation.id)
      .eq("organization_id", conversation.organization_id);
    if (updateError) return json({ error: "profile_picture_store_failed" }, 500);
  }

  return json({ ok: true, profile_picture_url: profilePictureUrl });
});
