-- Mise à jour d'une base déjà en place — à passer une fois, en entier.
--
-- Supabase → SQL Editor → New query → collez tout ce fichier → Run.
-- Réponse attendue : « Success. No rows returned ».
--
-- Sans danger à repasser : rien ici n'efface de données, et tout ce qui
-- existe déjà est remplacé en place. Ce que ça apporte :
--
--   1. les invitations valent deux jours au lieu d'un ;
--   2. « Lien seulement » : un document que seuls ceux qui ont le lien voient,
--      absent des onglets et de l'agenda du groupe ;
--   3. l'organisateur : qui crée un sondage garde seul la main sur la date,
--      la clôture, la question, les choix et la suppression ; les autres
--      votent, et s'ajoutent eux-mêmes ;
--   4. un sondage se fond case par case au lieu d'être remplacé : une copie
--      en retard n'efface plus les votes arrivés entre-temps ;
--   5. ce qui est supprimé ne revient plus : un téléphone qui gardait un
--      sondage supprimé ne peut plus le recréer, ni le ranger dans un autre
--      groupe ; et un sondage clos ne prend plus de votes ;
--   6. les comptes, facultatifs : se connecter par e-mail retrouve ses
--      groupes et ses droits d'organisateur sur tout nouvel appareil ; et
--      chacun peut supprimer son compte et son adresse ;
--   7. un groupe peut exiger un compte : sans compte, un appareil n'y voit
--      plus ce qui est partagé, n'y partage plus et n'y invite plus ;
--   8. qui répond à un sondage par un lien peut y ajouter des choix, et
--      retirer ceux qu'il a ajoutés.
--
-- Généré depuis docs/DEPLOIEMENT.md, étape 2 bis ; un test vérifie que les
-- deux disent la même chose. Modifiez le guide, pas ce fichier seul.

-- 6 et 7. Les comptes, et les groupes qui en exigent un : les colonnes d'abord,
-- que les fonctions ci-dessous lisent.
alter table public.marque_points_group_key
  add column if not exists user_id uuid;
create index if not exists marque_points_group_key_user on public.marque_points_group_key (user_id);

alter table public.marque_points_group
  add column if not exists accounts_required boolean not null default false;

