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

  function teamBalanceScore(teams) {
    const differences = (key, combine = false) => {
      const counts = teams.map(team => {
        const result = new Map();
        team.forEach(player => {
          const value = combine
            ? `${player.posicao || ""}|${player.nivel ?? ""}`
            : player[key];
          if (value !== null && value !== undefined && value !== "") {
            result.set(value, (result.get(value) || 0) + 1);
          }
        });
        return result;
      });
      const categories = new Set([...counts[0].keys(), ...counts[1].keys()]);
      return [...categories].reduce((score, category) =>
        score + ((counts[0].get(category) || 0) - (counts[1].get(category) || 0)) ** 2, 0);
    };
    const positionDifference = differences("posicao");
    const levelDifference = differences("nivel");
    return [
      Math.abs(teams[0].length - teams[1].length),
      positionDifference + levelDifference,
      Math.max(positionDifference, levelDifference),
      positionDifference,
      levelDifference,
      differences("", true)
    ];
  }

  function compareTeamScores(first, second) {
    for (let index = 0; index < first.length; index++) {
      if (first[index] !== second[index]) return first[index] - second[index];
    }
    return 0;
  }

  function splitIntoTeams(players) {
    const positionCounts = new Map();
    const levelCounts = new Map();
    players.forEach(player => {
      if (player.posicao) positionCounts.set(player.posicao, (positionCounts.get(player.posicao) || 0) + 1);
      if (player.nivel != null) levelCounts.set(String(player.nivel), (levelCounts.get(String(player.nivel)) || 0) + 1);
    });
    const ordered = [...players].sort((a, b) => {
      const rarityA = (positionCounts.get(a.posicao) || 0) + (levelCounts.get(String(a.nivel ?? "")) || 0);
      const rarityB = (positionCounts.get(b.posicao) || 0) + (levelCounts.get(String(b.nivel ?? "")) || 0);
      return rarityA - rarityB
        || String(a.posicao || "").localeCompare(String(b.posicao || ""), "pt-BR")
        || Number(a.nivel || 0) - Number(b.nivel || 0)
        || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
    });
    const teams = [[], []];
    if (ordered.length > 18) {
      ordered.forEach(player => {
        if (teams[0].length < teams[1].length) teams[0].push(player);
        else if (teams[1].length < teams[0].length) teams[1].push(player);
        else {
          teams[0].push(player);
          const scoreA = teamBalanceScore(teams);
          teams[0].pop();
          teams[1].push(player);
          const scoreB = teamBalanceScore(teams);
          teams[1].pop();
          teams[compareTeamScores(scoreA, scoreB) <= 0 ? 0 : 1].push(player);
        }
      });
      return teams;
    }

    const targetSizes = [Math.ceil(ordered.length / 2), Math.floor(ordered.length / 2)];
    let bestTeams = null;
    let bestScore = null;
    function search(index) {
      if (index === ordered.length) {
        const score = teamBalanceScore(teams);
        if (!bestScore || compareTeamScores(score, bestScore) < 0) {
          bestScore = score;
          bestTeams = teams.map(team => [...team]);
        }
        return;
      }
      const player = ordered[index];
      teams.forEach((team, teamIndex) => {
        if (team.length >= targetSizes[teamIndex]) return;
        team.push(player);
        search(index + 1);
        team.pop();
      });
    }
    search(0);
    return bestTeams || teams;
  }

  function renderConfirmedTeams(players) {
    const list = $("confirmedList");
    if (!players.length) {
      list.innerHTML = '<p class="muted">Ninguém confirmou presença ainda.</p>';
      return;
    }
    const teams = splitIntoTeams(players);
    list.innerHTML = teams.map((team, index) => `
      <section class="team-column">
        <h4>Time ${index === 0 ? "A" : "B"}</h4>
        ${team.length ? team.map(player => {
          const isGuest = player.tipo === "convidado";
          const detail = isGuest
            ? `Convidado de ${escapeHTML(player.convidado_por || "jogador")}`
            : `${escapeHTML(player.posicao || "Posição pendente")} · Nível ${escapeHTML(player.nivel ?? "—")}`;
          return `<div class="person">
            <div class="avatar">${escapeHTML((player.nome || "?").trim().slice(0,1).toUpperCase())}</div>
            <div class="person-info">
              <div class="person-name">${escapeHTML(player.nome)}</div>
              <div class="person-detail">${detail}</div>
            </div>
            ${isGuest ? '<span class="status guest-tag">CONVIDADO</span>' : ""}
          </div>`;
        }).join("") : '<p class="muted">Aguardando confirmações.</p>'}
      </section>`).join("");
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
    $("gameStatus").classList.toggle("status-open", Boolean(game) && !closed);
    $("gameStatus").classList.toggle("status-closed", Boolean(game) && closed);
    $("countLabel").textContent = `${count} / ${CAPACITY}`;
    $("progressBar").style.width = `${Math.min(100, count / CAPACITY * 100)}%`;

    renderConfirmedTeams(confirmed);
    renderPeople("pendingList", pending.map(p => ({...p, situacao_label:"Ainda não confirmou"})), "Todos os jogadores já responderam.");
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
