import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = "BGy9OhMGvMYkszyUfDUaxMNk6lFqbRZ0MGTNPFvdn0Teq5wVBstG9ZM5wt2p2tfjzqVDpcSmViauY5ihIXGosk4";

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

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    return json({
      ok: true,
      service: "web-push-dispatch",
      vapid_public_key: VAPID_PUBLIC_KEY,
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const configuredSecret = Deno.env.get("WHATSAPP_WEBHOOK_SECRET");
  const suppliedSecret = req.headers.get("x-webhook-secret");
  if (!configuredSecret || !suppliedSecret || suppliedSecret !== configuredSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const organizationId = String(body?.organization_id || "");
  const conversationId = String(body?.conversation_id || "");
  if (!organizationId || !conversationId) {
    return json({ error: "missing_context" }, 400);
  }

  const supabase = adminClient();

  const { data: vapidPrivate, error: vapidError } = await supabase.rpc("get_web_push_vapid_private");
  if (vapidError || !vapidPrivate) {
    return json({ error: "vapid_not_configured" }, 503);
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select("id,assigned_to,contact_name,contact_phone")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .single();

  if (conversationError || !conversation) {
    return json({ error: "conversation_not_found" }, 404);
  }

  let targetUserIds: string[] = [];
  if (conversation.assigned_to) {
    targetUserIds = [conversation.assigned_to];
  } else {
    const { data: members, error: memberError } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .in("role", ["owner", "admin", "manager", "agent"]);

    if (memberError) return json({ error: "members_lookup_failed" }, 500);
    targetUserIds = [...new Set((members || []).map((member) => String(member.user_id)))];
  }

  if (!targetUserIds.length) {
    return json({ ok: true, sent: 0, reason: "no_target_users" });
  }

  const { data: subscriptions, error: subscriptionError } = await supabase
    .from("web_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,failure_count")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .in("user_id", targetUserIds);

  if (subscriptionError) return json({ error: "subscriptions_lookup_failed" }, 500);
  if (!subscriptions?.length) return json({ ok: true, sent: 0, reason: "no_subscriptions" });

  webpush.setVapidDetails(
    "mailto:WUNIFLOW@GMAIL.COM",
    VAPID_PUBLIC_KEY,
    String(vapidPrivate),
  );

  const mediaLabels: Record<string, string> = {
    image: "📷 Imagem",
    audio: "🎵 Áudio",
    video: "🎥 Vídeo",
    document: "📄 Documento",
    sticker: "🏷️ Figurinha",
    location: "📍 Localização",
    contact: "👤 Contato",
  };

  const contactName = String(body?.contact_name || conversation.contact_name || conversation.contact_phone || "Novo contato");
  const preview = String(body?.text || mediaLabels[String(body?.message_type || "")] || "Nova mensagem no WhatsApp");
  const payload = JSON.stringify({
    title: "Wuniflow CRM • " + contactName,
    body: preview.slice(0, 180),
    conversationId,
    url: "/?view=whatsapp&conversation=" + encodeURIComponent(conversationId),
    tag: "wuniflow-wa-" + conversationId,
  });

  let sent = 0;
  let failed = 0;
  let deactivated = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        payload,
        {
          TTL: 120,
          urgency: "high",
        },
      );

      sent += 1;
      await supabase
        .from("web_push_subscriptions")
        .update({
          failure_count: 0,
          last_error: null,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscription.id);
    } catch (error: any) {
      failed += 1;
      const statusCode = Number(error?.statusCode || error?.status || 0);
      const expired = statusCode === 404 || statusCode === 410;
      const failureCount = Number(subscription.failure_count || 0) + 1;

      if (expired) deactivated += 1;

      await supabase
        .from("web_push_subscriptions")
        .update({
          is_active: expired ? false : true,
          failure_count: failureCount,
          last_error: String(error?.body || error?.message || "push_failed").slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscription.id);
    }
  }

  return json({
    ok: true,
    targets: targetUserIds.length,
    subscriptions: subscriptions.length,
    sent,
    failed,
    deactivated,
  });
});