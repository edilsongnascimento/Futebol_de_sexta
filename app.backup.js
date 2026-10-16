(() => {
  const cfg = window.FUTEBOL_CONFIG || {};
  const $ = id => document.getElementById(id);
  const capacity = 18;
  let supabase = null, member = null, game = null, deferredInstall = null;
  let participants = [];

  function say(id, message, isError=false) {
    const el = $(id); el.textContent = message;
    el.style.color = isError ? "#a83d2d" : "";
  }
  function getLinkToken() {
    const url = new URL(location.href);
    return url.searchParams.get("socio");
  }
  function setStatus(text) { $("connectionStatus").textContent = text; }
  function prettyDate(date) {
    return new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"2-digit",month:"long"}).format(date);
  }
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function showParticipantList() {
    const list = $("participantsList");
    $("listCount").textContent = `${participants.length} confirmados`;
    if (!participants.length) {
      list.innerHTML = '<p class="muted">Ainda não há confirmações para este jogo.</p>'; return;
    }
    list.innerHTML = participants.map(p => `
      <div class="person">
        <div class="avatar">${escapeHTML((p.nome || "?").trim().slice(0,1).toUpperCase())}</div>
        <div class="person-info"><div class="person-name">${escapeHTML(p.nome)}</div>
        <div class="person-detail">${p.tipo === "convidado" ? `Convidado de ${escapeHTML(p.convidado_por || "sócio")}` : "Sócio"}</div></div>
        <span class="status yes">Confirmado</span>
      </div>`).join("");
  }
  function updateCount() {
    const n = participants.length;
    $("countLabel").textContent = `${n} / ${capacity}`;
    $("progressBar").style.width = `${Math.min(100, n/capacity*100)}%`;
    const closed = Boolean(game?.fechado) || n >= capacity;
    $("gameStatus").textContent = closed ? "Fechado" : "Aberto";
    $("closedNotice").classList.toggle("hidden", !closed);
    $("confirmationArea").classList.toggle("hidden", !member || closed);
    $("guestArea").classList.toggle("hidden", !member || closed);
  }
  async function init() {
    const token = getLinkToken();
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.startsWith("COLE_AQUI") ||
        !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.startsWith("COLE_AQUI")) {
      setStatus("Configuração pendente");
      $("identityText").textContent = "O aplicativo está pronto para configurar, mas ainda precisa ser conectado ao Supabase.";
      $("identityHint").textContent = "Siga o arquivo LEIA-ME.txt e execute supabase.sql antes de usar com os sócios.";
      $("gameDate").textContent = "Sexta-feira, 19h30";
      $("gameSubtitle").textContent = "Configure o banco de dados para ativar as confirmações.";
      $("gameStatus").textContent = "Demonstração";
      $("participantsList").innerHTML = '<p class="muted">A lista aparecerá depois de conectar o banco de dados.</p>';
      $("countLabel").textContent = "0 / 18";
      return;
    }
    if (!window.supabase?.createClient) {
      setStatus("Erro de conexão");
      $("identityText").textContent = "Não foi possível carregar a biblioteca do banco de dados. Verifique a internet.";
      return;
    }
    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    if (!token) {
      setStatus("Link individual necessário");
      $("identityText").textContent = "Abra o link individual enviado pelo administrador para identificar seu cadastro.";
      $("identityHint").textContent = "O link contém um código exclusivo. Não o compartilhe com outras pessoas.";
      return;
    }
    setStatus("Verificando acesso…");
    try {
      const { data, error } = await supabase.rpc("obter_painel_socio", { p_token: token });
      if (error) throw error;
      if (!data?.socio) {
        setStatus("Acesso não ativado");
        $("identityText").textContent = "Este link não foi encontrado, foi revogado ou ainda não foi ativado.";
        $("activationBox").classList.remove("hidden");
        $("activationBtn")?.addEventListener("click", activate);
        $("identityHint").textContent = "Solicite ao administrador um link válido e o código de ativação.";
        return;
      }
      member = data.socio; game = data.jogo;
      $("identityText").textContent = `Você está identificado como ${member.nome}.`;
      $("identityHint").textContent = "Este acesso permite agir somente em seu próprio nome.";
      setStatus("Identificado");
      if (game?.data_jogo) {
        const d = new Date(`${game.data_jogo}T12:00:00`);
        $("gameDate").textContent = `${prettyDate(d)} · 19h30`;
      }
      $("gameSubtitle").textContent = game ? "Sua presença no próximo jogo" : "O próximo jogo ainda não foi publicado.";
      participants = data.confirmados || [];
      showParticipantList(); updateCount();
      const my = (data.minha_confirmacao || "").toLowerCase();
      if (my === "sim") say("confirmationMessage","Você já confirmou sua participação.");
      else if (my === "nao") say("confirmationMessage","Você informou que não vai.");
      if (data.meu_convidado) {
        $("guestName").value = data.meu_convidado.nome || "";
        $("guestName").disabled = true;
        $("guestBtn").disabled = true;
        say("guestMessage",`Convidado cadastrado: ${data.meu_convidado.nome}.`);
      } else if (data.pode_convidar === false) {
        $("guestName").disabled = true; $("guestBtn").disabled = true;
        say("guestMessage","No momento não há vaga liberada para convidado.");
      }
    } catch (err) {
      console.error(err); setStatus("Erro ao carregar");
      $("identityText").textContent = "Não foi possível consultar os dados. Confira a configuração e as permissões do banco.";
      $("identityHint").textContent = err.message || "Erro de conexão.";
    }
  }
  async function confirm(value) {
    if (!member || !game) return;
    $("yesBtn").disabled = $("noBtn").disabled = true;
    try {
      const { data, error } = await supabase.rpc("confirmar_presenca", {
        p_token: getLinkToken(), p_confirmou: value
      });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      say("confirmationMessage", value ? "Presença confirmada!" : "Você informou que não vai.");
      await refreshPanel();
    } catch (e) { say("confirmationMessage",e.message || "Não foi possível registrar.",true); }
    finally { $("yesBtn").disabled = $("noBtn").disabled = false; }
  }
  async function addGuest() {
    const name = $("guestName").value.trim();
    if (name.length < 3) { say("guestMessage","Informe o nome completo do convidado.",true); return; }
    $("guestBtn").disabled = true;
    try {
      const { data, error } = await supabase.rpc("cadastrar_convidado", { p_token:getLinkToken(), p_nome:name });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      say("guestMessage","Convidado cadastrado com sucesso.");
      $("guestName").disabled = true;
      await refreshPanel();
    } catch (e) { say("guestMessage",e.message || "Não foi possível cadastrar o convidado.",true); $("guestBtn").disabled = false; }
  }
  async function refreshPanel() {
    const { data, error } = await supabase.rpc("obter_painel_socio", { p_token:getLinkToken() });
    if (error) throw error;
    game = data.jogo; participants = data.confirmados || [];
    showParticipantList(); updateCount();
  }
  async function activate() {
    const code = $("activationCode").value.trim();
    if (!code) { say("identityHint","Digite o código fornecido pelo administrador.",true); return; }
    try {
      const { data, error } = await supabase.rpc("ativar_socio", { p_token:getLinkToken(), p_codigo:code });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      location.reload();
    } catch(e) { say("identityHint",e.message || "Não foi possível ativar.",true); }
  }
  $("yesBtn").addEventListener("click",()=>confirm(true));
  $("noBtn").addEventListener("click",()=>confirm(false));
  $("guestBtn").addEventListener("click",addGuest);
  $("activateBtn").addEventListener("click",activate);
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault(); deferredInstall = event; $("installBtn").classList.remove("hidden");
  });
  $("installBtn").addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt(); await deferredInstall.userChoice;
    deferredInstall = null; $("installBtn").classList.add("hidden");
  });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(console.warn));
  }
  init();
})();