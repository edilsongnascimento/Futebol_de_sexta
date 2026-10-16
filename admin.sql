
-- FUTEBOL DE SEXTA
-- Funcoes administrativas complementares
-- Execute somente depois do supabase.sql inicial.

create or replace function public._admin_autorizado()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.administradores a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public._admin_autorizado()
from public, anon, authenticated;

-- Cadastrar socio e gerar link/token e codigo de ativacao.
-- O token aparece somente na resposta inicial: guarde-o com seguranca.
create or replace function public.admin_criar_socio(p_nome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nome text;
  v_token text;
  v_codigo text;
begin
  if not public._admin_autorizado() then
    raise exception 'Acesso administrativo negado.';
  end if;

  if length(trim(coalesce(p_nome, ''))) < 3 then
    raise exception 'Informe o nome do socio.';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_codigo := upper(encode(extensions.gen_random_bytes(4), 'hex'));

  insert into public.socios
    (nome, token_hash, codigo_ativacao_hash)
  values (
    trim(p_nome),
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    encode(extensions.digest(v_codigo, 'sha256'), 'hex')
  )
  returning id, nome into v_id, v_nome;

  return jsonb_build_object(
    'id', v_id,
    'nome', v_nome,
    'token', v_token,
    'codigo_ativacao', v_codigo
  );
end;
$$;

-- Criar ou atualizar o jogo de uma data.
create or replace function public.admin_criar_jogo(
  p_data date,
  p_hora time default '19:30'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jogo public.jogos%rowtype;
begin
  if not public._admin_autorizado() then
    raise exception 'Acesso administrativo negado.';
  end if;

  if p_data is null or p_data < current_date then
    raise exception 'Informe uma data valida, hoje ou futura.';
  end if;

  insert into public.jogos (data_jogo, hora, fechado)
  values (p_data, coalesce(p_hora, '19:30'), false)
  on conflict (data_jogo)
  do update set hora = excluded.hora
  returning * into v_jogo;

  return jsonb_build_object(
    'id', v_jogo.id,
    'data_jogo', v_jogo.data_jogo,
    'hora', v_jogo.hora,
    'fechado', v_jogo.fechado
  );
end;
$$;

-- Fechar ou reabrir um jogo existente.
create or replace function public.admin_definir_jogo_fechado(
  p_jogo_id uuid,
  p_fechado boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._admin_autorizado() then
    raise exception 'Acesso administrativo negado.';
  end if;

  update public.jogos
  set fechado = p_fechado
  where id = p_jogo_id;

  if not found then
    raise exception 'Jogo nao encontrado.';
  end if;

  return jsonb_build_object('ok', true, 'fechado', p_fechado);
end;
$$;

revoke all on function public.admin_criar_socio(text)
from public, anon;

revoke all on function public.admin_criar_jogo(date, time)
from public, anon;

revoke all on function public.admin_definir_jogo_fechado(uuid, boolean)
from public, anon;

grant execute on function public.admin_criar_socio(text)
to authenticated;

grant execute on function public.admin_criar_jogo(date, time)
to authenticated;

grant execute on function public.admin_definir_jogo_fechado(uuid, boolean)
to authenticated;
