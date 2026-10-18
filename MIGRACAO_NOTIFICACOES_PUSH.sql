/*
  Futebol de Sexta - assinaturas e registro de notificacoes push

  Execute no SQL Editor do Supabase depois dos SQLs-base do projeto.
  As assinaturas so podem ser alteradas com o token individual do jogador.
*/

create table if not exists public.push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  socio_id uuid not null references public.socios(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint push_subscriptions_endpoint_https check (endpoint like 'https://%'),
  constraint push_subscriptions_keys_not_empty check (length(p256dh) > 0 and length(auth) > 0)
);

create index if not exists push_subscriptions_socio_id_idx
  on public.push_subscriptions(socio_id);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

create table if not exists public.push_notification_events (
  event_key text primary key,
  jogo_id uuid not null references public.jogos(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'novo_jogo',
      'confirmacoes_abertas',
      'confirmacoes_fechadas',
      'lembrete',
      'lotacao'
    )
  ),
  status text not null default 'enviando' check (
    status in ('enviando', 'enviado', 'parcial', 'sem_destinatarios', 'falhou')
  ),
  destinatarios integer not null default 0,
  enviados integer not null default 0,
  falhas integer not null default 0,
  criado_em timestamptz not null default now(),
  concluido_em timestamptz
);

alter table public.push_notification_events enable row level security;
revoke all on table public.push_notification_events from public, anon, authenticated;
grant select, insert, update, delete on table public.push_notification_events to service_role;

create or replace function public.registrar_assinatura_push(
  p_token text,
  p_subscription jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_socio_id uuid;
  v_endpoint text;
  v_p256dh text;
  v_auth text;
begin
  if length(coalesce(p_token, '')) < 32 then
    raise exception 'Acesso individual invalido.';
  end if;

  select s.id into v_socio_id
  from public.socios s
  where s.ativo = true
    and s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  if v_socio_id is null then
    raise exception 'O link individual nao esta ativo.';
  end if;

  if jsonb_typeof(p_subscription) <> 'object'
    or jsonb_typeof(p_subscription -> 'keys') <> 'object' then
    raise exception 'Assinatura de notificacao invalida.';
  end if;

  v_endpoint := p_subscription ->> 'endpoint';
  v_p256dh := p_subscription -> 'keys' ->> 'p256dh';
  v_auth := p_subscription -> 'keys' ->> 'auth';

  if v_endpoint is null or v_endpoint not like 'https://%'
    or length(v_endpoint) > 2048
    or coalesce(length(v_p256dh), 0) < 16
    or coalesce(length(v_auth), 0) < 8 then
    raise exception 'Dados da assinatura de notificacao invalidos.';
  end if;

  insert into public.push_subscriptions (socio_id, endpoint, p256dh, auth)
  values (v_socio_id, v_endpoint, v_p256dh, v_auth)
  on conflict (endpoint) do update
    set socio_id = excluded.socio_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        atualizado_em = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.remover_assinatura_push(
  p_token text,
  p_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_socio_id uuid;
begin
  if length(coalesce(p_token, '')) < 32 then
    raise exception 'Acesso individual invalido.';
  end if;

  select s.id into v_socio_id
  from public.socios s
  where s.ativo = true
    and s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  if v_socio_id is null then
    raise exception 'O link individual nao esta ativo.';
  end if;

  delete from public.push_subscriptions
  where socio_id = v_socio_id
    and endpoint = p_endpoint;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.registrar_assinatura_push(text, jsonb) from public;
revoke all on function public.remover_assinatura_push(text, text) from public;
grant execute on function public.registrar_assinatura_push(text, jsonb) to anon, authenticated;
grant execute on function public.remover_assinatura_push(text, text) to anon, authenticated;
