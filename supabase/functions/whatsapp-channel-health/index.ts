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

  const channelId = String(body?.channel_id || "");
  if (!channelId) return respond({ error: "channel_id_required" }, 400);

  const { data: channel, error: channelError } = await supabase
    .from("whatsapp_channels")
    .select("id,provider,instance_name,is_active")
    .eq("id", channelId)
    .single();

  if (channelError || !channel) return respond({ error: "channel_not_found" }, 404);

  if (!channel.is_active) {
    return respond({ ok: true, state: "disconnected", provider_state: "inactive" });
  }

  if (channel.provider !== "evolution" || !evolutionKey) {
    return respond({ ok: true, state: "unknown", provider_state: null });
  }

  try {
    const providerResponse = await fetch(
      evolutionUrl + "/instance/connectionState/" + encodeURIComponent(channel.instance_name),
      {
        method: "GET",
        headers: { apikey: evolutionKey },
      },
    );

    if (!providerResponse.ok) {
      return respond({
        ok: true,
        state: "disconnected",
        provider_state: "http_" + providerResponse.status,
      });
    }

    const payload: any = await providerResponse.json();
    const raw = String(
      payload?.instance?.state ??
      payload?.state ??
      payload?.connectionState ??
      payload?.status ??
      "",
    ).toLowerCase();

    const state =
      raw === "open" || raw === "connected"
        ? "connected"
        : raw.includes("connect")
          ? "connecting"
          : raw === "close" || raw === "closed" || raw === "disconnected"
            ? "disconnected"
            : "unknown";

    return respond({ ok: true, state, provider_state: raw || null });
  } catch (error) {
    return respond({
      ok: true,
      state: "disconnected",
      provider_state: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});