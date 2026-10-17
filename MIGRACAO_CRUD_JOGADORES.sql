/*
  Futebol de Sexta - CRUD administrativo de jogadores

  Execute no SQL Editor do Supabase depois dos SQLs-base do projeto e de
  COMPLEMENTO_SUPABASE.sql. A migracao preserva socios e historico.

  Os tres campos ficam nullable na tabela para preservar cadastros antigos.
  As funcoes usadas pelo painel exigem todos os campos em novos cadastros e
  atualizacoes; os registros antigos podem ser completados pela edicao.
*/

alter table public.socios
  add column if not exists telefone text,
  add column if not exists posicao text,
  add column if not exists nivel integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.socios'::regclass
      and conname = 'socios_posicao_valida'
  ) then
    alter table public.socios
      add constraint socios_posicao_valida
      check (posicao is null or posicao in ('Atacante', 'Zagueiro', 'Central', 'Goleiro'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.socios'::regclass
      and conname = 'socios_nivel_valido'
  ) then
    alter table public.socios
      add constraint socios_nivel_valido
      check (nivel is null or nivel between 1 and 3);
  end if;
end;
$$;

create or replace function public.admin_listar_jogadores()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public._admin_autorizado(), false) then
    raise exception 'Acesso administrativo negado.';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'nome', s.nome,
        'telefone', s.telefone,
        'posicao', s.posicao,
        'nivel', s.nivel,
        'ativo', s.ativo,
        'pagante', s.pagante,
        'criado_em', s.criado_em
      )
      order by s.ativo desc, s.nome
    )
    from public.socios s
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_criar_jogador(
  p_nome text,
  p_telefone text,
  p_posicao text,
  p_nivel integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nome text;
  v_token text;
begin
  if not coalesce(public._admin_autorizado(), false) then
    raise exception 'Acesso administrativo negado.';
  end if;
  if length(trim(coalesce(p_nome, ''))) < 3 or length(trim(p_nome)) > 100 then
    raise exception 'Informe um nome entre 3 e 100 caracteres.';
  end if;
  if length(trim(coalesce(p_telefone, ''))) < 3 or length(trim(p_telefone)) > 30 then
    raise exception 'Informe um telefone válido.';
  end if;
  if p_posicao is null or p_posicao not in ('Atacante', 'Zagueiro', 'Central', 'Goleiro') then
    raise exception 'Selecione uma posição válida.';
  end if;
  if p_nivel is null or p_nivel not between 1 and 3 then
    raise exception 'O nível deve ser 1, 2 ou 3.';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.socios (
    nome, telefone, posicao, nivel, ativo, token_hash,
    codigo_ativacao_hash, ativado_em
  )
  values (
    trim(p_nome), trim(p_telefone), p_posicao, p_nivel, true,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    null, now()
  )
  returning id, nome into v_id, v_nome;

  return jsonb_build_object(
    'id', v_id,
    'nome', v_nome,
    'token', v_token,
    'telefone', trim(p_telefone),
    'posicao', p_posicao,
    'nivel', p_nivel,
    'ativo', true
  );
end;
$$;

create or replace function public.admin_atualizar_jogador(
  p_socio_id uuid,
  p_nome text,
  p_telefone text,
  p_posicao text,
  p_nivel integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jogador public.socios%rowtype;
begin
  if not coalesce(public._admin_autorizado(), false) then
    raise exception 'Acesso administrativo negado.';
  end if;
  if p_socio_id is null then
    raise exception 'Jogador inválido.';
  end if;
  if length(trim(coalesce(p_nome, ''))) < 3 or length(trim(p_nome)) > 100 then
    raise exception 'Informe um nome entre 3 e 100 caracteres.';
  end if;
  if length(trim(coalesce(p_telefone, ''))) < 3 or length(trim(p_telefone)) > 30 then
    raise exception 'Informe um telefone válido.';
  end if;
  if p_posicao is null or p_posicao not in ('Atacante', 'Zagueiro', 'Central', 'Goleiro') then
    raise exception 'Selecione uma posição válida.';
  end if;
  if p_nivel is null or p_nivel not between 1 and 3 then
    raise exception 'O nível deve ser 1, 2 ou 3.';
  end if;

  update public.socios
  set nome = trim(p_nome),
      telefone = trim(p_telefone),
      posicao = p_posicao,
      nivel = p_nivel
  where id = p_socio_id
  returning * into v_jogador;

  if not found then
    raise exception 'Jogador não encontrado.';
  end if;

  return jsonb_build_object(
    'id', v_jogador.id,
    'nome', v_jogador.nome,
    'telefone', v_jogador.telefone,
    'posicao', v_jogador.posicao,
    'nivel', v_jogador.nivel,
    'ativo', v_jogador.ativo
  );
end;
$$;

create or replace function public.admin_definir_jogador_ativo(
  p_socio_id uuid,
  p_ativo boolean
)
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
  if p_socio_id is null or p_ativo is null then
    raise exception 'Jogador ou situação inválida.';
  end if;

  update public.socios
  set ativo = p_ativo,
      token_hash = case
        when p_ativo then token_hash
        else encode(extensions.digest(encode(extensions.gen_random_bytes(24), 'hex'), 'sha256'), 'hex')
      end,
      codigo_ativacao_hash = case when p_ativo then codigo_ativacao_hash else null end
  where id = p_socio_id
  returning * into v_jogador;

  if not found then
    raise exception 'Jogador não encontrado.';
  end if;

  if p_ativo then
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    update public.socios
    set token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'),
        ativado_em = coalesce(ativado_em, now())
    where id = p_socio_id
    returning * into v_jogador;

    return jsonb_build_object(
      'id', v_jogador.id,
      'nome', v_jogador.nome,
      'ativo', true,
      'token', v_token
    );
  end if;

  return jsonb_build_object(
    'id', v_jogador.id,
    'nome', v_jogador.nome,
    'ativo', false
  );
end;
$$;

revoke all on function public.admin_listar_jogadores() from public, anon;
revoke all on function public.admin_criar_jogador(text, text, text, integer) from public, anon;
revoke all on function public.admin_atualizar_jogador(uuid, text, text, text, integer) from public, anon;
revoke all on function public.admin_definir_jogador_ativo(uuid, boolean) from public, anon;

grant execute on function public.admin_listar_jogadores() to authenticated;
grant execute on function public.admin_criar_jogador(text, text, text, integer) to authenticated;
grant execute on function public.admin_atualizar_jogador(uuid, text, text, text, integer) to authenticated;
grant execute on function public.admin_definir_jogador_ativo(uuid, boolean) to authenticated;
