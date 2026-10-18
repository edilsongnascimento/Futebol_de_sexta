import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const CAPACITY = 18;
const TIME_ZONE = Deno.env.get("APP_TIMEZONE") || "America/Sao_Paulo";
const EVENT_TYPES = new Set([
  "novo_jogo",
  "confirmacoes_abertas",
  "confirmacoes_fechadas",
  "lembrete",
  "lotacao"
]);

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT");
const cronSecret = Deno.env.get("PUSH_CRON_SECRET");

if (!supabaseUrl || !anonKey || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
  throw new Error("Faltam segredos obrigatorios para o envio de notificacoes push.");
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const publicClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function zonedTimeToUtc(dateText: string, timeText: string, timeZone: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  const [hour, minute, second = 0] = timeText.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  let timestamp = desired;
  for (let attempt = 0; attempt < 3; attempt++) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
      .filter(part => part.type !== "literal")
      .map(part => [part.type, Number(part.value)]));
    const represented = Date.UTC(
      values.year, values.month - 1, values.day,
      values.hour, values.minute, values.second
    );
    timestamp -= represented - desired;
  }
  return new Date(timestamp);
}

function notificationFor(eventType: string, game: Record<string, unknown>, count = 0) {
  const gameTime = zonedTimeToUtc(String(game.data_jogo), String(game.hora || "19:30"), TIME_ZONE);
  const formattedTime = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE
  }).format(gameTime);
  const messages: Record<string, { title: string; body: string }> = {
    novo_jogo: { title: "Novo jogo publicado", body: `Próximo jogo: ${formattedTime}. Acesse para ver os detalhes.` },
    confirmacoes_abertas: { title: "Confirmações abertas", body: `As confirmações para ${formattedTime} foram abertas.` },
    confirmacoes_fechadas: { title: "Confirmações fechadas", body: `As confirmações para ${formattedTime} foram fechadas.` },
    lembrete: {
      title: "Lembrete do Futebol de Sexta",
      body: !game.fechado && count < CAPACITY
        ? `O jogo é daqui a 6 horas. Ainda há vagas e o jogo continua aberto para convidados.`
        : `O jogo é daqui a 6 horas (${formattedTime}). Confira sua confirmação.`
    },
    lotacao: { title: "Jogo lotado", body: `As ${CAPACITY} vagas para ${formattedTime} foram preenchidas.` }
  };
  return messages[eventType];
}

async function sendEvent(eventType: string, game: Record<string, unknown>, eventKey: string, count = 0) {
  const gameId = String(game.id);
  const claim = {
    event_key: eventKey,
    jogo_id: gameId,
    event_type: eventType,
    status: "enviando"
  };
  const { error: claimError } = await service.from("push_notification_events").insert(claim);
  if (claimError?.code === "23505") {
    const { data: retry, error: retryError } = await service.from("push_notification_events")
      .update({ status: "enviando", destinatarios: 0, enviados: 0, falhas: 0, concluido_em: null })
      .eq("event_key", eventKey)
      .eq("status", "falhou")
      .select("event_key")
      .maybeSingle();
    if (retryError) throw retryError;
    if (!retry) return { duplicate: true, enviados: 0, falhas: 0 };
  } else if (claimError) {
    throw claimError;
  }

  const { data: subscriptions, error: subscriptionsError } = await service
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth,socios!inner(ativo)")
    .eq("socios.ativo", true);
  if (subscriptionsError) {
    await service.from("push_notification_events")
      .update({ status: "falhou", concluido_em: new Date().toISOString() })
      .eq("event_key", eventKey);
    throw subscriptionsError;
  }

  const payload = JSON.stringify({
    ...notificationFor(eventType, game, count),
    tag: eventKey,
    url: "./socio.html"
  });
  let delivered = 0;
  let failed = 0;
  await Promise.all((subscriptions || []).map(async (subscription: {
    endpoint: string;
    p256dh: string;
    auth: string;
  }) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth }
      }, payload, { TTL: 86400 });
      delivered++;
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode);
      if (statusCode === 404 || statusCode === 410) {
        const { error: deleteError } = await service.from("push_subscriptions")
          .delete().eq("endpoint", subscription.endpoint);
        if (deleteError) console.error("Falha ao remover assinatura push expirada.", deleteError);
      } else {
        failed++;
        console.error("Falha na entrega de uma notificacao push.", error);
      }
    }
  }));

  const status = subscriptions?.length === 0
    ? "sem_destinatarios"
    : failed === 0 ? "enviado" : delivered > 0 ? "parcial" : "falhou";
  const { error: updateError } = await service.from("push_notification_events")
    .update({
      status,
      destinatarios: subscriptions?.length || 0,
      enviados: delivered,
      falhas: failed,
      concluido_em: new Date().toISOString()
    })
    .eq("event_key", eventKey);
  if (updateError) throw updateError;
  return { duplicate: false, enviados: delivered, falhas: failed };
}

