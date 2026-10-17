(() => {
  "use strict";
  const cfg = window.FUTEBOL_CONFIG || {};
  const $ = id => document.getElementById(id);
  let db = null, currentGame = null;

  const say = (id,msg,error=false) => {
    const el=$(id); if(!el)return;
    el.textContent=msg || "";
    el.classList.toggle("error-text",!!error);
  };
  const esc = v => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  async function loadCurrentGame() {
    const {data,error}=await db.rpc("obter_painel_publico");
    if(error) throw error;
    currentGame=data?.jogo || null;
    if(!currentGame) {
      $("currentGameInfo").textContent="Nenhum jogo futuro cadastrado.";
      $("toggleGameBtn").disabled=true;
      return;
    }
    $("currentGameInfo").textContent=`Jogo: ${currentGame.data_jogo} às ${String(currentGame.hora || "19:30").slice(0,5)}. Situação: ${currentGame.fechado ? "fechado" : "aberto"}. Vagas ocupadas: ${data.total_ocupadas ?? 0}/18.`;
    $("toggleGameBtn").textContent=currentGame.fechado ? "Reabrir confirmações" : "Fechar confirmações";
    $("toggleGameBtn").disabled=false;
  }

  async function login() {
    const email=$("adminEmail").value.trim(), password=$("adminPassword").value;
    if(!email || !password) return say("adminMessage","Informe e-mail e senha.",true);
    $("adminSubmitBtn").disabled=true; say("adminMessage","Entrando...");
    try {
      const {data,error}=await db.auth.signInWithPassword({email,password});
      if(error) throw error;
      if(!data.session) throw new Error("Não foi possível iniciar a sessão.");
      await showAdmin();
      $("adminPassword").value="";
      say("adminMessage","");
    } catch(e) { say("adminMessage",e.message || "Falha no login.",true); }
    finally { $("adminSubmitBtn").disabled=false; }
  }

  async function showAdmin() {
    const {data:sessionData,error:sessionError}=await db.auth.getSession();
    if(sessionError) throw sessionError;
    if(!sessionData.session) {
      $("adminLoginForm").classList.remove("hidden");
      $("adminContent").classList.add("hidden");
      return;
    }
    const {data,error}=await db.rpc("admin_verificar_acesso");
    if(error) throw error;
    if(data !== true) {
      await db.auth.signOut();
      throw new Error("Este usuário não está autorizado na tabela administradores do Supabase.");
    }
    $("adminLoginForm").classList.add("hidden");
    $("adminContent").classList.remove("hidden");
    await loadCurrentGame();
  }

  async function logout() {
    const {error}=await db.auth.signOut();
    if(error) return say("adminActionMessage",error.message,true);
    $("adminContent").classList.add("hidden");
    $("adminLoginForm").classList.remove("hidden");
    say("adminMessage","Você saiu da administração.");
  }

  async function createMember() {
    const name=$("newMemberName").value.trim();
    if(name.length<3) return say("adminActionMessage","Informe o nome completo do sócio.",true);
    $("createMemberBtn").disabled=true; say("adminActionMessage","Criando cadastro...");
    try {
      const {data,error}=await db.rpc("admin_criar_socio",{p_nome:name});
      if(error) throw error;
      if(data?.erro) throw new Error(data.erro);
      if(!data?.token || !data?.codigo_ativacao) throw new Error("O banco não retornou token e código. Confira o SQL administrativo.");
      const url=new URL("socio.html",location.href);
      url.searchParams.set("socio",data.token);
      $("newMemberResult").classList.remove("hidden");
      $("newMemberResult").innerHTML=`<h3>Sócio cadastrado</h3><p><strong>Nome:</strong> ${esc(data.nome || name)}</p><p><strong>Link individual:</strong></p><p><a id="memberLink" href="${esc(url.toString())}">${esc(url.toString())}</a></p><p><strong>Código de ativação:</strong></p><p class="activation-code">${esc(data.codigo_ativacao)}</p><button id="copyLinkBtn" class="btn btn-secondary btn-block" type="button">Copiar link</button><p class="muted">Guarde o link e o código. O código é mostrado somente agora.</p>`;
      $("copyLinkBtn").addEventListener("click",async()=>{
        try { await navigator.clipboard.writeText(url.toString()); say("adminActionMessage","Link copiado."); }
        catch { say("adminActionMessage","Não foi possível copiar automaticamente. Selecione e copie o link."); }
      });
      $("newMemberName").value="";
      say("adminActionMessage","Sócio criado. Guarde o link e o código de ativação.");
    } catch(e) { console.error(e); say("adminActionMessage",e.message || "Não foi possível criar o sócio.",true); }
    finally { $("createMemberBtn").disabled=false; }
  }

  async function createGame() {
    const date=$("gameInputDate").value, time=$("gameInputTime").value || "19:30";
    if(!date) return say("adminActionMessage","Escolha a data do jogo.",true);
    $("createGameBtn").disabled=true; say("adminActionMessage","Salvando jogo...");
    try {
      const {data,error}=await db.rpc("admin_criar_jogo",{p_data:date,p_hora:time});
      if(error) throw error;
      if(data?.erro) throw new Error(data.erro);
      say("adminActionMessage",`Jogo salvo para ${date}, às ${time}.`);
      await loadCurrentGame();
    } catch(e) { say("adminActionMessage",e.message || "Não foi possível salvar o jogo.",true); }
    finally { $("createGameBtn").disabled=false; }
  }

  async function toggleGame() {
    if(!currentGame?.id) return say("adminActionMessage","Não existe jogo para alterar.",true);
    $("toggleGameBtn").disabled=true;
    try {
      const nextClosed=!currentGame.fechado;
      const {data,error}=await db.rpc("admin_definir_jogo_fechado",{p_jogo_id:currentGame.id,p_fechado:nextClosed});
      if(error) throw error;
      if(data?.erro) throw new Error(data.erro);
      say("adminActionMessage",nextClosed ? "Confirmações fechadas." : "Confirmações reabertas.");
      await loadCurrentGame();
    } catch(e) { say("adminActionMessage",e.message || "Não foi possível alterar o jogo.",true); }
    finally { $("toggleGameBtn").disabled=false; }
  }

  async function init() {
    if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase?.createClient) throw new Error("Confira config.js e a conexão com a internet.");
    db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    $("adminSubmitBtn").addEventListener("click",login);
    $("adminPassword").addEventListener("keydown",e=>{if(e.key==="Enter")login();});
    $("adminLogoutBtn").addEventListener("click",logout);
    $("createMemberBtn").addEventListener("click",createMember);
    $("createGameBtn").addEventListener("click",createGame);
    $("toggleGameBtn").addEventListener("click",toggleGame);
    try { await showAdmin(); } catch(e) { say("adminMessage",e.message || "Não foi possível abrir a administração.",true); }
  }
  init().catch(e=>{console.error(e);say("adminMessage",e.message || "Erro ao iniciar.",true);});
})();
