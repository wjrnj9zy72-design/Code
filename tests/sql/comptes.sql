\pset tuples_only on
do $$
declare
  v_key text; v_other text; v_secret text := 'secret-de-gui-0123456789abcdef'; v_id text := 'v_resto_1';
  v_gui uuid := '11111111-1111-1111-1111-111111111111';
  v_alice uuid := '22222222-2222-2222-2222-222222222222';
  v_out jsonb; v_new text; v_group text; v_ok boolean;
begin
  select cle into v_key from public.marque_points_new_group('Mifa');
  select id into v_group from public.marque_points_group where name = 'Mifa';
  perform public.marque_points_put(v_id, jsonb_build_object(
    'kind','poll','id',v_id,'question','Quel resto ?','owned',true,
    'options','[]'::jsonb,'people','[]'::jsonb,'votes','{}'::jsonb,'updatedAt',1), v_key, v_secret);

  -- 1. sans connexion, rien
  begin
    perform public.marque_points_account_link(v_key, 'Gui');
    raise notice 'ÉCHEC 1 : sans compte, la clé a été marquée';
  exception when others then
    raise notice 'OK 1 : sans compte, rien ne se marque';
  end;

  -- 2. Gui se connecte, marque sa clé et garde son secret
  perform set_config('request.jwt.claim.sub', v_gui::text, true);
  v_out := public.marque_points_account_link(v_key, 'Gui');
  if v_out->>'status' = 'ok' and v_out->>'id' = v_group then raise notice 'OK 2 : la clé est marquée au compte';
  else raise notice 'ÉCHEC 2 : %', v_out; end if;
  v_out := public.marque_points_account_owner_put(v_id, 'mauvais-secret-0000000000');
  if v_out->>'status' = 'unknown' then raise notice 'OK 3 : un faux secret n''est pas gardé';
  else raise notice 'ÉCHEC 3 : %', v_out; end if;
  v_out := public.marque_points_account_owner_put(v_id, v_secret);
  if v_out->>'status' = 'ok' then raise notice 'OK 4 : le vrai l''est';
  else raise notice 'ÉCHEC 4 : %', v_out; end if;

  -- 5. un nouvel appareil : une clé neuve, qui ouvre le groupe, et le secret
  v_out := public.marque_points_account_restore('[]'::jsonb, 'téléphone neuf');
  v_new := v_out->'groups'->0->>'key';
  if jsonb_array_length(v_out->'groups') = 1 and v_new is not null and v_new <> v_key
     and (public.marque_points_group_of(v_new))->>'id' = v_group
     and ((public.marque_points_group_of(v_new))->>'admits')::boolean
     and v_out->'owners'->>v_id = v_secret and v_out->>'name' = 'Gui' then
    raise notice 'OK 5 : un nouvel appareil retrouve le groupe (qui fait entrer) et le secret';
  else raise notice 'ÉCHEC 5 : %', v_out; end if;
  if not exists (select 1 from public.marque_points_group_key where key_hash = md5(v_new || key_salt) and label like 'Gui · téléphone neuf%') then
    raise notice 'ÉCHEC 6 : l''appareil n''est pas nommé';
  else raise notice 'OK 6 : il porte le prénom et l''appareil dans la liste des clés'; end if;
  v_out := public.marque_points_account_restore(jsonb_build_array(v_group), 'encore');
  if jsonb_array_length(v_out->'groups') = 0 then raise notice 'OK 7 : un groupe déjà là ne se redouble pas';
  else raise notice 'ÉCHEC 7 : %', v_out; end if;
  -- 9. Alice, autre compte : rien de Gui
  perform set_config('request.jwt.claim.sub', v_alice::text, true);
  v_out := public.marque_points_account_restore('[]'::jsonb, 'x');
  if jsonb_array_length(v_out->'groups') = 0 and v_out->'owners' = '{}'::jsonb then raise notice 'OK 9 : un autre compte ne reçoit rien';
  else raise notice 'ÉCHEC 9 : %', v_out; end if;

  -- 10. clés coupées : le compte n'est plus du groupe
  perform set_config('request.jwt.claim.sub', v_gui::text, true);
  delete from public.marque_points_group_key where user_id = v_gui;
  v_out := public.marque_points_account_restore('[]'::jsonb, 'après');
  if jsonb_array_length(v_out->'groups') = 0 then raise notice 'OK 10 : toutes ses clés coupées, le compte est sorti du groupe';
  else raise notice 'ÉCHEC 10 : %', v_out; end if;

  -- Un appareil de plus, sans rien effacer : une clé posée à la main.
  -- (marque_points_new_group_key refait la clé du groupe : tout le monde dehors.)

  -- 11. quitter : plus aucune clé du compte dans le groupe
  delete from public.marque_points_account_cut where user_id = v_gui;
  insert into public.marque_points_group_key (id, group_id, label, key_hash, key_salt, admits)
  values ('k_q1', v_group, 'essai', md5('cle-q1' || 'sel'), 'sel', false),
         ('k_q2', v_group, 'essai', md5('cle-q2' || 'sel'), 'sel', false);
  perform public.marque_points_account_link('cle-q1', 'Gui');
  perform public.marque_points_account_link('cle-q2', 'Gui');
  v_out := public.marque_points_account_leave('cle-q1');
  if v_out->>'status' = 'ok'
     and not exists (select 1 from public.marque_points_group_key where user_id = v_gui)
     and jsonb_array_length((public.marque_points_account_restore('[]'::jsonb, 'x'))->'groups') = 0 then
    raise notice 'OK 11 : quitter sort le compte du groupe, sur tous ses appareils';
  else raise notice 'ÉCHEC 11 : %', v_out; end if;

  -- 13. le téléphone perdu : Gui a deux appareils ; on coupe l'un
  insert into public.marque_points_group_key (id, group_id, label, key_hash, key_salt, admits)
  values ('k_admin', v_group, 'la clé de qui fait entrer', md5('cle-admin' || 'sel'), 'sel', true),
         ('k_tel', v_group, 'téléphone', md5('cle-tel' || 'sel'), 'sel', false),
         ('k_ordi', v_group, 'ordinateur', md5('cle-ordi' || 'sel'), 'sel', false);
  perform public.marque_points_account_link('cle-tel', 'Gui');
  perform public.marque_points_account_link('cle-ordi', 'Gui');
  if jsonb_array_length((public.marque_points_account_restore('[]'::jsonb, 'avant'))->'groups') <> 1 then
    raise notice 'ÉCHEC 13 : avant la coupure, le compte devait ramener le groupe';
  end if;
  perform public.marque_points_cut_key('cle-admin', 'k_tel');
  if exists (select 1 from public.marque_points_group_key where id = 'k_tel') then
    raise notice 'ÉCHEC 13 : la clé n''a pas été coupée';
  end if;
  v_out := public.marque_points_account_restore('[]'::jsonb, 'le téléphone coupé');
  if jsonb_array_length(v_out->'groups') = 0 then
    raise notice 'OK 13 : un appareil coupé ne se redonne pas de clé par le compte, même si un autre appareil reste';
  else raise notice 'ÉCHEC 13 : %', v_out; end if;
  if (public.marque_points_group_of('cle-ordi'))->>'id' = v_group then
    raise notice 'OK 14 : l''autre appareil, lui, reste dans le groupe';
  else raise notice 'ÉCHEC 14'; end if;
  perform public.marque_points_account_link('cle-ordi', 'Gui');
  if jsonb_array_length((public.marque_points_account_restore('[]'::jsonb, 'x'))->'groups') = 0 then
    raise notice 'OK 15 : en se resynchronisant, il ne rouvre pas la porte au téléphone coupé';
  else raise notice 'ÉCHEC 15'; end if;

  -- 16. un appareil admis après la coupure ramène le compte
  update public.marque_points_account_cut set cut_at = now() - interval '1 minute' where user_id = v_gui;
  insert into public.marque_points_group_key (id, group_id, label, key_hash, key_salt, admits)
  values ('k_neuf', v_group, 'admis de nouveau', md5('cle-neuf' || 'sel'), 'sel', false);
  perform public.marque_points_account_link('cle-neuf', 'Gui');
  if jsonb_array_length((public.marque_points_account_restore('[]'::jsonb, 'x'))->'groups') = 1 then
    raise notice 'OK 16 : un appareil admis de nouveau ramène le compte dans le groupe';
  else raise notice 'ÉCHEC 16'; end if;

  -- 12. supprimer son compte : l'adresse, le prénom, les secrets, les marques
  insert into auth.users (id, email) values (v_gui, 'gui@exemple.fr');
  perform public.marque_points_account_owner_put(v_id, v_secret);
  v_out := public.marque_points_account_delete();
  if v_out->>'status' = 'ok'
     and not exists (select 1 from auth.users where id = v_gui)
     and not exists (select 1 from public.marque_points_account where user_id = v_gui)
     and not exists (select 1 from public.marque_points_account_owner where user_id = v_gui)
     and not exists (select 1 from public.marque_points_group_key where user_id = v_gui)
     and not exists (select 1 from public.marque_points_account_cut where user_id = v_gui)
     and (public.marque_points_group_of('cle-neuf'))->>'id' = v_group then
    raise notice 'OK 12 : le compte et son adresse sont effacés, l''appareil reste dans le groupe';
  else raise notice 'ÉCHEC 12 : %', v_out; end if;
end;
$$;
