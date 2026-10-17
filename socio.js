(() => {
  "use strict";
  const cfg = window.FUTEBOL_CONFIG || {};
  const $ = id => document.getElementById(id);
  const CAPACITY = 18;
  let db = null, member = null, game = null, participants = [];

  const token = () => new URL(location.href).searchParams.get("socio");
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

  function renderList() {
    const list = $("participantsList");
    if (!participants.length) {
      list.innerHTML = '<p class="muted">Ainda não há confirmações para este jogo.</p>';
      return;
    }
    list.innerHTML = participants.map(p => `<div class="person">
      <div class="avatar">${esc((p.nome || "?").slice(0,1).toUpperCase())}</div>
      <div class="person-info"><div class="person-name">${esc(p.nome)}</div>
      <div class="person-detail">${p.tipo === "convidado" ? `Convidado de ${esc(p.convidado_por || "sócio")}` : "Sócio"}</div></div>
      <span class="status ${p.tipo === "convidado" ? "guest-tag" : ""}">${p.tipo === "convidado" ? "CONVIDADO" : "Confirmado"}</span>
    </div>`).join("");
  }

  function updateCount(data) {
    const n = Number(data.total_ocupadas ?? participants.length);
    $("countLabel").textContent = `${n} / ${CAPACITY}`;
    $("progressBar").style.width = `${Math.min(100,n/CAPACITY*100)}%`;
    const closed = !game || Boolean(game.fechado) || n >= CAPACITY;
    $("gameStatus").textContent = !game ? "Aguardando jogo" : closed ? "Fechado" : "Aberto";
    $("closedNotice").classList.toggle("hidden", !closed);
    $("confirmationArea").classList.toggle("hidden", !member || !game || closed);
    $("guestArea").classList.toggle("hidden", !member || !game || closed);
  }

  async function load() {
    if (!token()) {
      $("connectionStatus").textContent = "Link individual necessário";
      $("identityText").textContent = "Entre pelo seu link individual.";
      $("identityHint").textContent = "Solicite seu link ao administrador. Use o botão Início para consultar a lista pública.";
      $("confirmationArea").classList.add("hidden");
      $("guestArea").classList.add("hidden");
      return;
    }
    $("connectionStatus").textContent = "Verificando acesso...";
    const {data, error} = await db.rpc("obter_painel_socio", {p_token:token()});
    if (error) throw error;
    if (!data?.socio) {
      member = null; game = null;
      $("connectionStatus").textContent = "Acesso não encontrado";
      $("identityText").textContent = "Não foi possível identificar este sócio.";
      $("identityHint").textContent = "Confira se o link está completo.";
      $("activationBox").classList.remove("hidden");
      updateCount(data || {});
      return;
    }
    member = data.socio; game = data.jogo || null; participants = data.confirmados || [];
    $("activationBox").classList.add("hidden");
    $("connectionStatus").textContent = "Conectado";
    $("identityText").textContent = `Olá, ${member.nome}!`;
    $("identityHint").textContent = "Este é seu acesso individual ao Futebol de Sexta.";
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
    } catch(e) { say("guestMessage",e.message || "Não foi possível cadastrar.",true); $("guestBtn").disabled = false; }
  }

  async function activate() {
    const code = $("activationCode").value.trim();
    if (!code) return say("identityHint","Digite o código de ativação.",true);
    try {
      const {data,error} = await db.rpc("ativar_socio",{p_token:token(),p_codigo:code});
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      location.reload();
    } catch(e) { say("identityHint",e.message || "Não foi possível ativar o acesso.",true); }
  }

  async function init() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase?.createClient) throw new Error("Confira config.js e sua conexão com a internet.");
    db = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    $("yesBtn").addEventListener("click",()=>confirm(true));
    $("noBtn").addEventListener("click",()=>confirm(false));
    $("guestBtn").addEventListener("click",addGuest);
    $("activateBtn").addEventListener("click",activate);
    await load();
  }
  init().catch(e => { console.error(e); $("connectionStatus").textContent = "Erro ao carregar"; say("identityHint",e.message || "Erro ao consultar o banco.",true); });
})();