async function getNextGamePanel() {
  const { data, error } = await publicClient.rpc("obter_painel_publico");
  if (error) throw error;
  if (!data?.jogo) return null;
  return { game: data.jogo, count: Number(data.total_ocupadas || 0) };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "Metodo nao permitido." });

  try {
    const body = await request.json();
    if (request.headers.get("x-cron-secret") && cronSecret &&
      request.headers.get("x-cron-secret") === cronSecret) {
      if (body.eventType !== "cron_lembretes") return respond(400, { error: "Evento agendado invalido." });
      const panel = await getNextGamePanel();
      if (!panel) return respond(200, { enviados: 0, motivo: "Sem jogo futuro." });
      const startsAt = zonedTimeToUtc(
        String(panel.game.data_jogo),
        String(panel.game.hora || "19:30"),
        TIME_ZONE
      ).getTime();
      const remaining = startsAt - Date.now();
      if (remaining > 6 * 60 * 60 * 1000 + 5 * 60 * 1000 ||
        remaining < 6 * 60 * 60 * 1000 - 5 * 60 * 1000) {
        return respond(200, { enviados: 0, motivo: "Fora do horario do lembrete." });
      }
      const result = await sendEvent(
        "lembrete",
        panel.game,
        `lembrete:${panel.game.id}:6h`,
        panel.count
      );
      return respond(200, result);
    }

    if (body.eventType === "lotacao") {
      const playerToken = String(body.playerToken || "");
      if (playerToken.length < 32) return respond(401, { error: "Acesso individual invalido." });
      const { data, error } = await publicClient.rpc("obter_painel_socio", { p_token: playerToken });
      if (error) throw error;
      if (!data?.socio || String(data.jogo?.id || "") !== String(body.gameId) ||
        Number(data.total_ocupadas || 0) < CAPACITY) {
        return respond(403, { error: "O evento de lotacao nao foi confirmado pelo sistema." });
      }
      const result = await sendEvent("lotacao", data.jogo, `lotacao:${data.jogo.id}`, Number(data.total_ocupadas));
      return respond(200, result);
    }

    if (!EVENT_TYPES.has(body.eventType) ||
      !["novo_jogo", "confirmacoes_abertas", "confirmacoes_fechadas"].includes(body.eventType)) {
      return respond(400, { error: "Tipo de notificacao invalido." });
    }
    const authorization = request.headers.get("authorization");
    if (!authorization) return respond(401, { error: "Sessao administrativa necessaria." });
    const caller = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } }
    });
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) return respond(401, { error: "Sessao administrativa invalida." });
    const { data: isAdmin, error: adminError } = await caller.rpc("admin_verificar_acesso");
    if (adminError) throw adminError;
    if (isAdmin !== true) return respond(403, { error: "Usuario nao autorizado como administrador." });

    const { data: game, error: gameError } = await service.from("jogos")
      .select("id,data_jogo,hora,fechado")
      .eq("id", body.gameId)
      .maybeSingle();
    if (gameError) throw gameError;
    if (!game) return respond(404, { error: "Jogo nao encontrado." });
    if (body.eventType === "confirmacoes_abertas" && game.fechado !== false) {
      return respond(409, { error: "O jogo nao esta aberto." });
    }
    if (body.eventType === "confirmacoes_fechadas" && game.fechado !== true) {
      return respond(409, { error: "O jogo nao esta fechado." });
    }
    const eventKey = String(body.eventKey || "");
    if (eventKey.length < 8 || eventKey.length > 200) {
      return respond(400, { error: "Identificador do evento invalido." });
    }
    const result = await sendEvent(body.eventType, game, eventKey);
    return respond(200, result);
  } catch (error) {
    console.error("Falha ao processar notificacao push.", error);
    return respond(500, { error: error instanceof Error ? error.message : "Erro ao enviar notificacoes." });
  }
});