-- 1. Deux jours pour une invitation.
create or replace function public.marque_points_invite(
  p_key text,
  p_minutes integer default 30,
  p_uses integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group text;
  v_name text;
  v_code text;
  -- Deux jours au plus : un lien envoyé le soir doit survivre à quelqu'un qui
  -- lit ses messages le lendemain soir, et un lien retrouvé la semaine d'après
  -- doit être mort.
  v_minutes integer := greatest(5, least(coalesce(p_minutes, 30), 2880));
  v_uses integer := greatest(1, least(coalesce(p_uses, 1), 200));
begin
  select g.id, g.name into v_group, v_name
    from public.marque_points_group_key k
    join public.marque_points_group g on g.id = k.group_id
   where k.key_hash = md5(coalesce(p_key, '') || k.key_salt)
     and (not g.accounts_required or k.user_id is not null);
  if v_group is null then
    raise exception 'cle de groupe invalide';
  end if;

  -- Ménage : ce qui est mort ne doit pas occuper un code.
  delete from public.marque_points_invite
   where expires_at < now() or uses <= 0 or tries >= 10;

  v_code := public.marque_points_fresh_code();
  insert into public.marque_points_invite (code, group_id, expires_at, uses)
  values (v_code, v_group, now() + make_interval(mins => v_minutes), v_uses);

  return jsonb_build_object('code', v_code, 'name', v_name, 'minutes', v_minutes, 'uses', v_uses);
end;
$$;

-- 2. « Lien seulement », et 3. l'organisateur.
alter table public.marque_points_games
  add column if not exists listed boolean not null default true;

alter table public.marque_points_games
  add column if not exists owner_hash text;

-- 4. Les votes fondus case par case.
create or replace function public.marque_points_merge_votes(p_stored jsonb, p_incoming jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(cells.key,
           case
             when cells.incoming is null then cells.stored
             when cells.stored is null then cells.incoming
             when coalesce((cells.incoming->>'at')::numeric, 0) >= coalesce((cells.stored->>'at')::numeric, 0)
               then cells.incoming
             else cells.stored
           end), '{}'::jsonb)
    from (
      select coalesce(s.key, i.key) as key, s.value as stored, i.value as incoming
        from jsonb_each(coalesce(p_stored, '{}'::jsonb)) s
        full join jsonb_each(coalesce(p_incoming, '{}'::jsonb)) i on s.key = i.key
    ) cells;
$$;

-- 5. La trace de ce qui a été supprimé : des identifiants, rien du contenu.
create table if not exists public.marque_points_gone (
  id text primary key,
  gone_at timestamptz not null default now()
);
alter table public.marque_points_gone enable row level security;

-- Les versions précédentes de l'écriture et de la suppression : remplacées
-- ci-dessous par des versions qui connaissent l'organisateur. Les laisser
-- ferait deux fonctions du même nom, entre lesquelles la base refuserait de
-- choisir. Ce sont des fonctions, pas des données : rien n'est perdu.
drop function if exists public.marque_points_put(text, jsonb, text);
drop function if exists public.marque_points_delete(text, text);

-- 8. Les choix qu'ajoutent les visiteurs.
create or replace function public.marque_points_add_options(p_kept jsonb, p_more jsonb, p_removed jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select (case when jsonb_typeof(p_kept) = 'array' then p_kept else '[]'::jsonb end)
         || coalesce((
           select jsonb_agg(n.value order by n.ord)
             from jsonb_array_elements(case when jsonb_typeof(p_more) = 'array' then p_more else '[]'::jsonb end)
                  with ordinality n(value, ord)
            where jsonb_typeof(n.value->'id') = 'string'
              and jsonb_typeof(n.value->'text') = 'string'
              and not coalesce(p_removed, '{}'::jsonb) ? (n.value->>'id')
              and not exists (
                select 1 from jsonb_array_elements(case when jsonb_typeof(p_kept) = 'array' then p_kept else '[]'::jsonb end) o
                 where o.value->>'id' = n.value->>'id')
         ), '[]'::jsonb);
$$;

create or replace function public.marque_points_put(
  p_id text,
  p_data jsonb,
  p_key text default null,
  p_owner text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stored jsonb;
  v_owner text;
  v_group text;
  v_unlock jsonb;
  v_drop jsonb;
begin
  if p_id is null or length(p_id) < 8 or length(p_id) > 128 then
    raise exception 'identifiant invalide';
  end if;
  if pg_column_size(p_data) > 200000 then
    raise exception 'donnee trop volumineuse';
  end if;
  -- Les secrets qui prouvent qu'un choix retiré était bien le sien : lus
  -- ci-dessous, gardés nulle part.
  v_unlock := p_data->'unlock';
  p_data := p_data - 'unlock';

  select data, owner_hash into v_stored, v_owner
    from public.marque_points_games
   where id = p_id and code_hash is null;

  -- FOUND, et non une variable remplie par la requête : quand aucune ligne ne
  -- revient, SELECT … INTO met toutes ses variables à NULL, la témoin comprise.
  if not found then
    -- Supprimé : on ne le recrée pas, ni ici ni ailleurs. L'app qui l'avait
    -- encore le retire de son côté en lisant cette réponse.
    if exists (select 1 from public.marque_points_gone where id = p_id) then
      raise exception 'document supprime';
    end if;

    -- Rien sous cet identifiant : c'est un partage qui commence, donc il faut
    -- dire dans quel groupe.
    select k.group_id into v_group
      from public.marque_points_group_key k
      join public.marque_points_group grp on grp.id = k.group_id
     where k.key_hash = md5(coalesce(p_key, '') || k.key_salt)
       and (not grp.accounts_required or k.user_id is not null);
    if v_group is null then
      raise exception 'cle de groupe invalide';
    end if;

    insert into public.marque_points_games (id, data, updated_at, group_id, listed, owner_hash)
    values (p_id, p_data, now(), v_group,
            not coalesce((p_data->>'linkOnly')::boolean, false),
            case when p_owner is not null and length(p_owner) >= 16 then md5(p_owner || p_id) end);
    return;
  end if;

  -- La ligne existe : qui a le lien peut y contribuer — entièrement si rien
  -- n'a d'organisateur ou si c'est lui qui écrit…
  if v_owner is null or md5(coalesce(p_owner, '') || p_id) = v_owner then
    if v_stored->>'kind' = 'poll' and p_data->>'kind' = 'poll' then
      -- …mais un sondage se fond, il ne se remplace pas : la copie qui arrive
      -- peut ignorer un vote arrivé entre-temps, et l'écraser le perdrait.
      -- Les personnes suivent la copie qui y a touché en dernier, comme dans
      -- l'app. Un choix ajouté entre-temps par un visiteur reste, à moins que
      -- la copie qui arrive ne l'ait supprimé.
      p_data := p_data || jsonb_build_object(
        'votes', public.marque_points_merge_votes(v_stored->'votes', p_data->'votes'),
        'options', public.marque_points_add_options(p_data->'options', v_stored->'options',
                     coalesce(v_stored->'removed', '{}'::jsonb) || coalesce(p_data->'removed', '{}'::jsonb)),
        'people', case
                    when coalesce((p_data->>'peopleAt')::numeric, 0) >= coalesce((v_stored->>'peopleAt')::numeric, 0)
                      then coalesce(p_data->'people', '[]'::jsonb)
                    else coalesce(v_stored->'people', '[]'::jsonb)
                  end,
        'peopleAt', greatest(coalesce((v_stored->>'peopleAt')::numeric, 0),
                             coalesce((p_data->>'peopleAt')::numeric, 0)),
        'updatedAt', greatest(coalesce((v_stored->>'updatedAt')::numeric, 0),
                              coalesce((p_data->>'updatedAt')::numeric, 0)));
    end if;
    update public.marque_points_games
       set data = p_data, updated_at = now()
     where id = p_id and code_hash is null;
    return;
  end if;

  -- …et sinon, seulement en votant. Tout le reste est repris tel qu'il était :
  -- la date, la clôture, la question. Les personnes et les choix ne peuvent
  -- que s'ajouter — ceux qui y sont gardent leur nom, et personne n'en retire.
  if v_stored->>'kind' is distinct from 'poll' then
    return; -- un organisateur ne se pose que sur un sondage ; rien d'autre à céder
  end if;
  if coalesce(v_stored->>'closedAt', '') <> '' then
    return; -- clos : les votes sont arrêtés, pour l'app comme pour la base
  end if;

  -- Un choix qu'il a lui-même ajouté, il peut le retirer : il en montre le
  -- secret, dont le choix porte l'empreinte (by). Les autres restent.
  select coalesce(jsonb_object_agg(o.value->>'id', (extract(epoch from now()) * 1000)::bigint), '{}'::jsonb)
    into v_drop
    from jsonb_array_elements(case when jsonb_typeof(v_stored->'options') = 'array'
                                   then v_stored->'options' else '[]'::jsonb end) o
   where jsonb_typeof(v_unlock) = 'object'
     and jsonb_typeof(o.value->'by') = 'string'
     and jsonb_typeof(v_unlock->(o.value->>'id')) = 'string'
     and encode(sha256(convert_to(v_unlock->>(o.value->>'id'), 'UTF8')), 'hex') = o.value->>'by';

  update public.marque_points_games
     set data = v_stored
           || jsonb_build_object(
                'votes', (select coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb)
                            from jsonb_each(public.marque_points_merge_votes(v_stored->'votes', p_data->'votes')) c
                           where not v_drop ? split_part(c.key, '|', 2)),
                'removed', (case when jsonb_typeof(v_stored->'removed') = 'object'
                                 then v_stored->'removed' else '{}'::jsonb end) || v_drop,
                'people', coalesce(v_stored->'people', '[]'::jsonb) || coalesce((
                  select jsonb_agg(n.value)
                    from jsonb_array_elements(coalesce(p_data->'people', '[]'::jsonb)) n
                   where not exists (
                     select 1 from jsonb_array_elements(coalesce(v_stored->'people', '[]'::jsonb)) o
                      where o.value->>'id' = n.value->>'id')
                ), '[]'::jsonb),
                'options', public.marque_points_add_options(
                             (select coalesce(jsonb_agg(o.value order by o.ord), '[]'::jsonb)
                                from jsonb_array_elements(case when jsonb_typeof(v_stored->'options') = 'array'
                                                               then v_stored->'options' else '[]'::jsonb end)
                                     with ordinality o(value, ord)
                               where not v_drop ? (o.value->>'id')),
                             p_data->'options',
                             coalesce(v_stored->'removed', '{}'::jsonb) || v_drop),
                'peopleAt', greatest(coalesce((v_stored->>'peopleAt')::numeric, 0),
                                     coalesce((p_data->>'peopleAt')::numeric, 0)),
                'updatedAt', greatest(coalesce((v_stored->>'updatedAt')::numeric, 0),
                                      coalesce((p_data->>'updatedAt')::numeric, 0))),
         updated_at = now()
   where id = p_id and code_hash is null;
end;
$$;

create or replace function public.marque_points_delete(
  p_id text,
  p_key text default null,
  p_owner text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group text;
  v_owner text;
begin
  select group_id, owner_hash into v_group, v_owner from public.marque_points_games
   where id = p_id and code_hash is null;
  if not found then
    return; -- rien à supprimer, rien à refuser
  end if;

  if v_group is null or v_group is distinct from (
    select group_id from public.marque_points_group_key
     where key_hash = md5(coalesce(p_key, '') || key_salt)
  ) then
    raise exception 'cle de groupe invalide';
  end if;

  -- Un sondage qui a un organisateur ne se supprime que de sa main : la clé du
  -- groupe, que tous les membres ont, n'y suffit pas.
  if v_owner is not null and md5(coalesce(p_owner, '') || p_id) is distinct from v_owner then
    raise exception 'reserve a l''organisateur';
  end if;

  delete from public.marque_points_games where id = p_id and code_hash is null;
  insert into public.marque_points_gone (id) values (p_id) on conflict (id) do nothing;
end;
$$;

create or replace function public.marque_points_group_docs(p_key text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'updatedAt', g.data->'updatedAt')), '[]'::jsonb)
    from public.marque_points_games g
    join public.marque_points_group_key k on k.group_id = g.group_id
    join public.marque_points_group grp on grp.id = k.group_id
   where k.key_hash = md5(coalesce(p_key, '') || k.key_salt)
     and (not grp.accounts_required or k.user_id is not null)
     and g.code_hash is null
     and g.listed;
$$;

create or replace function public.marque_points_agenda(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.marque_points_group;
  v_misses integer;
begin
  delete from public.marque_points_join_miss where at < now() - interval '1 hour';

  select count(*) into v_misses
    from public.marque_points_join_miss
   where name = '' and at > now() - interval '10 minutes';
  if v_misses >= 20 then
    return jsonb_build_object('status', 'busy');
  end if;

  select g.* into v_group
    from public.marque_points_group g
   where g.calendar is not null and g.calendar = coalesce(p_token, '');

  if not found then
    insert into public.marque_points_join_miss (name) values ('');
    return jsonb_build_object('status', 'unknown');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'name', v_group.name,
    'docs', coalesce((
      select jsonb_agg(g.data)
        from public.marque_points_games g
       where g.group_id = v_group.id
         and g.code_hash is null
         and g.listed
         and g.data->>'kind' in ('list', 'poll')
    ), '[]'::jsonb));
end;
$$;

-- Les mêmes droits qu'avant, sur les nouvelles versions, rien de plus ;
-- et la fonte des votes n'est qu'un outil de l'écriture, pas une porte.
grant execute on function public.marque_points_invite(text, integer, integer) to anon, authenticated;
grant execute on function public.marque_points_put(text, jsonb, text, text) to anon, authenticated;
grant execute on function public.marque_points_delete(text, text, text) to anon, authenticated;
grant execute on function public.marque_points_group_docs(text) to anon, authenticated;
grant execute on function public.marque_points_agenda(text) to anon, authenticated;
revoke all on function public.marque_points_merge_votes(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.marque_points_add_options(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- 6. Les comptes : les secrets d'organisateur.
create table if not exists public.marque_points_account (
  user_id uuid primary key,
  name text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.marque_points_account enable row level security;

create table if not exists public.marque_points_account_owner (
  user_id uuid not null,
  doc_id text not null,
  secret text not null,
  primary key (user_id, doc_id)
);
alter table public.marque_points_account_owner enable row level security;

create table if not exists public.marque_points_account_cut (
  user_id uuid not null,
  group_id text not null,
  cut_at timestamptz not null default now(),
  primary key (user_id, group_id)
);
alter table public.marque_points_account_cut enable row level security;

create or replace function public.marque_points_account_cut_mark()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.user_id is not null then
    insert into public.marque_points_account_cut (user_id, group_id)
    values (old.user_id, old.group_id)
    on conflict (user_id, group_id) do update set cut_at = now();
  end if;
  return old;
end;
$$;

drop trigger if exists marque_points_account_cut_mark on public.marque_points_group_key;
create trigger marque_points_account_cut_mark
  after delete on public.marque_points_group_key
  for each row execute function public.marque_points_account_cut_mark();

create or replace function public.marque_points_account_link(p_key text, p_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_group text;
  v_since timestamptz;
begin
  if v_user is null then
    raise exception 'connexion requise';
  end if;
  update public.marque_points_group_key k
     set user_id = v_user
   where k.key_hash = md5(coalesce(p_key, '') || k.key_salt)
  returning k.group_id, k.created_at into v_group, v_since;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  -- Une clé admise après la coupure ramène le compte ; une clé d'avant, non.
  delete from public.marque_points_account_cut
   where user_id = v_user and group_id = v_group and cut_at < v_since;
  if btrim(coalesce(p_name, '')) <> '' then
    insert into public.marque_points_account (user_id, name)
    values (v_user, left(btrim(p_name), 40))
    on conflict (user_id) do update set name = excluded.name, updated_at = now();
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_group);
end;
$$;

create or replace function public.marque_points_account_owner_put(p_id text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'connexion requise';
  end if;
  if not exists (select 1 from public.marque_points_games
                  where id = p_id and owner_hash = md5(coalesce(p_secret, '') || p_id)) then
    return jsonb_build_object('status', 'unknown');
  end if;
  insert into public.marque_points_account_owner (user_id, doc_id, secret)
  values (v_user, p_id, p_secret)
  on conflict (user_id, doc_id) do update set secret = excluded.secret;
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.marque_points_account_restore(p_have jsonb default '[]'::jsonb, p_label text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_groups jsonb := '[]'::jsonb;
  v_row record;
  v_key text;
  v_salt text;
begin
  if v_user is null then
    raise exception 'connexion requise';
  end if;
  select name into v_name from public.marque_points_account where user_id = v_user;
  for v_row in
    select k.group_id, g.name as group_name, bool_or(k.admits) as admits, max(k.person_id) as person_id
      from public.marque_points_group_key k
      join public.marque_points_group g on g.id = k.group_id
     where k.user_id = v_user
       and not (to_jsonb(k.group_id) <@ coalesce(p_have, '[]'::jsonb))
       and not exists (select 1 from public.marque_points_account_cut c
                        where c.user_id = v_user and c.group_id = k.group_id)
     group by k.group_id, g.name
  loop
    v_key := replace(gen_random_uuid()::text, '-', '');
    v_salt := md5(gen_random_uuid()::text);
    insert into public.marque_points_group_key (id, group_id, label, key_hash, key_salt, admits, person_id, user_id)
    values (replace(gen_random_uuid()::text, '-', ''), v_row.group_id,
            left(btrim(coalesce(v_name, '') || ' · ' || coalesce(btrim(p_label), '')), 80),
            md5(v_key || v_salt), v_salt, v_row.admits, v_row.person_id, v_user);
    v_groups := v_groups || jsonb_build_object('id', v_row.group_id, 'name', v_row.group_name,
                                               'key', v_key, 'admits', v_row.admits);
  end loop;
  return jsonb_build_object(
    'status', 'ok',
    'name', coalesce(v_name, ''),
    'groups', v_groups,
    'owners', coalesce((select jsonb_object_agg(o.doc_id, o.secret)
                          from public.marque_points_account_owner o
                          join public.marque_points_games d on d.id = o.doc_id
                         where o.user_id = v_user), '{}'::jsonb));
end;
$$;

create or replace function public.marque_points_account_leave(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_group text;
begin
  if v_user is null then
    raise exception 'connexion requise';
  end if;
  select k.group_id into v_group from public.marque_points_group_key k
   where k.key_hash = md5(coalesce(p_key, '') || k.key_salt);
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  update public.marque_points_group_key set user_id = null
   where group_id = v_group and user_id = v_user;
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.marque_points_account_delete()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'connexion requise';
  end if;
  update public.marque_points_group_key set user_id = null where user_id = v_user;
  delete from public.marque_points_account_owner where user_id = v_user;
  delete from public.marque_points_account_cut where user_id = v_user;
  delete from public.marque_points_account where user_id = v_user;
  -- L'adresse elle-même vit chez Supabase Auth. Si la base refusait d'y
  -- toucher, le reste est effacé quand même, et l'app le dit.
  begin
    delete from auth.users where id = v_user;
  exception when insufficient_privilege then
    return jsonb_build_object('status', 'partial');
  end;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- 7. Exiger un compte dans un groupe.
create or replace function public.marque_points_group_of(p_key text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('id', g.id, 'name', g.name, 'admits', k.admits,
                            'accounts', g.accounts_required, 'linked', k.user_id is not null)
    from public.marque_points_group_key k
    join public.marque_points_group g on g.id = k.group_id
   where k.key_hash = md5(coalesce(p_key, '') || k.key_salt)
   limit 1;
$$;

create or replace function public.marque_points_group_keys(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group text;
begin
  select k.group_id into v_group
    from public.marque_points_group_key k
   where k.key_hash = md5(coalesce(p_key, '') || k.key_salt)
     and k.admits;
  if v_group is null then
    raise exception 'cette cle ne fait pas entrer';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', k.id, 'label', k.label, 'admits', k.admits,
             'mine', k.key_hash = md5(coalesce(p_key, '') || k.key_salt),
             'person', k.person_id,
             'who', (select p.name from public.marque_points_person p where p.id = k.person_id),
             'link', (select p.token_hash is not null from public.marque_points_person p where p.id = k.person_id),
             'account', k.user_id is not null,
             'at', (extract(epoch from k.created_at) * 1000)::bigint)
           order by k.created_at)
      from public.marque_points_group_key k
     where k.group_id = v_group
  ), '[]'::jsonb);
end;
$$;

create or replace function public.marque_points_set_accounts(p_key text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group text;
  v_user uuid;
begin
  select k.group_id, k.user_id into v_group, v_user
    from public.marque_points_group_key k
   where k.key_hash = md5(coalesce(p_key, '') || k.key_salt)
     and k.admits;
  if not found then
    raise exception 'cette cle ne fait pas entrer';
  end if;
  if coalesce(p_on, false) and (auth.uid() is null or v_user is distinct from auth.uid()) then
    return jsonb_build_object('status', 'account');
  end if;
  update public.marque_points_group set accounts_required = coalesce(p_on, false) where id = v_group;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Pour les comptes connectés seulement, pas pour la clé publique de la page.
revoke all on function public.marque_points_account_link(text, text) from public, anon;
revoke all on function public.marque_points_account_owner_put(text, text) from public, anon;
revoke all on function public.marque_points_account_restore(jsonb, text) from public, anon;
revoke all on function public.marque_points_account_leave(text) from public, anon;
revoke all on function public.marque_points_account_delete() from public, anon;
grant execute on function public.marque_points_account_link(text, text) to authenticated;
grant execute on function public.marque_points_account_owner_put(text, text) to authenticated;
grant execute on function public.marque_points_account_restore(jsonb, text) to authenticated;
grant execute on function public.marque_points_account_leave(text) to authenticated;
grant execute on function public.marque_points_account_delete() to authenticated;
revoke all on function public.marque_points_account_cut_mark() from public, anon, authenticated;
grant execute on function public.marque_points_group_of(text) to anon, authenticated;
grant execute on function public.marque_points_group_keys(text) to anon, authenticated;
grant execute on function public.marque_points_set_accounts(text, boolean) to anon, authenticated;
