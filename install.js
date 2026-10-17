(() => {
  "use strict";

  const buttons = [...document.querySelectorAll(".install-app-btn")];
  const message = document.getElementById("installMessage");
  let installPrompt = null;

  const showMessage = text => {
    if (!message) return;
    message.textContent = text;
    message.hidden = !text;
  };

  const isInstalled = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const updateButtons = () => {
    buttons.forEach(button => {
      button.hidden = isInstalled();
    });
  };

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    updateButtons();
    showMessage("Futebol de Sexta instalado com sucesso.");
  });

  buttons.forEach(button => {
    button.addEventListener("click", async () => {
      if (isInstalled()) {
        updateButtons();
        return;
      }
      if (!installPrompt) {
        showMessage("No Chrome, abra o menu ⋮ e escolha “Instalar app” ou “Adicionar à tela inicial”.");
        return;
      }

      button.disabled = true;
      try {
        const prompt = installPrompt;
        installPrompt = null;
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        showMessage(outcome === "accepted"
          ? "Instalação iniciada."
          : "Instalação cancelada. Você pode tentar novamente pelo menu do Chrome.");
      } catch (error) {
        console.error("Não foi possível abrir a instalação do app.", error);
        showMessage("Não foi possível abrir a instalação. Tente pelo menu do Chrome.");
      } finally {
        button.disabled = false;
      }
    });
  });

  updateButtons();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      console.error("Não foi possível registrar o service worker.", error);
      showMessage("Não foi possível preparar a instalação. Verifique a conexão e recarregue a página.");
    });
  }
})();
