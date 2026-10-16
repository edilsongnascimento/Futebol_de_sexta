(() => {
  "use strict";

  const cfg = window.FUTEBOL_CONFIG || {};
  const $ = id => document.getElementById(id);
  const capacity = 18;

  let supabase = null;
  let member = null;
  let game = null;
  let participants = [];
  let deferredInstall = null;

  function say(id, message, isError = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "#a83d2d" : "";
  }

  function setStatus(message) {
    say("connectionStatus", message);
  }

  function getToken() {
    return new URL(location.href).searchParams.get("socio");
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }

  function prettyDate(date) {
    return new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long"
    }).format(date);
  }

  function showParticipantList() {
    const list = $("participantsList");
    if (!list) return;

    $("listCount").textContent =
      `${participants.length} confirmados`;

    if (!participants.length) {
      list.innerHTML =
        '<p class="muted">Ainda não há confirmações para este jogo.</p>';
      return;
    }

    list.innerHTML = participants.map(p => `
      <div class="person">
        <div class="avatar">
          ${escapeHTML((p.nome || "?").trim().slice(0, 1).toUpperCase())}
        </div>
        <div class="person-info">
          <div class="person-name">${escapeHTML(p.nome)}</div>
          <div class="person-detail">
            ${p.tipo === "convidado"
              ? `Convidado de ${escapeHTML(p.convidado_por || "sócio")}`
              : "Sócio"}
          </div>
        </div>
        <span class="status yes">Confirmado</span>
      </div>
    `).join("");
  }

  function updateCount() {
    const n = participants.length;

    $("countLabel").textContent = `${n} / ${capacity}`;
    $("progressBar").style.width =
      `${Math.min(100, n / capacity * 100)}%`;

    const closed = Boolean(game?.fechado) || n >= capacity;

    $("gameStatus").textContent = closed ? "Fechado" : "Aberto";
    $("closedNotice").classList.toggle("hidden", !closed);
    $("confirmationArea").classList.toggle(
      "hidden", !member || !game || closed
    );
    $("guestArea").classList.toggle(
      "hidden", !member || !game || closed
    );
  }

  async function loadMemberPanel() {
    const token = getToken();

    if (!token) {
      setStatus("Link individual necessário");
      $("identityText").textContent =
        "Abra seu link individual para acessar sua participação.";
      $("identityHint").textContent =
        "Solicite seu link ao administrador do grupo.";
      $("confirmationArea").classList.add("hidden");
      $("guestArea").classList.add("hidden");
      return;
    }

    setStatus("Verificando acesso...");

    try {
      const { data, error } = await supabase.rpc(
        "obter_painel_socio",
        { p_token: token }
      );

      if (error) throw error;

      if (!data?.socio) {
        member = null;
        game = null;

        setStatus("Acesso não encontrado");
        $("identityText").textContent =
          "Não foi possível identificar este sócio.";
        $("identityHint").textContent =
          "Confira o link com o administrador.";
        $("activationBox").classList.remove("hidden");
        updateCount();
        return;
      }

      member = data.socio;
      game = data.jogo || null;
      participants = data.confirmados || [];

      $("activationBox").classList.add("hidden");
      $("identityText").textContent =
        `Você está identificado como ${member.nome}.`;
      $("identityHint").textContent =
        "Este link identifica seu cadastro individual.";

      if (game?.data_jogo) {
        const date = new Date(`${game.data_jogo}T12:00:00`);
        $("gameDate").textContent =
          `${prettyDate(date)} · ${game.hora || "19:30"}`;
      } else {
        $("gameDate").textContent = "Jogo ainda não publicado";
      }

      $("gameSubtitle").textContent = game
        ? "Consulte sua presença para o próximo jogo."
        : "Aguarde o administrador publicar um jogo.";

      const confirmation =
        String(data.minha_confirmacao || "").toLowerCase();

      if (confirmation === "sim") {
        say("confirmationMessage", "Você já confirmou sua participação.");
      } else if (confirmation === "nao") {
        say("confirmationMessage", "Você informou que não vai.");
      } else {
        say("confirmationMessage", "");
      }

      if (data.meu_convidado) {
        $("guestName").value = data.meu_convidado.nome || "";
        $("guestName").disabled = true;
        $("guestBtn").disabled = true;
        say("guestMessage",
          `Convidado cadastrado: ${data.meu_convidado.nome}.`);
      } else {
        $("guestName").disabled = false;
        $("guestBtn").disabled = false;

        if (data.pode_convidar === false) {
          $("guestName").disabled = true;
          $("guestBtn").disabled = true;
          say("guestMessage", "Não há vaga liberada para convidado.");
        } else {
          say("guestMessage", "");
        }
      }

      setStatus("Conectado");
      showParticipantList();
      updateCount();

    } catch (error) {
      console.error(error);
      setStatus("Erro ao carregar");
      $("identityText").textContent =
        "Não foi possível consultar os dados.";
      $("identityHint").textContent =
        error.message || "Confira a conexão com o Supabase.";
    }
  }

  async function confirmPresence(value) {
    if (!member || !game) return;

    $("yesBtn").disabled = true;
    $("noBtn").disabled = true;

    try {
      const { data, error } = await supabase.rpc(
        "confirmar_presenca",
        {
          p_token: getToken(),
          p_confirmou: value
        }
      );

      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);

      say("confirmationMessage",
        value ? "Presença confirmada!" : "Você informou que não vai.");

      await loadMemberPanel();

    } catch (error) {
      say("confirmationMessage",
        error.message || "Não foi possível registrar.", true);
    } finally {
      $("yesBtn").disabled = false;
      $("noBtn").disabled = false;
    }
  }

  async function addGuest() {
    if (!member || !game) return;

    const name = $("guestName").value.trim();

    if (name.length < 3) {
      say("guestMessage", "Informe o nome do convidado.", true);
      return;
    }

    $("guestBtn").disabled = true;

    try {
      const { data, error } = await supabase.rpc(
        "cadastrar_convidado",
        {
          p_token: getToken(),
          p_nome: name
        }
      );

      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);

      say("guestMessage", "Convidado cadastrado com sucesso.");
      await loadMemberPanel();

    } catch (error) {
      say("guestMessage",
        error.message || "Não foi possível cadastrar o convidado.", true);
      $("guestBtn").disabled = false;
    }
  }

  async function activateMember() {
    const code = $("activationCode").value.trim();

    if (!code) {
      say("identityHint", "Digite o código de ativação.", true);
      return;
    }

    try {
      const { data, error } = await supabase.rpc(
        "ativar_socio",
        {
          p_token: getToken(),
          p_codigo: code
        }
      );

      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);

      location.reload();

    } catch (error) {
      say("identityHint",
        error.message || "Não foi possível ativar o acesso.", true);
    }
  }

  // ADMINISTRAÇÃO

  function openAdminLogin() {
    $("adminPanel").classList.remove("hidden");
    $("adminLoginForm").classList.remove("hidden");
    $("adminContent").classList.add("hidden");
    $("adminEmail").focus();

    $("adminPanel").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  async function adminLogin() {
    const email = $("adminEmail").value.trim();
    const password = $("adminPassword").value;

    if (!email || !password) {
      say("adminMessage", "Informe e-mail e senha.", true);
      return;
    }

    $("adminSubmitBtn").disabled = true;
    say("adminMessage", "Entrando...");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
      if (!data.session) {
        throw new Error("Não foi possível iniciar a sessão.");
      }

      $("adminLoginForm").classList.add("hidden");
      $("adminContent").classList.remove("hidden");
      $("adminLoginCard").classList.add("hidden");
      $("adminPassword").value = "";

      say("adminActionMessage",
        "Login realizado. As operações dependem das permissões de administrador.");
      say("adminMessage", "");

    } catch (error) {
      say("adminMessage",
        error.message || "Falha no login.", true);
    } finally {
      $("adminSubmitBtn").disabled = false;
    }
  }

  async function adminLogout() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      $("adminPanel").classList.add("hidden");
      $("adminLoginForm").classList.remove("hidden");
      $("adminContent").classList.add("hidden");
      $("adminLoginCard").classList.remove("hidden");
      say("adminMessage", "Você saiu da administração.");

    } catch (error) {
      say("adminActionMessage",
        error.message || "Não foi possível sair.", true);
    }
  }

  async function createMember() {
    const name = $("newMemberName").value.trim();

    if (name.length < 3) {
      say("adminActionMessage", "Informe o nome completo do sócio.", true);
      return;
    }

    $("createMemberBtn").disabled = true;
    say("adminActionMessage", "Criando cadastro...");

    try {
      const { data, error } = await supabase.rpc(
        "admin_criar_socio",
        { p_nome: name }
      );

      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);

      if (!data?.token || !data?.codigo_ativacao) {
        throw new Error(
          "O banco não retornou o link e o código. Confira a função SQL."
        );
      }

      const url = new URL(location.href);
      url.search = "";
      url.hash = "";
      url.searchParams.set("socio", data.token);

      const link = url.toString();

      const result = $("newMemberResult");
      result.classList.remove("hidden");

      result.innerHTML = `
        <h3>Sócio cadastrado</h3>
        <p><strong>Nome:</strong> ${escapeHTML(data.nome || name)}</p>
        <p><strong>Link individual:</strong></p>
        <p><a href="${escapeHTML(link)}">${escapeHTML(link)}</a></p>
        <p><strong>Código de ativação:</strong></p>
        <p>${escapeHTML(data.codigo_ativacao)}</p>
        <p class="muted">
          Guarde essas informações agora. O token e o código não devem
          ser publicados em grupos abertos.
        </p>
        <button id="copyMemberLinkBtn" class="btn btn-secondary" type="button">
          Copiar link
        </button>
      `;

      $("copyMemberLinkBtn").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(link);
          say("adminActionMessage", "Link copiado.");
        } catch {
          say("adminActionMessage",
            "Não foi possível copiar automaticamente. Selecione o link acima.");
        }
      });

      $("newMemberName").value = "";
      say("adminActionMessage",
        "Sócio criado. Salve o link e o código de ativação.");

    } catch (error) {
      console.error(error);
      say("adminActionMessage",
        error.message || "Não foi possível criar o sócio.", true);
    } finally {
      $("createMemberBtn").disabled = false;
    }
  }

  async function createGame() {
    const date = $("gameInputDate").value;
    const time = $("gameInputTime").value || "19:30";

    if (!date) {
      say("adminActionMessage", "Escolha a data do jogo.", true);
      return;
    }

    $("createGameBtn").disabled = true;
    say("adminActionMessage", "Criando jogo...");

    try {
      const { data, error } = await supabase.rpc(
        "admin_criar_jogo",
        {
          p_data: date,
          p_hora: time
        }
      );

      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);

      say("adminActionMessage",
        `Jogo criado para ${date}, às ${time}.`);

      await loadMemberPanel();

    } catch (error) {
      console.error(error);
      say("adminActionMessage",
        error.message || "Não foi possível criar o jogo.", true);
    } finally {
      $("createGameBtn").disabled = false;
    }
  }

  async function init() {
    if (
      !cfg.SUPABASE_URL ||
      !cfg.SUPABASE_ANON_KEY ||
      cfg.SUPABASE_URL.startsWith("COLE_AQUI") ||
      cfg.SUPABASE_ANON_KEY.startsWith("COLE_AQUI")
    ) {
      setStatus("Configuração pendente");
      $("identityText").textContent =
        "Configure o arquivo config.js para conectar ao Supabase.";
      return;
    }

    if (!window.supabase?.createClient) {
      setStatus("Biblioteca indisponível");
      $("identityText").textContent =
        "Confira sua conexão com a internet.";
      return;
    }

    supabase = window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_ANON_KEY
    );

    $("yesBtn").addEventListener(
      "click", () => confirmPresence(true)
    );
    $("noBtn").addEventListener(
      "click", () => confirmPresence(false)
    );
    $("guestBtn").addEventListener("click", addGuest);
    $("activateBtn").addEventListener("click", activateMember);

    $("adminLoginBtn").addEventListener("click", openAdminLogin);
    $("adminSubmitBtn").addEventListener("click", adminLogin);
    $("adminLogoutBtn").addEventListener("click", adminLogout);
    $("createMemberBtn").addEventListener("click", createMember);
    $("createGameBtn").addEventListener("click", createGame);

    $("adminPassword").addEventListener("keydown", event => {
      if (event.key === "Enter") adminLogin();
    });

    await loadMemberPanel();

    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      $("adminLoginCard").classList.add("hidden");
      $("adminPanel").classList.remove("hidden");
      $("adminLoginForm").classList.add("hidden");
      $("adminContent").classList.remove("hidden");
    }

    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      deferredInstall = event;
      $("installBtn").classList.remove("hidden");
    });

    $("installBtn").addEventListener("click", async () => {
      if (!deferredInstall) return;
      await deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      $("installBtn").classList.add("hidden");
    });

    if ("serviceWorker" in navigator &&
        location.protocol.startsWith("http")) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(console.warn);
      });
    }
  }

  init().catch(error => {
    console.error(error);
    setStatus("Erro ao iniciar");
  });
})();