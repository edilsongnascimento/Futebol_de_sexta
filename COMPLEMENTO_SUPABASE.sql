/*
FUTEBOL DE SEXTA — COMPLEMENTO DO BANCO
Execute no SQL Editor do mesmo projeto Supabase, depois dos SQLs iniciais
(supabase.sql e admin.sql) já executados.

Este complemento não apaga tabelas nem registros.
*/

-- Confere se o usuário autenticado está autorizado como administrador.
create or replace function public.admin_verificar_acesso()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.administradores a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.admin_verificar_acesso() from public, anon;
grant execute on function public.admin_verificar_acesso() to authenticated;

-- Painel público: retorna apenas o próximo jogo e nomes/situação dos sócios ativos.
-- Não expõe tokens, códigos de ativação, e-mails ou identificadores privados.
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
    select s.nome, 'socio'::text as tipo, null::text as convidado_por
    from public.confirmacoes c
    join public.socios s on s.id = c.socio_id
    where c.jogo_id = v_jogo.id and c.confirmou = true and s.ativo = true
    union all
    select g.nome, 'convidado'::text as tipo, s.nome as convidado_por
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

-- Permissões explícitas nas funções administrativas que devem existir do admin.sql.
revoke all on function public.admin_criar_socio(text) from public, anon;
revoke all on function public.admin_criar_jogo(date, time) from public, anon;
revoke all on function public.admin_definir_jogo_fechado(uuid, boolean) from public, anon;

grant execute on function public.admin_criar_socio(text) to authenticated;
grant execute on function public.admin_criar_jogo(date, time) to authenticated;
grant execute on function public.admin_definir_jogo_fechado(uuid, boolean) to authenticated;
