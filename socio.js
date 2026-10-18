(() => {
  "use strict";
  const cfg = window.FUTEBOL_CONFIG || {};
  const $ = id => document.getElementById(id);
  const CAPACITY = 18;
  const TOKEN_STORAGE_KEY = "futebol-de-sexta-player-token";
  let db = null, member = null, game = null, participants = [], occupied = 0;
  let memberToken = null;

  const token = () => memberToken;
  const say = (id, msg, error = false) => {
    const el = $(id); if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("error-text", !!error);
  };
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const dateLabel = (date, time) => {
    if (!date) return "Jogo ainda não publicado";
    return `${new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"2-digit",month:"long"}).format(new Date(`${date}T12:00:00`))} · ${String(time || "19:30").slice(0,5)}`;
  };

  function restoreToken() {
    const url = new URL(location.href);
    const linkToken = url.searchParams.get("socio");
    memberToken = linkToken || localStorage.getItem(TOKEN_STORAGE_KEY);
    if (linkToken) {
      localStorage.setItem(TOKEN_STORAGE_KEY, linkToken);
      url.searchParams.delete("socio");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    memberToken = null;
  }

  function setPushMessage(message, error = false) {
    say("pushMessage", message, error);
  }

  function vapidKeyBytes(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  }

  async function refreshPushState() {
    const area = $("pushSettings");
    const button = $("pushNotificationsBtn");
    if (!member) {
      area.classList.add("hidden");
      return;
    }
    area.classList.remove("hidden");
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      button.disabled = true;
      setPushMessage("Este navegador não oferece suporte a notificações push.", true);
      return;
    }
    if (!cfg.SUPABASE_VAPID_PUBLIC_KEY) {
      button.disabled = true;
      setPushMessage("As notificações ainda não foram configuradas pelo administrador.");
      return;
    }
    if (Notification.permission === "denied") {
      button.disabled = true;
      setPushMessage("Notificações bloqueadas neste navegador. Altere a permissão nas configurações do site.", true);
      return;
    }
    let subscription = null;
    try {
      const registration = await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const {error} = await db.rpc("registrar_assinatura_push", {
          p_token: token(),
          p_subscription: subscription.toJSON()
        });
        if (error) throw error;
      }
      button.disabled = false;
      button.textContent = subscription ? "Desativar notificações neste celular" : "Ativar notificações neste celular";
      setPushMessage(subscription ? "Este celular está inscrito para receber avisos." : "Ative para receber avisos dos jogos neste celular.");
    } catch (error) {
      console.error("Não foi possível consultar a inscrição de notificações.", error);
      button.disabled = false;
      if (subscription) button.textContent = "Desativar notificações neste celular";
      setPushMessage("Não foi possível sincronizar a inscrição. Tente novamente.", true);
    }
  }

  async function togglePushNotifications() {
    const button = $("pushNotificationsBtn");
    button.disabled = true;
    try {
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") {
        setPushMessage(permission === "denied"
          ? "Notificações bloqueadas neste navegador. Altere a permissão nas configurações do site."
          : "Permissão para notificações não concedida.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const {error} = await db.rpc("remover_assinatura_push", {
          p_token: token(),
          p_endpoint: subscription.endpoint
        });
        if (error) throw error;
        const unsubscribed = await subscription.unsubscribe();
        if (!unsubscribed) throw new Error("O navegador nao confirmou a desativacao das notificacoes.");
        setPushMessage("Notificações desativadas neste celular.");
      } else {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyBytes(cfg.SUPABASE_VAPID_PUBLIC_KEY)
        });
        const {error} = await db.rpc("registrar_assinatura_push", {
          p_token: token(),
          p_subscription: subscription.toJSON()
        });
        if (error) {
          await subscription.unsubscribe();
          throw error;
        }
        setPushMessage("Notificações ativadas neste celular.");
      }
    } catch (error) {
      console.error("Não foi possível atualizar as notificações.", error);
      setPushMessage(error.message || "Não foi possível atualizar as notificações.", true);
    } finally {
      await refreshPushState();
    }
  }

  async function notifyCapacityReached() {
    if (!game?.id || occupied < CAPACITY) return;
    const {data, error} = await db.functions.invoke("notificar-push", {
      body: {
        eventType: "lotacao",
        gameId: game.id,
        eventKey: `lotacao:${game.id}`,
        playerToken: token()
      }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  }

  function logout() {
    try {
      clearToken();
      location.reload();
    } catch (error) {
      console.error("Não foi possível encerrar a sessão do jogador.", error);
      say("identityHint","Não foi possível limpar a sessão neste navegador. Feche esta janela e tente novamente.",true);
    }
  }

  function renderList() {
    const list = $("participantsList");
    if (!participants.length) {
      list.innerHTML = '<p class="muted">Ainda não há confirmações para este jogo.</p>';
      return;
    }
    list.innerHTML = participants.map(p => `<div class="person">
      <div class="avatar">${esc((p.nome || "?").slice(0,1).toUpperCase())}</div>
      <div class="person-info"><div class="person-name">${esc(p.nome)}</div>
      <div class="person-detail">${p.tipo === "convidado" ? `Convidado de ${esc(p.convidado_por || "jogador")}` : "Jogador"}</div></div>
      <span class="status ${p.tipo === "convidado" ? "guest-tag" : ""}">${p.tipo === "convidado" ? "CONVIDADO" : "Confirmado"}</span>
    </div>`).join("");
  }

  function updateCount(data) {
    occupied = Number(data.total_ocupadas ?? participants.length);
    $("countLabel").textContent = `${occupied} / ${CAPACITY}`;
    $("progressBar").style.width = `${Math.min(100,occupied/CAPACITY*100)}%`;
    const closed = !game || Boolean(game.fechado) || occupied >= CAPACITY;
    $("gameStatus").textContent = !game ? "Aguardando jogo" : closed ? "Fechado" : "Aberto";
    $("closedNotice").classList.toggle("hidden", !closed);
    $("confirmationArea").classList.toggle("hidden", !member || !game || closed);
    $("guestArea").classList.toggle("hidden", !member || !game || closed);
  }

  async function load() {
    $("playerLogoutBtn").classList.add("hidden");
    if (!token()) {
      $("pushSettings").classList.add("hidden");
      $("connectionStatus").textContent = "Link individual necessário";
      $("identityText").textContent = "Entre pelo seu link individual.";
      $("identityHint").textContent = "Solicite seu link individual ao administrador. Use Início para consultar a lista pública de jogadores.";
      $("gameDate").textContent = "Aguardando link individual";
      $("gameSubtitle").textContent = "O jogo e a lista pública estão disponíveis na tela inicial.";
      $("participantsList").innerHTML = '<p class="muted">Abra seu link individual para ver as confirmações.</p>';
      $("confirmationArea").classList.add("hidden");
      $("guestArea").classList.add("hidden");
      return;
    }
    $("connectionStatus").textContent = "Verificando acesso...";
    const {data, error} = await db.rpc("obter_painel_socio", {p_token:token()});
    if (error) throw error;
    if (!data?.socio) {
      clearToken();
      member = null; game = null;
      $("pushSettings").classList.add("hidden");
      $("connectionStatus").textContent = "Acesso não encontrado";
      $("identityText").textContent = "Não foi possível identificar este jogador.";
      $("identityHint").textContent = "Esse link não está ativo ou não é válido. Peça ao administrador um novo link individual.";
      $("participantsList").innerHTML = '<p class="muted">Não foi possível carregar os jogadores confirmados.</p>';
      updateCount(data || {});
      return;
    }
    member = data.socio; game = data.jogo || null; participants = data.confirmados || [];
    $("playerLogoutBtn").classList.remove("hidden");
    $("connectionStatus").textContent = "Conectado";
    $("identityText").textContent = `Olá, ${member.nome}!`;
    $("identityHint").textContent = "Este é seu acesso individual ao Futebol de Sexta.";
    refreshPushState().catch(error => {
      console.error("Não foi possível atualizar o controle de notificações.", error);
      setPushMessage("Não foi possível verificar as notificações neste navegador.", true);
    });
    $("gameDate").textContent = dateLabel(game?.data_jogo, game?.hora);
    $("gameSubtitle").textContent = game ? "Confirme sua participação para o próximo jogo." : "Aguarde o administrador cadastrar um jogo.";
    const mine = String(data.minha_confirmacao || "").toLowerCase();
    say("confirmationMessage", mine === "sim" ? "Você já confirmou sua presença." : mine === "nao" ? "Você informou que não vai." : "");
    if (data.meu_convidado) {
      $("guestName").value = data.meu_convidado.nome || "";
      $("guestName").disabled = true; $("guestBtn").disabled = true;
      say("guestMessage", `Convidado cadastrado: ${data.meu_convidado.nome}.`);
    } else {
      $("guestName").disabled = data.pode_convidar === false;
      $("guestBtn").disabled = data.pode_convidar === false;
      say("guestMessage", data.pode_convidar === false ? "Não há vaga disponível para convidado." : "");
    }
    renderList();
    updateCount(data);
  }

  async function confirm(value) {
    $("yesBtn").disabled = $("noBtn").disabled = true;
    try {
      const {data,error} = await db.rpc("confirmar_presenca",{p_token:token(),p_confirmou:value});
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      say("confirmationMessage",value ? "Presença confirmada!" : "Você informou que não vai.");
      await load();
      if (value) {
        try {
          await notifyCapacityReached();
        } catch (notificationError) {
          console.error("A presença foi confirmada, mas não foi possível avisar sobre a lotação.", notificationError);
          say("confirmationMessage", "Presença confirmada, mas não foi possível enviar o aviso de lotação.", true);
        }
      }
    } catch(e) { say("confirmationMessage",e.message || "Não foi possível registrar.",true); }
    finally { $("yesBtn").disabled = $("noBtn").disabled = false; }
  }

  async function addGuest() {
    const name = $("guestName").value.trim();
    if (name.length < 3) return say("guestMessage","Informe o nome completo do convidado.",true);
    $("guestBtn").disabled = true;
    try {
      const {data,error} = await db.rpc("cadastrar_convidado",{p_token:token(),p_nome:name});
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      say("guestMessage","Convidado cadastrado com sucesso.");
      await load();
      try {
        await notifyCapacityReached();
      } catch (notificationError) {
        console.error("O convidado foi cadastrado, mas não foi possível avisar sobre a lotação.", notificationError);
        say("guestMessage", "Convidado cadastrado, mas não foi possível enviar o aviso de lotação.", true);
      }
    } catch(e) { say("guestMessage",e.message || "Não foi possível cadastrar.",true); $("guestBtn").disabled = false; }
  }

  async function init() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase?.createClient) throw new Error("Confira config.js e sua conexão com a internet.");
    restoreToken();
    db = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    $("playerLogoutBtn").addEventListener("click",logout);
    $("pushNotificationsBtn").addEventListener("click",togglePushNotifications);
    $("yesBtn").addEventListener("click",()=>confirm(true));
    $("noBtn").addEventListener("click",()=>confirm(false));
    $("guestBtn").addEventListener("click",addGuest);
    await load();
  }
  init().catch(e => { console.error(e); $("connectionStatus").textContent = "Erro ao carregar"; say("identityHint",e.message || "Erro ao consultar o banco.",true); });
})();
