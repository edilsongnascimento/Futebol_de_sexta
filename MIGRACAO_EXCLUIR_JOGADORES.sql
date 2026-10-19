/*
  Futebol de Sexta - exclusao permanente de jogadores

  Execute no SQL Editor do Supabase depois dos SQLs-base,
  COMPLEMENTO_SUPABASE.sql, MIGRACAO_CRUD_JOGADORES.sql e
  MIGRACAO_NOTIFICACOES_PUSH.sql.

  A funcao remove confirmacoes, convidados e inscricoes push antes do cadastro.
  Tudo ocorre em uma transacao: se uma outra tabela impedir a exclusao, a
  operacao inteira e revertida e o banco informa o erro.
*/

create or replace function public.admin_excluir_jogador(p_socio_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_confirmacoes integer;
  v_convidados integer;
  v_assinaturas integer;
begin
  if not coalesce(public._admin_autorizado(), false) then
    raise exception 'Acesso administrativo negado.';
  end if;
  if p_socio_id is null then
    raise exception 'Jogador invalido.';
  end if;

  select s.nome into v_nome
  from public.socios s
  where s.id = p_socio_id
  for update;

  if not found then
    raise exception 'Jogador nao encontrado.';
  end if;

  delete from public.confirmacoes
  where socio_id = p_socio_id;
  get diagnostics v_confirmacoes = row_count;

  delete from public.convidados
  where socio_id = p_socio_id;
  get diagnostics v_convidados = row_count;

  delete from public.push_subscriptions
  where socio_id = p_socio_id;
  get diagnostics v_assinaturas = row_count;

  delete from public.socios
  where id = p_socio_id;

  if not found then
    raise exception 'O cadastro do jogador nao foi excluido.';
  end if;

  return jsonb_build_object(
    'excluido', true,
    'nome', v_nome,
    'confirmacoes_excluidas', v_confirmacoes,
    'convidados_excluidos', v_convidados,
    'assinaturas_push_excluidas', v_assinaturas
  );
end;
$$;

revoke all on function public.admin_excluir_jogador(uuid) from public, anon;
grant execute on function public.admin_excluir_jogador(uuid) to authenticated;
