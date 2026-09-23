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
--      groupe ; et un sondage clos ne prend plus de votes.
--
-- Généré depuis docs/DEPLOIEMENT.md, étape 2 bis ; un test vérifie que les
-- deux disent la même chose. Modifiez le guide, pas ce fichier seul.

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
   where k.key_hash = md5(coalesce(p_key, '') || k.key_salt);
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
begin
  if p_id is null or length(p_id) < 8 or length(p_id) > 128 then
    raise exception 'identifiant invalide';
  end if;
  if pg_column_size(p_data) > 200000 then
    raise exception 'donnee trop volumineuse';
  end if;

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
    select group_id into v_group from public.marque_points_group_key
     where key_hash = md5(coalesce(p_key, '') || key_salt);
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
      -- l'app.
      p_data := p_data || jsonb_build_object(
        'votes', public.marque_points_merge_votes(v_stored->'votes', p_data->'votes'),
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
  -- la date, la clôture, la question, les choix. Les personnes ne peuvent que
  -- s'ajouter — celles qui y sont gardent leur nom, et personne n'en retire.
  if v_stored->>'kind' is distinct from 'poll' then
    return; -- un organisateur ne se pose que sur un sondage ; rien d'autre à céder
  end if;
  if coalesce(v_stored->>'closedAt', '') <> '' then
    return; -- clos : les votes sont arrêtés, pour l'app comme pour la base
  end if;

  update public.marque_points_games
     set data = v_stored
           || jsonb_build_object(
                'votes', public.marque_points_merge_votes(v_stored->'votes', p_data->'votes'),
                'people', coalesce(v_stored->'people', '[]'::jsonb) || coalesce((
                  select jsonb_agg(n.value)
                    from jsonb_array_elements(coalesce(p_data->'people', '[]'::jsonb)) n
                   where not exists (
                     select 1 from jsonb_array_elements(coalesce(v_stored->'people', '[]'::jsonb)) o
                      where o.value->>'id' = n.value->>'id')
                ), '[]'::jsonb),
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
   where k.key_hash = md5(coalesce(p_key, '') || k.key_salt)
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
