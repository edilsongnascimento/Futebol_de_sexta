(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const cfg = window.FUTEBOL_CONFIG || {};
  const pageUrl = new URL(location.href);
  const token = pageUrl.searchParams.get("socio");
  let supabase = null, member = null, installPrompt = null;
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const setStatus = (id, msg, error=false) => { const el=$(id); if(!el)return; el.textContent=msg||""; el.classList.toggle("error",!!error); };
  const showSetup = msg => { $("setupNotice").textContent=msg; $("setupNotice").classList.remove("hidden"); };
  const rpc = async (name, args={}) => {
    if (!supabase) throw new Error("Supabase não configurado.");
    const {data,error}=await supabase.rpc(name,args);
    if(error) throw error;
    return data;
  };
  function renderList(id, people, emptyText, confirmed=false) {
    const list=$(id); list.replaceChildren();
    if(!Array.isArray(people)||people.length===0){const li=document.createElement("li");li.className="muted";li.textContent=emptyText;list.append(li);return;}
    people.forEach(person=>{
      const li=document.createElement("li");
      const name=document.createElement("span");name.textContent=person.nome||"Sócio";li.append(name);
      if(person.convidado){const badge=document.createElement("span");badge.className="guest-label";badge.textContent="Convidado de "+person.convidado;li.append(badge);}
      else if(confirmed){const badge=document.createElement("span");badge.className="guest-label";badge.textContent=person.goleiro?"Goleiro":"Confirmado";li.append(badge);}
      list.append(li);
    });
  }
  function showInstallOption() {
    // Só existe acesso individual com token. O modo instalado não exibe o botão.
    const area=$("installArea");
    if(token && !standalone()) area.classList.remove("hidden"); else area.classList.add("hidden");
  }
  async function installApp() {
    if(standalone()){showInstallOption();return;}
    if(installPrompt){
      installPrompt.prompt();
      const choice=await installPrompt.userChoice;
      if(choice?.outcome==="accepted") setStatus("installHelp","Instalação solicitada. Quando terminar, abra pelo ícone Futebol de Sexta.");
      else setStatus("installHelp","Você pode instalar depois pelo menu do navegador.");
      installPrompt=null;
      return;
    }
    setStatus("installHelp","No Android: toque no menu ⋮ do Chrome e escolha “Instalar app” ou “Adicionar à tela inicial”. Depois, abra pelo ícone criado.");
  }
  async function load() {
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || cfg.supabasePublishableKey.includes("COLE_AQUI")) {
      $("loading").classList.add("hidden"); showSetup("Falta configurar a chave publishable do Supabase no arquivo config.js."); return;
    }
    if (!window.supabase?.createClient) {
      $("loading").classList.add("hidden"); showSetup("Não foi possível carregar a biblioteca do Supabase. Verifique sua conexão."); return;
    }
    supabase=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
    if(!token){$("loading").classList.add("hidden");showSetup("Para consultar e confirmar sua presença, abra o link individual enviado pela administração.");return;}
    try {
      const data=await rpc("socio_resumo",{p_token:token});
      if(!data||data.ok===false)throw new Error(data?.mensagem||"Link individual inválido ou desativado.");
      member=data;
      $("memberName").textContent=data.nome||"Sócio";
      $("memberMessage").textContent=data.mensagem||"Confirme sua presença para o próximo jogo.";
      $("rsvpStatus").textContent=data.confirmacao?`Sua resposta: ${data.confirmacao==="vou"?"Vou jogar":"Não vou"}`:"Você ainda não respondeu.";
      $("guestName").value=data.convidado_nome||""; $("guestPhone").value=data.convidado_telefone||"";
      $("playersCount").textContent=data.jogadores??0; $("keepersCount").textContent=data.goleiros??0; $("reservesCount").textContent=data.reservas??0;
      $("gameTitle").textContent=data.jogo?.data?"Jogo de "+data.jogo.data:"Próximo jogo";
      $("gamePill").textContent=data.jogo?.hora||"Sem jogo aberto";
      $("gameInfo").textContent=data.jogo?(data.jogo.local?"Local: "+data.jogo.local:"O local ainda não foi informado."):(data.mensagem||"Ainda não há jogo aberto.");
      renderList("confirmedList",data.confirmados,"Ainda não há sócios confirmados.",true);
      renderList("pendingList",data.pendentes,"Todos os sócios já responderam.");
      $("confirmedCount").textContent=(data.confirmados||[]).length; $("pendingCount").textContent=(data.pendentes||[]).length;
      const hasGame=!!data.jogo;
      $("yesBtn").disabled=!hasGame; $("noBtn").disabled=!hasGame;
      $("guestBtn").disabled=!hasGame||data.confirmacao!=="vou";
      $("removeGuestBtn").disabled=!hasGame;
      $("loading").classList.add("hidden"); $("app").classList.remove("hidden");
      $("yesBtn").onclick=()=>answer("vou"); $("noBtn").onclick=()=>answer("nao");
      $("guestBtn").onclick=saveGuest; $("removeGuestBtn").onclick=removeGuest; $("installBtn").onclick=installApp;
      showInstallOption();
    } catch(e){$("loading").classList.add("hidden");showSetup(e.message||"Erro ao carregar os dados.");}
  }
  async function answer(value){
    try{$("yesBtn").disabled=$("noBtn").disabled=true;const data=await rpc("socio_confirmar",{p_token:token,p_resposta:value});if(data?.ok===false)throw new Error(data.mensagem||"Não foi possível salvar.");setStatus("rsvpStatus",value==="vou"?"Presença confirmada.":"Ausência registrada.");await refresh();}
    catch(e){setStatus("rsvpStatus",e.message||"Erro ao salvar.",true);}finally{$("yesBtn").disabled=$("noBtn").disabled=false;}
  }
  async function saveGuest(){
    const nome=$("guestName").value.trim(),telefone=$("guestPhone").value.trim();if(!nome){setStatus("guestStatus","Informe o nome do convidado.",true);return;}
    try{const data=await rpc("socio_salvar_convidado",{p_token:token,p_nome:nome,p_telefone:telefone||null});if(data?.ok===false)throw new Error(data.mensagem||"Não foi possível salvar.");setStatus("guestStatus","Convidado salvo.");await refresh();}
    catch(e){setStatus("guestStatus",e.message||"Erro ao salvar convidado.",true);}
  }
  async function removeGuest(){
    try{const data=await rpc("socio_remover_convidado",{p_token:token});if(data?.ok===false)throw new Error(data.mensagem||"Não foi possível remover.");$("guestName").value="";$("guestPhone").value="";setStatus("guestStatus","Convidado removido.");await refresh();}
    catch(e){setStatus("guestStatus",e.message||"Erro ao remover convidado.",true);}
  }
  async function refresh(){
    try{const data=await rpc("socio_resumo",{p_token:token});if(data?.ok===false)throw new Error(data.mensagem||"Não foi possível atualizar.");
      $("playersCount").textContent=data.jogadores??0;$("keepersCount").textContent=data.goleiros??0;$("reservesCount").textContent=data.reservas??0;
      $("rsvpStatus").textContent=data.confirmacao?`Sua resposta: ${data.confirmacao==="vou"?"Vou jogar":"Não vou"}`:"Você ainda não respondeu.";
      $("guestName").value=data.convidado_nome||"";$("guestPhone").value=data.convidado_telefone||"";
      $("confirmedCount").textContent=(data.confirmados||[]).length;$("pendingCount").textContent=(data.pendentes||[]).length;
      renderList("confirmedList",data.confirmados,"Ainda não há sócios confirmados.",true);renderList("pendingList",data.pendentes,"Todos os sócios já responderam.");
      $("guestBtn").disabled=!data.jogo||data.confirmacao!=="vou";$("removeGuestBtn").disabled=!data.jogo;
    }catch(e){showSetup(e.message||"Erro ao atualizar.");}
  }
  window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event;});
  window.addEventListener("appinstalled",()=>{installPrompt=null;$("installArea").classList.add("hidden");setStatus("installHelp","Aplicativo instalado.");});
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change",showInstallOption);
  load();
  if("serviceWorker" in navigator && location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(()=>{});
})();
