
(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const config = window.FUTEBOL_CONFIG || {};
  const supabaseUrl = (
    config.supabaseUrl ||
    config.SUPABASE_URL ||
    ""
  ).replace(/\/rest\/v1\/?$/, "");

  const supabaseKey =
    config.supabasePublishableKey ||
    config.SUPABASE_PUBLISHABLE_KEY ||
    config.SUPABASE_ANON_KEY ||
    "";

  const token = new URL(location.href).searchParams.get("socio");

  let client = null;
  let installPrompt = null;
  let busy = false;

  function status(id, message, error = false) {
    const el = $(id);
    if (!el) return;

    el.textContent = message || "";
    el.classList.toggle("error", error);
  }

  function notice(message) {
    const el = $("setupNotice");
    if (!el) return;

    el.replaceChildren();
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function hideLoading() {
    $("loading")?.classList.add("hidden");
  }

  function showApp() {
    $("app")?.classList.remove("hidden");
  }

  function showError(error, prefix = "Erro") {
    console.error("[Futebol de Sexta]", error);

    const message =
      error?.message ||
      error?.details ||
      error?.hint ||
      "Erro desconhecido.";

    notice(prefix + ": " + message);
  }

  async function rpc(name, args = {}) {
    if (!client) {
      throw new Error("A conexão com o Supabase não foi inicializada.");
    }

    const { data, error } = await client.rpc(name, args);

    if (error) {
      console.error("Erro na função " + name + ":", error);
      throw error;
    }

    return data;
  }

  function formatDate(value) {
    if (!value) return "Data não definida";

    const parts = String(value).slice(0, 10).split("-");

    if (parts.length !== 3) return String(value);

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function renderList(id, people, emptyMessage) {
    const root = $(id);
    if (!root) return;

    root.replaceChildren();

    if (!Array.isArray(people) || people.length === 0) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = emptyMessage;
      root.append(li);
      return;
    }

    people.forEach(person => {
      const li = document.createElement("li");
      li.textContent =
        typeof person === "string"
          ? person
          : person?.nome || "Participante";

      root.append(li);
    });
  }

  function standalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function showInstallOption() {
    const area = $("installArea");

    if (area) {
      area.classList.toggle(
        "hidden",
        !token || standalone()
      );
    }
  }

  async function installApp() {
    if (standalone()) return;

    if (installPrompt) {
      try {
        await installPrompt.prompt();

        const choice = await installPrompt.userChoice;

        status(
          "installHelp",
          choice?.outcome === "accepted"
            ? "Instalação solicitada. Abra pelo ícone quando terminar."
            : "Você pode instalar depois pelo menu do navegador."
        );
      } catch (error) {
        status(
          "installHelp",
          "Não foi possível abrir a instalação. Use o menu do navegador.",
          true
        );
      }

      installPrompt = null;
      showInstallOption();
      return;
    }

    status(
      "installHelp",
      "No Android, abra o menu ⋮ do Chrome e escolha “Instalar app” ou “Adicionar à tela inicial”."
    );
  }

  async function refresh() {
    const data = await rpc("obter_painel_socio", {
      p_token: token
    });

    if (!data || !data.socio) {
      if (data?.requer_ativacao) {
        throw new Error(
          "Seu acesso ainda precisa ser ativado. Solicite à administração as instruções de ativação."
        );
      }

      throw new Error(
        "O link individual é inválido, foi revogado ou ainda não foi ativado."
      );
    }

    const game = data.jogo || null;
    const confirmed = Array.isArray(data.confirmados)
      ? data.confirmados
      : [];

    const response = data.minha_confirmacao;

    $("memberName").textContent = data.socio.nome || "Sócio";

    $("memberMessage").textContent =
      "Confirme sua presença para o próximo jogo.";

    $("rsvpStatus").textContent =
      response === "sim"
        ? "Sua resposta: Vou jogar."
        : response === "nao"
          ? "Sua resposta: Não vou."
          : "Você ainda não respondeu.";

    $("gameTitle").textContent = game
      ? "Jogo de " + formatDate(game.data_jogo)
      : "Próximo jogo";

    $("gamePill").textContent = game
      ? String(game.hora || "").slice(0, 5)
      : "Sem jogo";

    $("gameInfo").textContent = !game
      ? "Ainda não há jogo publicado."
      : game.fechado
        ? "Este jogo está fechado para novas confirmações."
        : (game.local
            ? "Local: " + game.local + ". "
            : "") +
          "Confira sua presença para este jogo.";

    $("playersCount").textContent = confirmed.length;
    $("keepersCount").textContent = "—";
    $("reservesCount").textContent = game
      ? Math.max(0, 18 - confirmed.length)
      : "—";

    $("confirmedCount").textContent = confirmed.length;

    renderList(
      "confirmedList",
      confirmed,
      "Ainda não há participantes confirmados."
    );

    const pending = Array.isArray(data.pendentes)
      ? data.pendentes
      : [];

    $("pendingCount").textContent = pending.length;

    renderList(
      "pendingList",
      pending,
      "Nenhum pendente informado pelo banco."
    );

    const guest = data.meu_convidado;

    $("guestName").value = guest?.nome || "";

    // O app atual não recebe o telefone do convidado no retorno
    // do banco. Não apagar o telefone digitado durante a tela.
    const canRespond = !!game && !game.fechado;

    $("yesBtn").disabled = !canRespond;
    $("noBtn").disabled = !canRespond;

    $("guestBtn").disabled =
      !canRespond ||
      response !== "sim" ||
      !data.pode_convidar;

    $("removeGuestBtn").disabled = true;

    showInstallOption();
  }

  async function answer(willPlay) {
    if (busy) return;

    busy = true;
    status("rsvpStatus", "Salvando sua resposta…");

    $("yesBtn").disabled = true;
    $("noBtn").disabled = true;

    try {
      const result = await rpc("confirmar_presenca", {
        p_token: token,
        p_confirmou: willPlay
      });

      if (result?.ok === false) {
        throw new Error(
          result.mensagem || "Não foi possível salvar sua resposta."
        );
      }

      await refresh();

      status(
        "rsvpStatus",
        willPlay
          ? "Presença confirmada!"
          : "Resposta registrada: você não vai."
      );
    } catch (error) {
      status(
        "rsvpStatus",
        error?.message || "Não foi possível salvar sua resposta.",
        true
      );
    } finally {
      busy = false;

      try {
        await refresh();
      } catch (error) {
        console.error("Erro ao atualizar a tela:", error);
      }
    }
  }

  async function saveGuest() {
    if (busy) return;

    const name = $("guestName").value.trim();

    if (name.length < 2) {
      status(
        "guestStatus",
        "Informe o nome do convidado.",
        true
      );
      return;
    }

    busy = true;
    status("guestStatus", "Salvando convidado…");
    $("guestBtn").disabled = true;

    try {
      const result = await rpc("cadastrar_convidado", {
        p_token: token,
        p_nome: name
      });

      if (result?.ok === false) {
        throw new Error(
          result.mensagem || "Não foi possível cadastrar o convidado."
        );
      }

      status("guestStatus", "Convidado salvo com sucesso.");
      await refresh();
    } catch (error) {
      status(
        "guestStatus",
        error?.message || "Não foi possível salvar o convidado.",
        true
      );
    } finally {
      busy = false;

      try {
        await refresh();
      } catch (error) {
        console.error("Erro ao atualizar convidado:", error);
      }
    }
  }

  async function load() {
    try {
      if (!supabaseUrl || !supabaseKey) {
        throw new Error(
          "Confira a URL e a chave publishable no arquivo config.js."
        );
      }

      if (!window.supabase?.createClient) {
        throw new Error(
          "A biblioteca do Supabase não carregou. Verifique sua conexão com a internet."
        );
      }

      if (!token) {
        throw new Error(
          "Abra o link individual enviado pela administração."
        );
      }

      client = window.supabase.createClient(
        supabaseUrl,
        supabaseKey
      );

      await refresh();

      $("yesBtn").onclick = () => answer(true);
      $("noBtn").onclick = () => answer(false);
      $("guestBtn").onclick = saveGuest;
      $("installBtn").onclick = installApp;

      $("removeGuestBtn").onclick = () => {
        status(
          "guestStatus",
          "A remoção de convidados ainda não está disponível."
        );
      };

      hideLoading();
      showApp();
      showInstallOption();
    } catch (error) {
      hideLoading();
      $("app")?.classList.add("hidden");
      showError(error, "Não foi possível carregar o aplicativo");
    }
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    showInstallOption();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    showInstallOption();
    status("installHelp", "Aplicativo instalado.");
  });

  window.addEventListener("error", event => {
    console.error(
      "Erro JavaScript:",
      event.message,
      event.filename,
      event.lineno
    );
  });

  window.addEventListener("unhandledrejection", event => {
    console.error("Erro assíncrono:", event.reason);
  });

  load();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      console.error("Falha ao registrar service worker:", error);
    });
  }
})();
