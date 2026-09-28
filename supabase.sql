-- =====================================================================
-- Auriverde · banco compartilhado no Supabase
-- Cole este arquivo inteiro no Supabase em: SQL Editor → New query → Run
--
-- ANTES DE RODAR: no item 1 logo abaixo, troque o texto do e-mail pelo que
-- você vai usar para entrar no app. Esse e-mail é o DONO (Administrador).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Configuração: quem é o dono do app
-- ---------------------------------------------------------------------
create table if not exists public.app_config (
  id          int primary key default 1 check (id = 1),
  dono_email  text not null
);
insert into public.app_config (id, dono_email)
values (1, lower('SEU_EMAIL_AQUI'))
on conflict (id) do update set dono_email = excluded.dono_email;

alter table public.app_config enable row level security;
-- ninguém lê nem altera pelo app; só pelo painel do Supabase
revoke all on public.app_config from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Documentos do app (tudo o que o app grava fica aqui)
--    path    = caminho do registro, ex: produtores/abc123
--    colecao = coleção do registro, ex: produtores  (calculada)
-- ---------------------------------------------------------------------
create table if not exists public.docs (
  path           text primary key,
  colecao        text generated always as (regexp_replace(path, '/[^/]+$', '')) stored,
  dados          jsonb not null default '{}'::jsonb,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create index if not exists docs_colecao_idx on public.docs (colecao);

-- quem gravou e quando: sempre preenchido pelo banco
create or replace function public.docs_carimbo() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists docs_carimbo on public.docs;
create trigger docs_carimbo before insert or update on public.docs
for each row execute function public.docs_carimbo();

-- ---------------------------------------------------------------------
-- 3. Perfis (nome de cada pessoa, para mostrar "registrado por")
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  id     uuid primary key references auth.users (id) on delete cascade,
  nome   text not null default '',
  email  text
);

-- ---------------------------------------------------------------------
-- 4. Quem é quem (usado pelas regras de acesso)
-- ---------------------------------------------------------------------
create or replace function public.eh_dono() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(lower(auth.jwt() ->> 'email') = (select dono_email from public.app_config where id = 1), false)
$$;

create or replace function public.minha_situacao() returns text
language sql stable security definer set search_path = public as $$
  select dados ->> 'situacao' from public.docs where path = 'usuarios/' || auth.uid()::text
$$;

create or replace function public.eh_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_dono() or coalesce(public.minha_situacao() = 'ativo', false)
$$;

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_dono() or exists (
    select 1 from public.docs
    where path = 'usuarios/' || auth.uid()::text
      and dados ->> 'situacao' = 'ativo'
      and dados ->> 'papel' = 'admin'
  )
$$;

-- o app pergunta "sou o dono?" por aqui (a resposta vem do banco, não do celular)
revoke execute on function public.eh_dono(), public.eh_ativo(), public.eh_admin(), public.minha_situacao() from anon, public;
grant execute on function public.eh_dono(), public.eh_ativo(), public.eh_admin(), public.minha_situacao() to authenticated;

-- ---------------------------------------------------------------------
-- 5. Regras de acesso (valem mesmo que alguém tente burlar o app)
--    - Sem aprovação: só vê e grava o próprio pedido de acesso
--    - Aprovado (ativo): vê e grava os dados do app
--    - Só Administrador: usuários e configurações
--    - Registro de atividades: cada um vê o seu; Administrador vê todos
-- ---------------------------------------------------------------------
alter table public.docs enable row level security;
alter table public.perfis enable row level security;
revoke all on public.docs, public.perfis from anon;
grant select, insert, update, delete on public.docs, public.perfis to authenticated;

drop policy if exists docs_ler on public.docs;
create policy docs_ler on public.docs for select to authenticated using (
  (select public.eh_admin())
  or ((select public.eh_ativo()) and colecao not like 'atividades/%')
  or colecao = 'atividades/' || (select auth.uid())::text || '/itens'
  or path = 'usuarios/' || auth.uid()::text
  or path = 'solicitacoes/' || auth.uid()::text
);

drop policy if exists docs_criar on public.docs;
create policy docs_criar on public.docs for insert to authenticated with check (
  (select public.eh_admin())
  or ((select public.eh_ativo()) and colecao not in ('usuarios', 'config'))
  or path = 'solicitacoes/' || auth.uid()::text
);

drop policy if exists docs_alterar on public.docs;
create policy docs_alterar on public.docs for update to authenticated
using (
  (select public.eh_admin())
  or ((select public.eh_ativo()) and colecao not in ('usuarios', 'config'))
  or path = 'solicitacoes/' || auth.uid()::text
)
with check (
  (select public.eh_admin())
  or ((select public.eh_ativo()) and colecao not in ('usuarios', 'config'))
  or path = 'solicitacoes/' || auth.uid()::text
);

drop policy if exists docs_apagar on public.docs;
create policy docs_apagar on public.docs for delete to authenticated using (
  (select public.eh_admin())
  or ((select public.eh_ativo()) and colecao not in ('usuarios', 'config'))
);

drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated using (
  id = auth.uid() or (select public.eh_ativo())
);
drop policy if exists perfis_gravar on public.perfis;
create policy perfis_gravar on public.perfis for insert to authenticated with check (id = auth.uid());
drop policy if exists perfis_alterar on public.perfis;
create policy perfis_alterar on public.perfis for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- 6. Atualizar só alguns campos de um registro (mescla campo a campo)
-- ---------------------------------------------------------------------
create or replace function public.jsonb_mesclar(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select case
    when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then (
      select coalesce(jsonb_object_agg(
        coalesce(ka, kb),
        case
          when va is null then vb
          when vb is null then va
          else public.jsonb_mesclar(va, vb)
        end
      ), '{}'::jsonb)
      from jsonb_each(a) as x(ka, va)
      full join jsonb_each(b) as y(kb, vb) on ka = kb
    )
    else b
  end
$$;

create or replace function public.atualizar_doc(p_path text, p_campos jsonb) returns boolean
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  update public.docs set dados = public.jsonb_mesclar(dados, p_campos) where path = p_path;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'registro não encontrado ou sem permissão' using errcode = 'P0002';
  end if;
  return true;
end $$;
grant execute on function public.atualizar_doc(text, jsonb) to authenticated;
revoke execute on function public.atualizar_doc(text, jsonb) from anon;

-- ---------------------------------------------------------------------
-- 7. Tempo real: o app de todo mundo atualiza sozinho quando alguém grava
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'
  ) then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;

-- Pronto! Confira em Table Editor se apareceram as tabelas docs e perfis.
