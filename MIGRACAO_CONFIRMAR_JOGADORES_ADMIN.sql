/*
  Futebol de Sexta - controle administrativo de confirmacoes

  Execute no SQL Editor do Supabase depois dos SQLs-base e de
  COMPLEMENTO_SUPABASE.sql.
*/

create or replace function public.admin_obter_confirmacoes_jogo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jogo public.jogos%rowtype;
  v_jogadores jsonb;
  v_total integer := 0;
begin
  if not coalesce(public._admin_autorizado(), false) then
    raise exception 'Acesso administrativo negado.';
  end if;

  select * into v_jogo
  from public.jogos
  where data_jogo >= current_date
  order by data_jogo
  limit 1;

  if v_jogo.id is null then
    return jsonb_build_object(
      'jogo', null,
      'jogadores', '[]'::jsonb,
      'total_ocupadas', 0
    );
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'nome', s.nome,
      'confirmado', coalesce(c.confirmou, false),
      'nao_vai', coalesce(c.confirmou = false, false)
    )
    order by s.nome
  ), '[]'::jsonb)
  into v_jogadores
  from public.socios s
  left join public.confirmacoes c
    on c.socio_id = s.id
   and c.jogo_id = v_jogo.id
  where s.ativo = true;

  select count(*) into v_total
  from (
    select c.socio_id
    from public.confirmacoes c
    join public.socios s on s.id = c.socio_id
    where c.jogo_id = v_jogo.id
      and c.confirmou = true
      and s.ativo = true
    union all
    select g.socio_id
    from public.convidados g
    join public.socios s on s.id = g.socio_id
    where g.jogo_id = v_jogo.id
      and s.ativo = true
  ) ocupadas;

  return jsonb_build_object(
    'jogo', jsonb_build_object(
      'id', v_jogo.id,
      'data_jogo', v_jogo.data_jogo,
      'hora', v_jogo.hora,
      'fechado', v_jogo.fechado
    ),
    'jogadores', v_jogadores,
    'total_ocupadas', v_total
  );
end;
$$;

create or replace function public.admin_definir_confirmacao_jogador(
  p_jogo_id uuid,
  p_socio_id uuid,
  p_confirmado boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jogo public.jogos%rowtype;
  v_total integer := 0;
  v_ja_confirmado boolean := false;
begin
  if not coalesce(public._admin_autorizado(), false) then
    raise exception 'Acesso administrativo negado.';
  end if;
  if p_jogo_id is null or p_socio_id is null or p_confirmado is null then
    raise exception 'Jogo, jogador ou situacao invalida.';
  end if;

  select * into v_jogo
  from public.jogos
  where id = p_jogo_id
  for update;

  if not found then
    raise exception 'Jogo nao encontrado.';
  end if;
  if not exists (
    select 1 from public.socios s
    where s.id = p_socio_id and s.ativo = true
  ) then
    raise exception 'Jogador ativo nao encontrado.';
  end if;

  if p_confirmado then
    select exists (
      select 1 from public.confirmacoes c
      where c.jogo_id = p_jogo_id
        and c.socio_id = p_socio_id
        and c.confirmou = true
    ) into v_ja_confirmado;

    if not v_ja_confirmado then
      select count(*) into v_total
      from (
        select c.socio_id
        from public.confirmacoes c
        join public.socios s on s.id = c.socio_id
        where c.jogo_id = p_jogo_id
          and c.confirmou = true
          and s.ativo = true
        union all
        select g.socio_id
        from public.convidados g
        join public.socios s on s.id = g.socio_id
        where g.jogo_id = p_jogo_id
          and s.ativo = true
      ) ocupadas;

      if v_total >= 18 then
        raise exception 'O jogo atingiu o limite de 18 pessoas.';
      end if;
    end if;

    if exists (
      select 1 from public.confirmacoes c
      where c.jogo_id = p_jogo_id and c.socio_id = p_socio_id
    ) then
      update public.confirmacoes
      set confirmou = true
      where jogo_id = p_jogo_id and socio_id = p_socio_id;
    else
      insert into public.confirmacoes (jogo_id, socio_id, confirmou)
      values (p_jogo_id, p_socio_id, true);
    end if;
  else
    delete from public.confirmacoes
    where jogo_id = p_jogo_id and socio_id = p_socio_id;
  end if;

  return jsonb_build_object(
    'jogo_id', p_jogo_id,
    'socio_id', p_socio_id,
    'confirmado', p_confirmado
  );
end;
$$;

revoke all on function public.admin_obter_confirmacoes_jogo() from public, anon;
revoke all on function public.admin_definir_confirmacao_jogador(uuid, uuid, boolean) from public, anon;
grant execute on function public.admin_obter_confirmacoes_jogo() to authenticated;
grant execute on function public.admin_definir_confirmacao_jogador(uuid, uuid, boolean) to authenticated;
