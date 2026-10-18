(() => {
  "use strict";
  const cfg = window.FUTEBOL_CONFIG || {};
  const $ = id => document.getElementById(id);
  let db = null, currentGame = null, members = [];

  const say = (id,msg,error=false) => {
    const el=$(id); if(!el)return;
    el.textContent=msg || "";
    el.classList.toggle("error-text",!!error);
  };
  const esc = v => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  async function notifyPush(eventType, gameId) {
    const {data,error}=await db.functions.invoke("notificar-push",{
      body:{
        eventType,
        gameId,
        eventKey:`${eventType}:${gameId}:${Date.now()}`
      }
    });
    if(error) throw error;
    if(data?.error) throw new Error(data.error);
    return data;
  }

  function pushSummary(result) {
    if(result.duplicate) return "Este aviso já havia sido processado.";
    const sent=Number(result.enviados || 0);
    const failed=Number(result.falhas || 0);
    if(!sent) return "Nenhum aparelho com notificações ativas recebeu o aviso.";
    return `${sent} aparelho(s) notificado(s)${failed ? `; ${failed} falha(s) de entrega` : ""}.`;
  }

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
      $("adminLogoutBtn").classList.add("hidden");
      return;
    }
    const {data,error}=await db.rpc("admin_verificar_acesso");
    if(error) throw error;
    if(data !== true) {
      await db.auth.signOut();
      $("adminLogoutBtn").classList.add("hidden");
      throw new Error("Este usuário não está autorizado na tabela administradores do Supabase.");
    }
    $("adminLoginForm").classList.add("hidden");
    $("adminContent").classList.remove("hidden");
    $("adminLogoutBtn").classList.remove("hidden");
    await loadCurrentGame();
    await loadMembers();
  }

  async function logout() {
    const {error}=await db.auth.signOut();
    if(error) return say("adminActionMessage",error.message,true);
    $("adminContent").classList.add("hidden");
    $("adminLoginForm").classList.remove("hidden");
    $("adminLogoutBtn").classList.add("hidden");
    say("adminMessage","Você saiu da administração.");
  }

  function visibleMembers() {
    const query=$("memberSearch").value.trim().toLocaleLowerCase("pt-BR");
    const filter=$("memberStatusFilter").value;
    return members.filter(member => {
      if(filter==="ativos" && !member.ativo) return false;
      if(filter==="inativos" && member.ativo) return false;
      return `${member.nome} ${member.telefone || ""}`.toLocaleLowerCase("pt-BR").includes(query);
    });
  }

  function renderMembers() {
    const rows=visibleMembers();
    if(!rows.length) {
      $("memberList").innerHTML='<p class="muted">Nenhum jogador encontrado.</p>';
      return;
    }
    $("memberList").innerHTML=rows.map(member=>`
      <article class="member-card ${member.ativo ? "" : "inactive"}">
        <div class="member-card-heading">
          <div>
            <div class="member-card-name">${esc(member.nome)}</div>
            <div class="member-meta">${esc(member.telefone || "Telefone não informado")} · ${esc(member.posicao || "Posição pendente")} · Nível ${esc(member.nivel ?? "—")}</div>
          </div>
          <span class="status ${member.ativo ? "" : "status-closed"}">${member.ativo ? "Ativo" : "Desativado"}</span>
        </div>
        <div class="member-actions">
          <button class="btn btn-secondary" type="button" data-member-action="edit" data-member-id="${esc(member.id)}">Editar</button>
          ${member.ativo ? `<button class="btn btn-secondary" type="button" data-member-action="link" data-member-id="${esc(member.id)}">Gerar novo link</button>` : ""}
          <button class="btn btn-secondary" type="button" data-member-action="toggle" data-member-id="${esc(member.id)}">${member.ativo ? "Desativar e revogar link" : "Reativar e gerar novo link"}</button>
        </div>
      </article>`).join("");
  }

  async function loadMembers() {
    $("memberList").innerHTML='<p class="muted">Carregando jogadores...</p>';
    try {
      const {data,error}=await db.rpc("admin_listar_jogadores");
      if(error) throw error;
      if(!Array.isArray(data)) throw new Error("O banco retornou uma lista de jogadores inválida.");
      members=data;
      renderMembers();
    } catch(error) {
      $("memberList").innerHTML='<p class="error-text">Não foi possível carregar os jogadores.</p>';
      throw error;
    }
  }

  function resetMemberForm() {
    $("memberId").value="";
    $("memberName").value="";
    $("memberPhone").value="";
    $("memberPosition").value="";
    $("memberLevel").value="";
    $("memberFormTitle").textContent="Cadastrar jogador";
    $("saveMemberBtn").textContent="Criar jogador e gerar link";
    $("cancelMemberEditBtn").classList.add("hidden");
  }

  function editMember(id) {
    const member=members.find(row=>row.id===id);
    if(!member) return say("adminActionMessage","Jogador não encontrado na lista. Atualize os dados.",true);
    $("memberId").value=member.id;
    $("memberName").value=member.nome || "";
    $("memberPhone").value=member.telefone || "";
    $("memberPosition").value=member.posicao || "";
    $("memberLevel").value=member.nivel == null ? "" : String(member.nivel);
    $("memberFormTitle").textContent=`Editar jogador: ${member.nome}`;
    $("saveMemberBtn").textContent="Salvar alterações";
    $("cancelMemberEditBtn").classList.remove("hidden");
    $("memberName").focus();
  }

  function memberLink(token) {
    const url=new URL("socio.html",location.href);
    url.searchParams.set("socio",token);
    return url;
  }

  function showMemberLink(member, token) {
    const url=memberLink(token);
    $("newMemberResult").classList.remove("hidden");
    $("newMemberResult").innerHTML=`<h3>Link individual ativado</h3><p><strong>Jogador:</strong> ${esc(member.nome)}</p><p><a id="memberLink" href="${esc(url.toString())}">${esc(url.toString())}</a></p><button id="copyLinkBtn" class="btn btn-secondary btn-block" type="button">Copiar link</button><p class="muted">Este link individual dá acesso à área do jogador. Envie-o somente a ele.</p>`;
    $("copyLinkBtn").addEventListener("click",async()=>{
      try { await navigator.clipboard.writeText(url.toString()); say("adminActionMessage","Link copiado."); }
      catch { say("adminActionMessage","Não foi possível copiar automaticamente. Selecione e copie o link."); }
    });
  }

  async function saveMember() {
    const id=$("memberId").value;
    const name=$("memberName").value.trim();
    const phone=$("memberPhone").value.trim();
    const position=$("memberPosition").value;
    const level=Number($("memberLevel").value);
    if(name.length<3) return say("adminActionMessage","Informe o nome completo do jogador.",true);
    if(!phone) return say("adminActionMessage","Informe o telefone do jogador.",true);
    if(!position) return say("adminActionMessage","Selecione a posição do jogador.",true);
    if(![1,2,3].includes(level)) return say("adminActionMessage","Selecione um nível entre 1 e 3.",true);
    $("newMemberResult").classList.add("hidden");
    $("newMemberResult").innerHTML="";
    $("saveMemberBtn").disabled=true;
    say("adminActionMessage",id ? "Salvando alterações..." : "Criando cadastro...");
    let saved=false;
    try {
      const functionName=id ? "admin_atualizar_jogador" : "admin_criar_jogador";
      const params={p_nome:name,p_telefone:phone,p_posicao:position,p_nivel:level};
      if(id) params.p_socio_id=id;
      const {data,error}=await db.rpc(functionName,params);
      if(error) throw error;
      if(data?.erro) throw new Error(data.erro);
      saved=true;
      if(!id && !data?.token) throw new Error("O banco não retornou o link individual do jogador.");
      if(!id) showMemberLink({nome:data.nome || name},data.token);
      resetMemberForm();
      await loadMembers();
      say("adminActionMessage",id ? "Dados do jogador atualizados." : "Jogador cadastrado com link individual ativo.");
    } catch(e) {
      console.error(e);
      say("adminActionMessage",saved
        ? `Dados salvos, mas houve um problema ao concluir a atualização: ${e.message || "falha inesperada."}`
        : e.message || "Não foi possível salvar os dados do jogador.",true);
    }
    finally { $("saveMemberBtn").disabled=false; }
  }

  async function toggleMember(id) {
    const member=members.find(row=>row.id===id);
    if(!member) return say("adminActionMessage","Jogador não encontrado na lista. Atualize os dados.",true);
    const activating=!member.ativo;
    const action=activating ? "reativar e gerar um link individual novo para" : "desativar e revogar o link de";
    if(!window.confirm(`Deseja ${action} ${member.nome}? O histórico será preservado.`)) return;
    say("adminActionMessage",activating ? "Reativando jogador..." : "Desativando jogador...");
    let changed=false;
    try {
      const {data,error}=await db.rpc("admin_definir_jogador_ativo",{
        p_socio_id:id,
        p_ativo:activating
      });
      if(error) throw error;
      if(data?.erro) throw new Error(data.erro);
      changed=true;
      if(activating) {
        if(!data?.token) throw new Error("O jogador foi reativado, mas o banco não retornou o novo link.");
        showMemberLink(member,data.token);
      }
      await loadMembers();
      say("adminActionMessage",activating ? "Jogador reativado. Envie o novo link individual." : "Jogador desativado e link revogado. O histórico foi preservado.");
    } catch(e) {
      console.error(e);
      say("adminActionMessage",changed
        ? `A situação do jogador foi alterada, mas houve um problema ao atualizar a lista: ${e.message || "falha inesperada."}`
        : e.message || "Não foi possível alterar o acesso do jogador.",true);
    }
  }

  async function regenerateMemberLink(id) {
    const member=members.find(row=>row.id===id);
    if(!member) return say("adminActionMessage","Jogador não encontrado na lista. Atualize os dados.",true);
    if(!member.ativo) return say("adminActionMessage","Reative o jogador para gerar um novo link.",true);
    if(!window.confirm(`Gerar um novo link para ${member.nome}? O link anterior deixará de funcionar imediatamente.`)) return;
    say("adminActionMessage","Gerando novo link individual...");
    try {
      const {data,error}=await db.rpc("admin_gerar_link_jogador",{p_socio_id:id});
      if(error) throw error;
      if(data?.erro) throw new Error(data.erro);
      if(!data?.token) throw new Error("O banco não retornou o novo link individual.");
      showMemberLink(member,data.token);
      say("adminActionMessage","Novo link gerado. O link anterior foi revogado; envie este link ao jogador.");
    } catch(e) { console.error(e); say("adminActionMessage",e.message || "Não foi possível gerar um novo link.",true); }
  }

  async function handleMemberListClick(event) {
    const button=event.target.closest("[data-member-action]");
    if(!button) return;
    const id=button.dataset.memberId;
    if(button.dataset.memberAction==="edit") editMember(id);
    if(button.dataset.memberAction==="toggle") await toggleMember(id);
    if(button.dataset.memberAction==="link") await regenerateMemberLink(id);
  }

  async function createGame() {
    const date=$("gameInputDate").value, time=$("gameInputTime").value || "19:30";
    if(!date) return say("adminActionMessage","Escolha a data do jogo.",true);
    $("createGameBtn").disabled=true; say("adminActionMessage","Salvando jogo...");
    try {
      const {data,error}=await db.rpc("admin_criar_jogo",{p_data:date,p_hora:time});
      if(error) throw error;
      if(data?.erro) throw new Error(data.erro);
      let gameId=data?.id;
      await loadCurrentGame();
      if(!gameId && currentGame?.data_jogo===date) gameId=currentGame.id;
      if(gameId) {
        try {
          const result=await notifyPush("novo_jogo",gameId);
          say("adminActionMessage",`Jogo salvo para ${date}, às ${time}. ${pushSummary(result)}`);
        } catch(notificationError) {
          console.error("O jogo foi salvo, mas não foi possível enviar a notificação.",notificationError);
          say("adminActionMessage",`Jogo salvo para ${date}, às ${time}, mas a notificação falhou: ${notificationError.message || "erro desconhecido."}`,true);
        }
      } else {
        say("adminActionMessage",`Jogo salvo para ${date}, às ${time}, mas não foi possível identificar o jogo para notificar.`,true);
      }
    } catch(e) { say("adminActionMessage",e.message || "Não foi possível salvar o jogo.",true); }
    finally { $("createGameBtn").disabled=false; }
  }

  async function toggleGame() {
    if(!currentGame?.id) return say("adminActionMessage","Não existe jogo para alterar.",true);
    $("toggleGameBtn").disabled=true;
    try {
      const gameId=currentGame.id;
      const nextClosed=!currentGame.fechado;
      const {data,error}=await db.rpc("admin_definir_jogo_fechado",{p_jogo_id:gameId,p_fechado:nextClosed});
      if(error) throw error;
      if(data?.erro) throw new Error(data.erro);
      await loadCurrentGame();
      try {
        const result=await notifyPush(nextClosed ? "confirmacoes_fechadas" : "confirmacoes_abertas",gameId);
        say("adminActionMessage",`${nextClosed ? "Confirmações fechadas." : "Confirmações reabertas."} ${pushSummary(result)}`);
      } catch(notificationError) {
        console.error("O estado do jogo foi atualizado, mas não foi possível enviar a notificação.",notificationError);
        say("adminActionMessage",`${nextClosed ? "Confirmações fechadas" : "Confirmações reabertas"}, mas a notificação falhou: ${notificationError.message || "erro desconhecido."}`,true);
      }
    } catch(e) { say("adminActionMessage",e.message || "Não foi possível alterar o jogo.",true); }
    finally { $("toggleGameBtn").disabled=false; }
  }

  async function init() {
    if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase?.createClient) throw new Error("Confira config.js e a conexão com a internet.");
    db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    $("adminSubmitBtn").addEventListener("click",login);
    $("adminPassword").addEventListener("keydown",e=>{if(e.key==="Enter")login();});
    $("adminLogoutBtn").addEventListener("click",logout);
    $("saveMemberBtn").addEventListener("click",saveMember);
    $("cancelMemberEditBtn").addEventListener("click",resetMemberForm);
    $("memberSearch").addEventListener("input",renderMembers);
    $("memberStatusFilter").addEventListener("change",renderMembers);
    $("memberList").addEventListener("click",handleMemberListClick);
    $("createGameBtn").addEventListener("click",createGame);
    $("toggleGameBtn").addEventListener("click",toggleGame);
    try { await showAdmin(); } catch(e) { say("adminMessage",e.message || "Não foi possível abrir a administração.",true); }
  }
  init().catch(e=>{console.error(e);say("adminMessage",e.message || "Erro ao iniciar.",true);});
})();
