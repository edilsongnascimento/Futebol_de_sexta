/*
  Futebol de Sexta - geracao administrativa de links individuais

  Execute no SQL Editor do Supabase depois dos SQLs-base,
  COMPLEMENTO_SUPABASE.sql e MIGRACAO_CRUD_JOGADORES.sql.
  Cada novo link substitui o anterior; o token em texto puro e retornado
  somente uma vez para a sessao administrativa que o solicitou.
*/

create or replace function public.admin_gerar_link_jogador(p_socio_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_jogador public.socios%rowtype;
begin
  if not coalesce(public._admin_autorizado(), false) then
    raise exception 'Acesso administrativo negado.';
  end if;
  if p_socio_id is null then
    raise exception 'Jogador inválido.';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  update public.socios
  set token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'),
      codigo_ativacao_hash = null,
      ativado_em = coalesce(ativado_em, now())
  where id = p_socio_id
    and ativo = true
  returning * into v_jogador;

  if not found then
    if exists (select 1 from public.socios where id = p_socio_id) then
      raise exception 'O jogador está desativado. Reative-o antes de gerar um link.';
    end if;
    raise exception 'Jogador não encontrado.';
  end if;

  return jsonb_build_object(
    'id', v_jogador.id,
    'nome', v_jogador.nome,
    'token', v_token
  );
end;
$$;

revoke all on function public.admin_gerar_link_jogador(uuid) from public, anon;
grant execute on function public.admin_gerar_link_jogador(uuid) to authenticated;
