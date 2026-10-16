-- FUTEBOL DE SEXTA - esquema inicial
-- Execute no SQL Editor do Supabase em um projeto novo.
-- IMPORTANTE: revise o script antes de executar. Nunca exponha a service_role key no site.

create extension if not exists pgcrypto;

create table if not exists public.socios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  pagante boolean not null default true,
  token_hash text unique not null,
  codigo_ativacao_hash text,
  ativado_em timestamptz,
  criado_em timestamptz not null default now()
);

create table if not exists public.jogos (
  id uuid primary key default gen_random_uuid(),
  data_jogo date not null unique,
  hora time not null default '19:30',
  fechado boolean not null default false,
  criado_em timestamptz not null default now()
);

create table if not exists public.confirmacoes (
  id uuid primary key default gen_random_uuid(),
  jogo_id uuid not null references public.jogos(id) on delete cascade,
  socio_id uuid not null references public.socios(id) on delete cascade,
  confirmou boolean not null,
  presenca_real boolean,
  atualizado_em timestamptz not null default now(),
  unique(jogo_id,socio_id)
);

create table if not exists public.convidados (
  id uuid primary key default gen_random_uuid(),
  jogo_id uuid not null references public.jogos(id) on delete cascade,
  socio_id uuid not null references public.socios(id) on delete cascade,
  nome text not null,
  presenca_real boolean,
  criado_em timestamptz not null default now(),
  unique(jogo_id,socio_id),
  unique(jogo_id,nome)
);

create table if not exists public.administradores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

create table if not exists public.regras (
  id integer primary key default 1 check(id=1),
  texto text not null default 'Os jogos acontecem às sextas-feiras às 19h30. Cada sócio pode cadastrar um convidado por jogo, conforme disponibilidade de vagas.',
  atualizado_em timestamptz not null default now()
);
insert into public.regras(id) values(1) on conflict(id) do nothing;

alter table public.socios enable row level security;
alter table public.jogos enable row level security;
alter table public.confirmacoes enable row level security;
alter table public.convidados enable row level security;
alter table public.administradores enable row level security;
alter table public.regras enable row level security;

-- Nenhuma tabela é diretamente acessível a usuários anônimos; o site usa funções RPC validadas.
revoke all on public.socios, public.jogos, public.confirmacoes, public.convidados, public.administradores, public.regras from anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Função interna: resolve o sócio pelo token privado fornecido no link.
create or replace function public._socio_por_token(p_token text)
returns uuid language sql security definer set search_path=public
as $$
  select id from public.socios
  where ativo=true and token_hash=encode(digest(p_token,'sha256'),'hex')
  limit 1
$$;

