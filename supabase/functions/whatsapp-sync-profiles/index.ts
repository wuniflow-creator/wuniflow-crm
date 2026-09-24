import { createClient } from "npm:@supabase/supabase-js@2.57.4";

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const evolutionUrl = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/$/, "");
  const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");

  if (!url || !anon) return respond({ error: "supabase_not_configured" }, 503);
  if (!evolutionUrl || !evolutionKey) return respond({ error: "evolution_not_configured" }, 503);

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return respond({ error: "unauthorized" }, 401);

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return respond({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return respond({ error: "invalid_json" }, 400); }

  const ids = Array.isArray(body?.conversation_ids)
    ? [...new Set(body.conversation_ids.map((value: unknown) => String(value)).filter(Boolean))].slice(0, 20)
    : [];

  if (!ids.length) return respond({ ok: true, profiles: [] });

  const { data: conversations, error: conversationsError } = await supabase
    .from("whatsapp_conversations")
    .select("id,organization_id,contact_phone,contact_avatar_url,channel_id")
    .in("id", ids);

  if (conversationsError) return respond({ error: "conversation_lookup_failed" }, 500);
  if (!conversations?.length) return respond({ ok: true, profiles: [] });

  const channelIds = [...new Set(conversations.map((conversation: any) => conversation.channel_id).filter(Boolean))];
  const { data: channels, error: channelsError } = await supabase
    .from("whatsapp_channels")
    .select("id,organization_id,provider,instance_name,is_active")
    .in("id", channelIds);

  if (channelsError) return respond({ error: "channel_lookup_failed" }, 500);

  const channelMap = new Map((channels || []).map((channel: any) => [channel.id, channel]));
  const profiles: Array<{ id: string; url: string | null }> = [];

  for (const conversation of conversations) {
    if (conversation.contact_avatar_url && !body?.force) {
      profiles.push({ id: conversation.id, url: conversation.contact_avatar_url });
      continue;
    }

    const channel: any = channelMap.get(conversation.channel_id);
    if (!channel || !channel.is_active || channel.provider !== "evolution") {
      profiles.push({ id: conversation.id, url: null });
      continue;
    }

    const number = String(conversation.contact_phone || "").replace(/\D/g, "");
    if (!number) {
      profiles.push({ id: conversation.id, url: null });
      continue;
    }

    try {
      const response = await fetch(
        evolutionUrl + "/chat/fetchProfilePictureUrl/" + encodeURIComponent(channel.instance_name),
        {
          method: "POST",
          headers: { "content-type": "application/json", apikey: evolutionKey },
          body: JSON.stringify({ number }),
        },
      );

      if (!response.ok) {
        profiles.push({ id: conversation.id, url: null });
        continue;
      }

      const payload: any = await response.json();
      const profileUrl = typeof payload?.profilePictureUrl === "string" && payload.profilePictureUrl.trim()
        ? payload.profilePictureUrl.trim()
        : null;

      if (profileUrl) {
        const updated = await supabase
          .from("whatsapp_conversations")
          .update({ contact_avatar_url: profileUrl, updated_at: new Date().toISOString() })
          .eq("id", conversation.id)
          .eq("organization_id", conversation.organization_id);

        if (updated.error) {
          profiles.push({ id: conversation.id, url: null });
          continue;
        }
      }

      profiles.push({ id: conversation.id, url: profileUrl });
    } catch {
      profiles.push({ id: conversation.id, url: null });
    }
  }

  return respond({ ok: true, profiles });
});
