(() => {
  "use strict";
  const cfg = window.FUTEBOL_CONFIG || {};
  const $ = id => document.getElementById(id);
  const CAPACITY = 18;
  let db = null;

  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[c]);

  function prettyDate(dateText, time) {
    if (!dateText) return "Jogo ainda não publicado";
    const d = new Date(`${dateText}T12:00:00`);
    const day = new Intl.DateTimeFormat("pt-BR", {weekday:"long", day:"2-digit", month:"long"}).format(d);
    return `${day} · ${String(time || "19:30").slice(0,5)}`;
  }

  function renderPeople(target, rows, emptyText, guestMode = false) {
    const el = $(target);
    if (!rows.length) {
      el.innerHTML = `<p class="muted">${escapeHTML(emptyText)}</p>`;
      return;
    }
    el.innerHTML = rows.map(p => {
      const isGuest = p.tipo === "convidado";
      const label = isGuest
        ? `<span class="status guest-tag">CONVIDADO</span>`
        : `<span class="status">${escapeHTML(p.situacao_label || "Jogador")}</span>`;
      const detail = isGuest
        ? `Convidado de ${escapeHTML(p.convidado_por || "jogador")}`
        : "Jogador";
      return `<div class="person">
        <div class="avatar">${escapeHTML((p.nome || "?").trim().slice(0,1).toUpperCase())}</div>
        <div class="person-info"><div class="person-name">${escapeHTML(p.nome)}</div><div class="person-detail">${detail}</div></div>
        ${label}
      </div>`;
    }).join("");
  }

  function showError(message) {
    $("publicMessage").textContent = message;
    $("publicMessage").classList.add("error-text");
  }

  async function loadPublic() {
    $("publicMessage").textContent = "";
    const {data, error} = await db.rpc("obter_painel_publico");
    if (error) throw error;
    if (!data) throw new Error("O banco não retornou dados.");
    const game = data.jogo;
    const confirmed = data.confirmados || [];
    const pending = data.nao_confirmados || [];
    const declined = data.nao_vai || [];
    const count = Number(data.total_ocupadas ?? confirmed.length);
    $("gameDate").textContent = prettyDate(game?.data_jogo, game?.hora);
    $("gameSubtitle").textContent = game
      ? "Consulte a situação das confirmações para este jogo."
      : "O administrador ainda não publicou o próximo jogo.";
    const closed = !game || Boolean(game.fechado) || count >= CAPACITY;
    $("gameStatus").textContent = !game ? "Aguardando jogo" : closed ? "Confirmações fechadas" : "Confirmações abertas";
    $("gameStatus").classList.toggle("status-closed", closed);
    $("countLabel").textContent = `${count} / ${CAPACITY}`;
    $("progressBar").style.width = `${Math.min(100, count / CAPACITY * 100)}%`;

    const combinedConfirmed = confirmed.map(p => ({...p, situacao_label:"Confirmado"}));
    renderPeople("confirmedList", combinedConfirmed, "Ninguém confirmou presença ainda.");
    renderPeople("pendingList", pending.map(p => ({...p, situacao_label:"Não respondeu"})), "Todos os jogadores já responderam.");
    renderPeople("declinedList", declined.map(p => ({...p, situacao_label:"Não vai"})), "Nenhum jogador informou que não vai.");
    if (!game) showError("Ainda não existe um jogo futuro cadastrado.");
  }

  async function init() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase?.createClient) {
      throw new Error("Configuração do Supabase incompleta. Confira config.js e a conexão com a internet.");
    }
    db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    $("refreshBtn").addEventListener("click", () => loadPublic().catch(e => showError(e.message)));
    await loadPublic();
  }

  init().catch(error => {
    console.error(error);
    $("gameDate").textContent = "Não foi possível carregar o jogo";
    showError(error.message || "Erro ao consultar o Supabase.");
    renderPeople("confirmedList", [], "Lista indisponível.");
    renderPeople("pendingList", [], "Lista indisponível.");
    renderPeople("declinedList", [], "Lista indisponível.");
  });
})();
