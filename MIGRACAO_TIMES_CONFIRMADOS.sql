/*
  Futebol de Sexta - dados para separar confirmados em dois times

  Execute no SQL Editor do Supabase depois de
  MIGRACAO_CRUD_JOGADORES.sql e COMPLEMENTO_SUPABASE.sql.
*/

create or replace function public.obter_painel_publico()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jogo public.jogos%rowtype;
  v_confirmados jsonb;
  v_pendentes jsonb;
  v_nao_vai jsonb;
  v_total integer := 0;
begin
  select * into v_jogo
  from public.jogos
  where data_jogo >= current_date
  order by data_jogo
  limit 1;

  if v_jogo.id is null then
    return jsonb_build_object(
      'jogo', null,
      'confirmados', '[]'::jsonb,
      'nao_confirmados', '[]'::jsonb,
      'nao_vai', '[]'::jsonb,
      'total_ocupadas', 0
    );
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.nome), '[]'::jsonb)
  into v_confirmados
  from (
    select s.nome, 'socio'::text as tipo, null::text as convidado_por,
      s.posicao, s.nivel
    from public.confirmacoes c
    join public.socios s on s.id = c.socio_id
    where c.jogo_id = v_jogo.id and c.confirmou = true and s.ativo = true
    union all
    select g.nome, 'convidado'::text as tipo, s.nome as convidado_por,
      null::text as posicao, null::integer as nivel
    from public.convidados g
    join public.socios s on s.id = g.socio_id
    where g.jogo_id = v_jogo.id and s.ativo = true
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('nome',s.nome,'tipo','socio') order by s.nome),'[]'::jsonb)
  into v_pendentes
  from public.socios s
  where s.ativo = true
    and not exists (
      select 1 from public.confirmacoes c
      where c.jogo_id = v_jogo.id and c.socio_id = s.id
    );

  select coalesce(jsonb_agg(jsonb_build_object('nome',s.nome,'tipo','socio') order by s.nome),'[]'::jsonb)
  into v_nao_vai
  from public.confirmacoes c
  join public.socios s on s.id = c.socio_id
  where c.jogo_id = v_jogo.id and c.confirmou = false and s.ativo = true;

  select count(*) into v_total from (
    select c.socio_id
    from public.confirmacoes c
    join public.socios s on s.id = c.socio_id
    where c.jogo_id = v_jogo.id and c.confirmou = true and s.ativo = true
    union all
    select g.socio_id
    from public.convidados g
    join public.socios s on s.id = g.socio_id
    where g.jogo_id = v_jogo.id and s.ativo = true
  ) occupied;

  return jsonb_build_object(
    'jogo', jsonb_build_object(
      'id', v_jogo.id,
      'data_jogo', v_jogo.data_jogo,
      'hora', v_jogo.hora,
      'fechado', v_jogo.fechado
    ),
    'confirmados', v_confirmados,
    'nao_confirmados', v_pendentes,
    'nao_vai', v_nao_vai,
    'total_ocupadas', v_total
  );
end;
$$;

revoke all on function public.obter_painel_publico() from public;
grant execute on function public.obter_painel_publico() to anon, authenticated;
