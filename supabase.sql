-- FUTEBOL DE SEXTA — esquema inicial para Supabase
-- Execute no SQL Editor do projeto correto.
-- Este script não cria sócios automaticamente; cadastre-os depois pelo painel seguro.

create extension if not exists pgcrypto;

create table if not exists public.socios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  token_hash text not null unique,
  criado_em timestamptz not null default now()
);

create table if not exists public.jogos (
  id uuid primary key default gen_random_uuid(),
  data_jogo date not null unique,
  hora text not null default '19:30',
  local text,
  status text not null default 'aberto' check (status in ('aberto','fechado','cancelado')),
  criado_em timestamptz not null default now()
);

create table if not exists public.confirmacoes (
  id uuid primary key default gen_random_uuid(),
  jogo_id uuid not null references public.jogos(id) on delete cascade,
  socio_id uuid not null references public.socios(id) on delete cascade,
  resposta text not null check (resposta in ('vou','nao')),
  goleiro boolean not null default false,
  confirmado_em timestamptz not null default now(),
  unique(jogo_id,socio_id)
);

create table if not exists public.convidados (
  id uuid primary key default gen_random_uuid(),
  jogo_id uuid not null references public.jogos(id) on delete cascade,
  socio_id uuid not null references public.socios(id) on delete cascade,
  nome text not null,
  telefone text,
  criado_em timestamptz not null default now(),
  unique(jogo_id,socio_id)
);

create table if not exists public.administradores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

create table if not exists public.presencas (
  id uuid primary key default gen_random_uuid(),
  jogo_id uuid not null references public.jogos(id) on delete cascade,
  socio_id uuid references public.socios(id) on delete cascade,
  convidado_id uuid references public.convidados(id) on delete cascade,
  presente boolean not null default false,
  marcado_em timestamptz,
  check ((socio_id is not null)::int + (convidado_id is not null)::int = 1)
);

create table if not exists public.times (
  id uuid primary key default gen_random_uuid(),
  jogo_id uuid not null references public.jogos(id) on delete cascade,
  nome text not null,
  cor text,
  criado_em timestamptz not null default now()
);

create table if not exists public.time_integrantes (
  id uuid primary key default gen_random_uuid(),
  time_id uuid not null references public.times(id) on delete cascade,
  socio_id uuid references public.socios(id) on delete cascade,
  convidado_id uuid references public.convidados(id) on delete cascade,
  posicao text not null default 'jogador' check (posicao in ('jogador','goleiro','reserva')),
  check ((socio_id is not null)::int + (convidado_id is not null)::int = 1)
);

-- Evita acesso direto às tabelas pelo navegador; as operações públicas passam pelas funções abaixo.
alter table public.socios enable row level security;
alter table public.jogos enable row level security;
alter table public.confirmacoes enable row level security;
alter table public.convidados enable row level security;
alter table public.administradores enable row level security;
alter table public.presencas enable row level security;
alter table public.times enable row level security;
alter table public.time_integrantes enable row level security;

revoke all on public.socios,public.jogos,public.confirmacoes,public.convidados,public.administradores,public.presencas,public.times,public.time_integrantes from anon, authenticated;

