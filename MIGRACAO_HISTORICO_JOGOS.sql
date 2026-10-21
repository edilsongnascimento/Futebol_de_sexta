/*
  Futebol de Sexta - consulta publica de jogos anteriores

  Execute no SQL Editor do Supabase depois dos SQLs-base,
  COMPLEMENTO_SUPABASE.sql e MIGRACAO_TIMES_CONFIRMADOS.sql.
*/

create or replace function public.listar_jogos_anteriores()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', j.id,
      'data_jogo', j.data_jogo,
      'hora', j.hora
    )
    order by j.data_jogo desc, j.hora desc
  ), '[]'::jsonb)
  from public.jogos j
  where j.data_jogo < current_date;
$$;

create or replace function public.obter_painel_jogo_anterior(p_jogo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jogo public.jogos%rowtype;
  v_confirmados jsonb;
  v_nao_vai jsonb;
  v_total integer := 0;
begin
  if p_jogo_id is null then
    raise exception 'Jogo inválido.';
  end if;

  select * into v_jogo
  from public.jogos
  where id = p_jogo_id
    and data_jogo < current_date;

  if not found then
    raise exception 'Jogo anterior não encontrado.';
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.nome), '[]'::jsonb)
  into v_confirmados
  from (
    select s.nome, 'socio'::text as tipo, null::text as convidado_por,
      s.posicao, s.nivel
    from public.confirmacoes c
    join public.socios s on s.id = c.socio_id
    where c.jogo_id = v_jogo.id
      and c.confirmou = true
    union all
    select g.nome, 'convidado'::text as tipo, s.nome as convidado_por,
      null::text as posicao, null::integer as nivel
    from public.convidados g
    join public.socios s on s.id = g.socio_id
    where g.jogo_id = v_jogo.id
  ) x;

  select coalesce(jsonb_agg(
    jsonb_build_object('nome', s.nome, 'tipo', 'socio')
    order by s.nome
  ), '[]'::jsonb)
  into v_nao_vai
  from public.confirmacoes c
  join public.socios s on s.id = c.socio_id
  where c.jogo_id = v_jogo.id
    and c.confirmou = false;

  select count(*) into v_total
  from (
    select c.socio_id
    from public.confirmacoes c
    where c.jogo_id = v_jogo.id
      and c.confirmou = true
    union all
    select g.socio_id
    from public.convidados g
    where g.jogo_id = v_jogo.id
  ) ocupadas;

  return jsonb_build_object(
    'jogo', jsonb_build_object(
      'id', v_jogo.id,
      'data_jogo', v_jogo.data_jogo,
      'hora', v_jogo.hora,
      'fechado', true
    ),
    'confirmados', v_confirmados,
    'nao_confirmados', '[]'::jsonb,
    'nao_vai', v_nao_vai,
    'total_ocupadas', v_total
  );
end;
$$;

revoke all on function public.listar_jogos_anteriores() from public;
revoke all on function public.obter_painel_jogo_anterior(uuid) from public;
grant execute on function public.listar_jogos_anteriores() to anon, authenticated;
grant execute on function public.obter_painel_jogo_anterior(uuid) to anon, authenticated;