-- Retorna dados mínimos do próprio sócio, o jogo mais próximo e lista de confirmados.
create or replace function public.obter_painel_socio(p_token text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare sid uuid; j public.jogos%rowtype; result jsonb; mine text; guest jsonb; cnt int;
begin
  sid := public._socio_por_token(p_token);
  if sid is null then return jsonb_build_object('socio',null); end if;
  select * into j from public.jogos where data_jogo >= current_date order by data_jogo limit 1;
  if j.id is null then
    return jsonb_build_object('socio',(select jsonb_build_object('id',id,'nome',nome) from public.socios where id=sid),
      'jogo',null,'confirmados','[]'::jsonb,'minha_confirmacao',null,'meu_convidado',null,'pode_convidar',false);
  end if;
  select case when confirmou then 'sim' else 'nao' end into mine from public.confirmacoes where jogo_id=j.id and socio_id=sid;
  select jsonb_build_object('id',id,'nome',nome) into guest from public.convidados where jogo_id=j.id and socio_id=sid;
  select count(*) into cnt from (
    select c.socio_id as x from public.confirmacoes c where c.jogo_id=j.id and c.confirmou=true
    union all select g.socio_id from public.convidados g where g.jogo_id=j.id
  ) q;
  select jsonb_agg(p) into result from (
    select s.nome, 'socio'::text as tipo, null::text as convidado_por
      from public.confirmacoes c join public.socios s on s.id=c.socio_id
      where c.jogo_id=j.id and c.confirmou=true
    union all
    select g.nome, 'convidado'::text, s.nome
      from public.convidados g join public.socios s on s.id=g.socio_id
      where g.jogo_id=j.id
    order by 1
  ) p;
  return jsonb_build_object(
    'socio',(select jsonb_build_object('id',id,'nome',nome) from public.socios where id=sid),
    'jogo',jsonb_build_object('id',j.id,'data_jogo',j.data_jogo,'hora',j.hora,'fechado',j.fechado),
    'confirmados',coalesce(result,'[]'::jsonb),'minha_confirmacao',mine,'meu_convidado',guest,
    'pode_convidar',(not j.fechado and cnt < 18 and guest is null)
  );
end $$;

create or replace function public.confirmar_presenca(p_token text, p_confirmou boolean)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare sid uuid; j public.jogos%rowtype; cnt int;
begin
  sid := public._socio_por_token(p_token);
  if sid is null then return jsonb_build_object('erro','Link individual inválido ou revogado.'); end if;
  select * into j from public.jogos where data_jogo >= current_date order by data_jogo limit 1;
  if j.id is null then return jsonb_build_object('erro','Ainda não há jogo publicado.'); end if;
  if j.fechado then return jsonb_build_object('erro','Este jogo está fechado.'); end if;
  if p_confirmou then
    select count(*) into cnt from (
      select socio_id from public.confirmacoes where jogo_id=j.id and confirmou=true
      union all select socio_id from public.convidados where jogo_id=j.id
    ) x;
    if cnt >= 18 and not exists(select 1 from public.confirmacoes where jogo_id=j.id and socio_id=sid and confirmou=true) then
      return jsonb_build_object('erro','As 18 vagas já foram preenchidas.');
    end if;
  end if;
  insert into public.confirmacoes(jogo_id,socio_id,confirmou)
  values(j.id,sid,p_confirmou)
  on conflict(jogo_id,socio_id) do update set confirmou=excluded.confirmou, atualizado_em=now();
  select count(*) into cnt from (
    select socio_id from public.confirmacoes where jogo_id=j.id and confirmou=true
    union all select socio_id from public.convidados where jogo_id=j.id
  ) x;
  if cnt >= 18 then update public.jogos set fechado=true where id=j.id; end if;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.cadastrar_convidado(p_token text, p_nome text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare sid uuid; j public.jogos%rowtype; cnt int;
begin
  sid := public._socio_por_token(p_token);
  if sid is null then return jsonb_build_object('erro','Link individual inválido ou revogado.'); end if;
  if length(trim(p_nome)) < 3 then return jsonb_build_object('erro','Informe o nome completo do convidado.'); end if;
  select * into j from public.jogos where data_jogo >= current_date order by data_jogo limit 1;
  if j.id is null then return jsonb_build_object('erro','Ainda não há jogo publicado.'); end if;
  if j.fechado then return jsonb_build_object('erro','Este jogo está fechado.'); end if;
  if exists(select 1 from public.convidados where jogo_id=j.id and socio_id=sid) then
    return jsonb_build_object('erro','Você já cadastrou um convidado neste jogo.');
  end if;
  select count(*) into cnt from (
    select socio_id from public.confirmacoes where jogo_id=j.id and confirmou=true
    union all select socio_id from public.convidados where jogo_id=j.id
  ) x;
  if cnt >= 18 then return jsonb_build_object('erro','As vagas já foram preenchidas.'); end if;
  if exists(select 1 from public.convidados where jogo_id=j.id and lower(nome)=lower(trim(p_nome))) then
    return jsonb_build_object('erro','Este convidado já foi cadastrado neste jogo.');
  end if;
  insert into public.convidados(jogo_id,socio_id,nome) values(j.id,sid,trim(p_nome));
  select count(*) into cnt from (
    select socio_id from public.confirmacoes where jogo_id=j.id and confirmou=true
    union all select socio_id from public.convidados where jogo_id=j.id
  ) x;
  if cnt >= 18 then update public.jogos set fechado=true where id=j.id; end if;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.ativar_socio(p_token text, p_codigo text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare sid uuid;
begin
  sid := public._socio_por_token(p_token);
  if sid is null then return jsonb_build_object('erro','Link inválido. Peça outro ao administrador.'); end if;
  if not exists(select 1 from public.socios where id=sid and codigo_ativacao_hash=encode(digest(p_codigo,'sha256'),'hex')) then
    return jsonb_build_object('erro','Código de ativação incorreto.');
  end if;
  update public.socios set ativado_em=coalesce(ativado_em,now()), codigo_ativacao_hash=null where id=sid;
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public._socio_por_token(text) from public, anon, authenticated;
revoke all on function public.obter_painel_socio(text), public.confirmar_presenca(text,boolean),
  public.cadastrar_convidado(text,text), public.ativar_socio(text,text) from public;
grant execute on function public.obter_painel_socio(text), public.confirmar_presenca(text,boolean),
  public.cadastrar_convidado(text,text), public.ativar_socio(text,text) to anon, authenticated;

-- NOTA ADMINISTRATIVA:
-- Cadastre sócios, jogos e tokens pelo SQL Editor inicialmente. O painel administrativo
-- dentro do app não está incluído nesta primeira entrega; será necessário adicionar autenticação
-- de administrador e funções administrativas antes de permitir alterações pelo celular.