create or replace function public.socio_resumo(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.socios; j public.jogos; c public.confirmacoes; g public.convidados; v_jogadores int; v_goleiros int; v_reservas int;
begin
  if p_token is null or length(p_token)<20 then return jsonb_build_object('ok',false,'mensagem','Link individual inválido.'); end if;
  select * into s from public.socios where token_hash=encode(digest(p_token,'sha256'),'hex') and ativo=true;
  if not found then return jsonb_build_object('ok',false,'mensagem','Link individual inválido ou desativado.'); end if;
  select * into j from public.jogos where status='aberto' and data_jogo>=current_date order by data_jogo limit 1;
  if not found then
    return jsonb_build_object('ok',true,'nome',s.nome,'mensagem','Ainda não há jogo aberto. Aguarde a administração.','jogadores',0,'goleiros',0,'reservas',0);
  end if;
  select * into c from public.confirmacoes where jogo_id=j.id and socio_id=s.id;
  select * into g from public.convidados where jogo_id=j.id and socio_id=s.id;
  select count(*) filter(where coalesce(ci.posicao,'jogador')='jogador'), count(*) filter(where ci.posicao='goleiro'), count(*) filter(where ci.posicao='reserva')
    into v_jogadores,v_goleiros,v_reservas
    from public.time_integrantes ci join public.times t on t.id=ci.time_id where t.jogo_id=j.id;
  return jsonb_build_object('ok',true,'nome',s.nome,'mensagem','Próximo jogo: '||to_char(j.data_jogo,'DD/MM/YYYY')||' às '||j.hora,
    'confirmacao',case when c.resposta='vou' then 'vou' when c.resposta='nao' then 'não vou' else null end,
    'convidado_nome',g.nome,'convidado_telefone',g.telefone,'jogadores',coalesce(v_jogadores,0),'goleiros',coalesce(v_goleiros,0),'reservas',coalesce(v_reservas,0));
end $$;

create or replace function public.socio_confirmar(p_token text,p_resposta text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.socios; j public.jogos;
begin
 if p_resposta not in ('vou','nao') then return jsonb_build_object('ok',false,'mensagem','Resposta inválida.'); end if;
 select * into s from public.socios where token_hash=encode(digest(p_token,'sha256'),'hex') and ativo=true;
 if not found then return jsonb_build_object('ok',false,'mensagem','Link inválido ou desativado.'); end if;
 select * into j from public.jogos where status='aberto' and data_jogo>=current_date order by data_jogo limit 1;
 if not found then return jsonb_build_object('ok',false,'mensagem','Não há jogo aberto para confirmação.'); end if;
 insert into public.confirmacoes(jogo_id,socio_id,resposta) values(j.id,s.id,p_resposta)
 on conflict(jogo_id,socio_id) do update set resposta=excluded.resposta,confirmado_em=now();
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.socio_salvar_convidado(p_token text,p_nome text,p_telefone text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.socios; j public.jogos;
begin
 if length(trim(coalesce(p_nome,'')))<2 then return jsonb_build_object('ok',false,'mensagem','Informe o nome do convidado.'); end if;
 select * into s from public.socios where token_hash=encode(digest(p_token,'sha256'),'hex') and ativo=true;
 if not found then return jsonb_build_object('ok',false,'mensagem','Link inválido ou desativado.'); end if;
 select * into j from public.jogos where status='aberto' and data_jogo>=current_date order by data_jogo limit 1;
 if not found then return jsonb_build_object('ok',false,'mensagem','Não há jogo aberto para convidado.'); end if;
 if not exists(select 1 from public.confirmacoes where jogo_id=j.id and socio_id=s.id and resposta='vou') then
   return jsonb_build_object('ok',false,'mensagem','Confirme que vai jogar antes de cadastrar um convidado.');
 end if;
 insert into public.convidados(jogo_id,socio_id,nome,telefone) values(j.id,s.id,trim(p_nome),nullif(trim(coalesce(p_telefone,'')),''))
 on conflict(jogo_id,socio_id) do update set nome=excluded.nome,telefone=excluded.telefone;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.socio_remover_convidado(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.socios; j public.jogos;
begin
 select * into s from public.socios where token_hash=encode(digest(p_token,'sha256'),'hex') and ativo=true;
 if not found then return jsonb_build_object('ok',false,'mensagem','Link inválido ou desativado.'); end if;
 select * into j from public.jogos where status='aberto' and data_jogo>=current_date order by data_jogo limit 1;
 if found then delete from public.convidados where jogo_id=j.id and socio_id=s.id; end if;
 return jsonb_build_object('ok',true);
end $$;

revoke all on function public.socio_resumo(text) from public;
revoke all on function public.socio_confirmar(text,text) from public;
revoke all on function public.socio_salvar_convidado(text,text,text) from public;
revoke all on function public.socio_remover_convidado(text) from public;
grant execute on function public.socio_resumo(text) to anon,authenticated;
grant execute on function public.socio_confirmar(text,text) to anon,authenticated;
grant execute on function public.socio_salvar_convidado(text,text,text) to anon,authenticated;
grant execute on function public.socio_remover_convidado(text) to anon,authenticated;

-- ATENÇÃO:
-- Não exponha tokens em listas públicas. Gere token aleatório de pelo menos 32 bytes
-- e grave SOMENTE SHA-256(token) em socios.token_hash. Envie o token original no link individual.
-- Para administração, cadastre o usuário em auth.users e depois inclua o UUID em administradores.
-- Este pacote ainda não traz tela de gestão de sócios/jogos; use o SQL/Editor com cuidado até
-- instalar um painel administrativo protegido. Veja LEIA-ME.txt.

-- ===== PAINEL ADMINISTRATIVO AUTENTICADO =====
-- Crie usuário em Authentication > Users, copie o UUID e execute:
-- insert into public.administradores(user_id) values ('UUID-DO-ADMIN');

create or replace function public.admin_criar_socio(p_nome text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.administradores where user_id=auth.uid()) then raise exception 'Acesso restrito à administração.'; end if;
 if length(trim(coalesce(p_nome,'')))<2 then raise exception 'Informe o nome do sócio.'; end if;
 if length(coalesce(p_token_hash,''))<>64 then raise exception 'Hash do link inválido.'; end if;
 insert into public.socios(nome,token_hash) values(trim(p_nome),p_token_hash) returning id into new_id;
 return jsonb_build_object('ok',true,'id',new_id,'nome',trim(p_nome));
end $$;

create or replace function public.admin_criar_jogo(p_data date,p_local text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.administradores where user_id=auth.uid()) then raise exception 'Acesso restrito à administração.'; end if;
 if p_data < current_date then raise exception 'A data do jogo não pode estar no passado.'; end if;
 insert into public.jogos(data_jogo,hora,local,status) values(p_data,'19:30',nullif(trim(coalesce(p_local,'')),''),'aberto')
 on conflict(data_jogo) do update set hora='19:30',local=excluded.local,status='aberto' returning id into new_id;
 return jsonb_build_object('ok',true,'id',new_id);
end $$;

create or replace function public.admin_listar_socios()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.administradores where user_id=auth.uid()) then raise exception 'Acesso restrito à administração.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'nome',s.nome,'ativo',s.ativo) order by s.nome) from public.socios s),'[]'::jsonb);
end $$;

create or replace function public.admin_desativar_socio(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.administradores where user_id=auth.uid()) then raise exception 'Acesso restrito à administração.'; end if;
 update public.socios set ativo=false where id=p_id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.admin_resumo()
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.jogos; v_sim int; v_nao int; v_conv int;
begin
 if auth.uid() is null or not exists(select 1 from public.administradores where user_id=auth.uid()) then raise exception 'Acesso restrito à administração.'; end if;
 select * into j from public.jogos where status='aberto' and data_jogo>=current_date order by data_jogo limit 1;
 if not found then return jsonb_build_object('jogo',null,'vou',0,'nao',0,'convidados',0); end if;
 select count(*) filter(where resposta='vou'),count(*) filter(where resposta='nao') into v_sim,v_nao from public.confirmacoes where jogo_id=j.id;
 select count(*) into v_conv from public.convidados where jogo_id=j.id;
 return jsonb_build_object('jogo',jsonb_build_object('data',j.data_jogo,'hora',j.hora,'local',j.local),'vou',coalesce(v_sim,0),'nao',coalesce(v_nao,0),'convidados',coalesce(v_conv,0));
end $$;

revoke all on function public.admin_criar_socio(text,text) from public,anon;
revoke all on function public.admin_criar_jogo(date,text) from public,anon;
revoke all on function public.admin_listar_socios() from public,anon;
revoke all on function public.admin_desativar_socio(uuid) from public,anon;
revoke all on function public.admin_resumo() from public,anon;
grant execute on function public.admin_criar_socio(text,text) to authenticated;
grant execute on function public.admin_criar_jogo(date,text) to authenticated;
grant execute on function public.admin_listar_socios() to authenticated;
grant execute on function public.admin_desativar_socio(uuid) to authenticated;
grant execute on function public.admin_resumo() to authenticated;


-- =====================================================================
-- ATUALIZAÇÃO DO APLICATIVO: listas da tela inicial e CRUD administrativo
-- Pode ser executada novamente; as funções são CREATE OR REPLACE.
-- =====================================================================

alter table public.jogos add column if not exists hora text not null default '19:30';

create or replace function public.socio_resumo(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  s public.socios; j public.jogos; c public.confirmacoes; g public.convidados;
  v_jogadores int:=0; v_goleiros int:=0; v_reservas int:=0;
  v_confirmados jsonb:='[]'::jsonb; v_pendentes jsonb:='[]'::jsonb;
begin
  if p_token is null or length(p_token)<20 then return jsonb_build_object('ok',false,'mensagem','Link individual inválido.'); end if;
  select * into s from public.socios where token_hash=encode(digest(p_token,'sha256'),'hex') and ativo=true;
  if not found then return jsonb_build_object('ok',false,'mensagem','Link individual inválido ou desativado.'); end if;
  select * into j from public.jogos where status='aberto' and data_jogo>=current_date order by data_jogo limit 1;
  if not found then
    select coalesce(jsonb_agg(jsonb_build_object('nome',sx.nome) order by sx.nome),'[]'::jsonb) into v_pendentes from public.socios sx where sx.ativo=true;
    return jsonb_build_object('ok',true,'nome',s.nome,'mensagem','Ainda não há jogo aberto. Aguarde a administração.','jogadores',0,'goleiros',0,'reservas',0,'jogo',null,'confirmacao',null,'confirmados','[]'::jsonb,'pendentes',v_pendentes);
  end if;
  select * into c from public.confirmacoes where jogo_id=j.id and socio_id=s.id;
  select * into g from public.convidados where jogo_id=j.id and socio_id=s.id;
  select count(*) filter(where coalesce(ci.posicao,'jogador')='jogador'),count(*) filter(where ci.posicao='goleiro'),count(*) filter(where ci.posicao='reserva')
    into v_jogadores,v_goleiros,v_reservas from public.time_integrantes ci join public.times t on t.id=ci.time_id where t.jogo_id=j.id;
  select coalesce(jsonb_agg(jsonb_build_object('nome',sx.nome,'goleiro',coalesce(cx.goleiro,false)) order by sx.nome),'[]'::jsonb)
    into v_confirmados from public.confirmacoes cx join public.socios sx on sx.id=cx.socio_id
    where cx.jogo_id=j.id and cx.resposta='vou' and sx.ativo=true;
  select coalesce(jsonb_agg(jsonb_build_object('nome',sx.nome) order by sx.nome),'[]'::jsonb)
    into v_pendentes from public.socios sx left join public.confirmacoes cx on cx.socio_id=sx.id and cx.jogo_id=j.id
    where sx.ativo=true and (cx.id is null);
  return jsonb_build_object('ok',true,'nome',s.nome,'mensagem','Próximo jogo: '||to_char(j.data_jogo,'DD/MM/YYYY')||' às '||j.hora,
    'confirmacao',case when c.resposta='vou' then 'vou' when c.resposta='nao' then 'nao' else null end,
    'convidado_nome',g.nome,'convidado_telefone',g.telefone,'jogadores',coalesce(v_jogadores,0),'goleiros',coalesce(v_goleiros,0),'reservas',coalesce(v_reservas,0),
    'jogo',jsonb_build_object('data',to_char(j.data_jogo,'DD/MM/YYYY'),'hora',j.hora,'local',j.local),
    'confirmados',v_confirmados,'pendentes',v_pendentes);
end $$;

create or replace function public.admin_criar_jogo(p_data date,p_local text default null,p_hora text default '19:30')
returns jsonb language plpgsql security definer set search_path=public as $$
declare new_id uuid; v_hora text;
begin
 if auth.uid() is null or not exists(select 1 from public.administradores where user_id=auth.uid()) then raise exception 'Acesso restrito à administração.'; end if;
 if p_data < current_date then raise exception 'A data do jogo não pode estar no passado.'; end if;
 v_hora:=case when coalesce(trim(p_hora),'') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then trim(p_hora) else '19:30' end;
 insert into public.jogos(data_jogo,hora,local,status) values(p_data,v_hora,nullif(trim(coalesce(p_local,'')),''),'aberto')
 on conflict(data_jogo) do update set hora=excluded.hora,local=excluded.local,status='aberto' returning id into new_id;
 return jsonb_build_object('ok',true,'id',new_id);
end $$;

create or replace function public.admin_listar_socios()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.administradores where user_id=auth.uid()) then raise exception 'Acesso restrito à administração.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'nome',s.nome,'ativo',s.ativo,'criado_em',s.criado_em) order by s.nome) from public.socios s),'[]'::jsonb);
end $$;

create or replace function public.admin_editar_socio(p_id uuid,p_nome text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.administradores where user_id=auth.uid()) then raise exception 'Acesso restrito à administração.'; end if;
 if length(trim(coalesce(p_nome,'')))<2 then raise exception 'Informe o nome do sócio.'; end if;
 update public.socios set nome=trim(p_nome) where id=p_id;
 if not found then raise exception 'Sócio não encontrado.'; end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.admin_gerar_link_socio(p_id uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.administradores where user_id=auth.uid()) then raise exception 'Acesso restrito à administração.'; end if;
 if length(coalesce(p_token_hash,''))<>64 then raise exception 'Hash do link inválido.'; end if;
 update public.socios set token_hash=p_token_hash,ativo=true where id=p_id;
 if not found then raise exception 'Sócio não encontrado.'; end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.admin_ativar_socio(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.administradores where user_id=auth.uid()) then raise exception 'Acesso restrito à administração.'; end if;
 update public.socios set ativo=true where id=p_id;
 if not found then raise exception 'Sócio não encontrado.'; end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.admin_excluir_socio(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.administradores where user_id=auth.uid()) then raise exception 'Acesso restrito à administração.'; end if;
 delete from public.socios where id=p_id;
 if not found then raise exception 'Sócio não encontrado.'; end if;
 return jsonb_build_object('ok',true);
end $$;

revoke all on function public.socio_resumo(text) from public;
grant execute on function public.socio_resumo(text) to anon,authenticated;
revoke all on function public.admin_criar_jogo(date,text,text) from public,anon;
revoke all on function public.admin_listar_socios() from public,anon;
revoke all on function public.admin_editar_socio(uuid,text) from public,anon;
revoke all on function public.admin_gerar_link_socio(uuid,text) from public,anon;
revoke all on function public.admin_ativar_socio(uuid) from public,anon;
revoke all on function public.admin_excluir_socio(uuid) from public,anon;
grant execute on function public.admin_criar_jogo(date,text,text) to authenticated;
grant execute on function public.admin_listar_socios() to authenticated;
grant execute on function public.admin_editar_socio(uuid,text) to authenticated;
grant execute on function public.admin_gerar_link_socio(uuid,text) to authenticated;
grant execute on function public.admin_ativar_socio(uuid) to authenticated;
grant execute on function public.admin_excluir_socio(uuid) to authenticated;
