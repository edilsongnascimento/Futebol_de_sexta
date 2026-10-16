
(() => {
  "use strict";


const $ = id => document.getElementById(id);

const configOriginal = window.FUTEBOL_CONFIG || {};

const cfg = {
  supabaseUrl: (
    configOriginal.SUPABASE_URL ||
    configOriginal.supabaseUrl ||
    ""
  ).replace(/\/rest\/v1\/?$/, ""),

  supabasePublishableKey:
    configOriginal.SUPABASE_ANON_KEY ||
    configOriginal.SUPABASE_PUBLISHABLE_KEY ||
    configOriginal.supabasePublishableKey ||
    ""
};

const token = new URL(location.href).searchParams.get("socio");


  let supabase = null;
  let installPrompt = null;
  let busy = false;

  const status = (id, message, error = false) => {
    const el = $(id);
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("error", error);
  };

  function notice(message) {
    const el = $("setupNotice");
    if (!el) return;
    el.replaceChildren();
    el.classList.remove("hidden");
    const p = document.createElement("p");
    p.textContent = message;
    el.append(p);
  }

  async function rpc(name, args = {}) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw error;
    return data;
  }

  function standalone() {
    return window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
  }

  function showInstallOption() {
    const area = $("installArea");
    if (area) {
      area.classList.toggle("hidden", !token || standalone());
    }
  }

  async function installApp() {
    if (standalone()) return;

    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;

      status(
        "installHelp",
        choice?.outcome === "accepted"
          ? "Instalação solicitada. Abra pelo ícone quando terminar."
          : "Você pode instalar depois pelo menu do navegador."
      );

      installPrompt = null;
      showInstallOption();
      return;
    }

    status(
      "installHelp",
      "No Android, abra o menu ⋮ do Chrome e escolha “Instalar app” ou “Adicionar à tela inicial”."
    );
  }

  function renderList(id, people, emptyMessage) {
    const list = $(id);
    if (!list) return;

    list.replaceChildren();

    if (!Array.isArray(people) || people.length === 0) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = emptyMessage;
      list.append(li);
      return;
    }

    people.forEach(person => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = person.nome || "Participante";
      li.append(name);

      if (person.tipo === "convidado" && person.convidado_por) {
        const badge = document.createElement("span");
        badge.className = "guest-label";
        badge.textContent = "Convidado de " + person.convidado_por;
        li.append(badge);
      }

      list.append(li);
    });
  }

  function formatDate(value) {
    if (!value) return "";
    const parts = value.split("-");
    if (parts.length !== 3) return value;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  async function load() {
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      $("loading").classList.add("hidden");
      notice("Confira a URL e a chave publishable no arquivo config.js.");
      return;
    }

    if (!window.supabase?.createClient) {
      $("loading").classList.add("hidden");
      notice("Não foi possível carregar o Supabase. Verifique a conexão.");
      return;
    }

    if (!token) {
      $("loading").classList.add("hidden");
      notice("Abra o link individual enviado pela administração.");
      return;
    }

    try {
      supabase = window.supabase.createClient(
        cfg.supabaseUrl,
        cfg.supabasePublishableKey
      );

      await refresh(true);
      $("loading").classList.add("hidden");
      $("app").classList.remove("hidden");

      $("yesBtn").onclick = () => answer(true);
      $("noBtn").onclick = () => answer(false);
      $("guestBtn").onclick = saveGuest;
      $("installBtn").onclick = installApp;

      // O banco atual não possui uma função para remover convidados.
      $("removeGuestBtn").disabled = true;
      $("removeGuestBtn").title =
        "A remoção de convidados ainda não está disponível.";

      showInstallOption();
    } catch (error) {
      $("loading").classList.add("hidden");
      notice(error.message || "Não foi possível carregar os dados.");
    }
  }

  async function refresh(initial = false) {
    const data = await rpc("obter_painel_socio", {
      p_token: token
    });

    if (!data || !data.socio) {
      if (data?.requer_ativacao) {
        notice(
          "Seu acesso ainda precisa ser ativado. Solicite à administração o código de ativação. A tela de ativação será integrada na próxima etapa."
        );
      } else {
        notice("Link individual inválido, revogado ou ainda não ativado.");
      }

      if (initial) $("app").classList.add("hidden");
      throw new Error("Não foi possível validar o acesso do sócio.");
    }

    const game = data.jogo;
    const confirmed = Array.isArray(data.confirmados)
      ? data.confirmados
      : [];
    const response = data.minha_confirmacao;

    $("memberName").textContent = data.socio.nome || "Sócio";
    $("memberMessage").textContent =
      "Confirme sua presença para o próximo jogo.";

    $("rsvpStatus").textContent = response === "sim"
      ? "Sua resposta: Vou jogar"
      : response === "nao"
        ? "Sua resposta: Não vou"
        : "Você ainda não respondeu.";

    $("gameTitle").textContent = game
      ? "Jogo de " + formatDate(game.data_jogo)
      : "Próximo jogo";

    $("gamePill").textContent = game
      ? String(game.hora || "").slice(0, 5)
      : "Sem jogo";

    $("gameInfo").textContent = game
      ? (game.fechado
          ? "Este jogo está fechado para novas confirmações."
          : "Confira sua presença para este jogo.")
      : "Ainda não há jogo publicado.";

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

    // obter_painel_socio não retorna a lista dos sócios pendentes.
    $("pendingCount").textContent = "—";
    renderList(
      "pendingList",
      [],
      "A lista de pendentes ainda precisa de uma função no banco."
    );

    const guest = data.meu_convidado;
    $("guestName").value = guest?.nome || "";
    $("guestPhone").value = "";

    const canRespond = !!game && !game.fechado;
    $("yesBtn").disabled = !canRespond;
    $("noBtn").disabled = !canRespond;
    $("guestBtn").disabled =
      !canRespond || response !== "sim" || !data.pode_convidar;

    // A função atual não permite excluir convidados.
    $("removeGuestBtn").disabled = true;

    showInstallOption();
  }

  async function answer(willPlay) {
    if (busy) return;
    busy = true;
    $("yesBtn").disabled = true;
    $("noBtn").disabled = true;

    try {
      const data = await rpc("confirmar_presenca", {
        p_token: token,
        p_confirmou: willPlay
      });

      if (data?.erro) throw new Error(data.erro);
      if (data?.ok !== true) {
        throw new Error("O banco não confirmou a alteração.");
      }

      status(
        "rsvpStatus",
        willPlay ? "Presença confirmada." : "Ausência registrada."
      );

      await refresh();
    } catch (error) {
      status(
        "rsvpStatus",
        error.message || "Não foi possível salvar sua resposta.",
        true
      );
    } finally {
      busy = false;
      $("yesBtn").disabled = false;
      $("noBtn").disabled = false;
      try {
        await refresh();
      } catch (_) {}
    }
  }

  async function saveGuest() {
    const name = $("guestName").value.trim();

    if (name.length < 3) {
      status(
        "guestStatus",
        "Informe o nome completo do convidado.",
        true
      );
      return;
    }

    $("guestBtn").disabled = true;

    try {
      const data = await rpc("cadastrar_convidado", {
        p_token: token,
        p_nome: name
      });

      if (data?.erro) throw new Error(data.erro);
      if (data?.ok !== true) {
        throw new Error("O banco não confirmou o cadastro.");
      }

      status("guestStatus", "Convidado cadastrado.");
      await refresh();
    } catch (error) {
      status(
        "guestStatus",
        error.message || "Não foi possível cadastrar o convidado.",
        true
      );
    } finally {
      try {
        await refresh();
      } catch (_) {}
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

  load();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
