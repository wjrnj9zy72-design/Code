\pset tuples_only on
do $$
declare
  v_admin text; v_group text; v_out jsonb;
  v_gui uuid := '11111111-1111-1111-1111-111111111111';
begin
  select cle into v_admin from public.marque_points_new_group('Mifa');
  select id into v_group from public.marque_points_group where name = 'Mifa';
  insert into public.marque_points_group_key (id, group_id, label, key_hash, key_salt, admits)
  values ('k_paul', v_group, 'Paul', md5('cle-paul' || 'sel'), 'sel', false);
  perform public.marque_points_put('l_courses_1', '{"kind":"list","id":"l_courses_1","items":[]}'::jsonb, v_admin, null);

  -- 1. sans être connecté, on n'exige rien
  v_out := public.marque_points_set_accounts(v_admin, true);
  if v_out->>'status' = 'account' and not (select accounts_required from public.marque_points_group where id = v_group) then
    raise notice 'OK 1 : pour exiger un compte, il faut être connecté soi-même';
  else raise notice 'ÉCHEC 1 : %', v_out; end if;

  -- 2. une clé qui ne fait pas entrer ne décide rien
  begin
    perform public.marque_points_set_accounts('cle-paul', true);
    raise notice 'ÉCHEC 2 : une clé simple a décidé';
  exception when others then
    raise notice 'OK 2 : seule une clé qui fait entrer le décide';
  end;

  -- 3. connecté, la clé à son compte : exigé
  perform set_config('request.jwt.claim.sub', v_gui::text, true);
  perform public.marque_points_account_link(v_admin, 'Gui');
  v_out := public.marque_points_set_accounts(v_admin, true);
  if v_out->>'status' = 'ok' and (public.marque_points_group_of(v_admin))->>'accounts' = 'true'
     and (public.marque_points_group_of(v_admin))->>'linked' = 'true'
     and (public.marque_points_group_of('cle-paul'))->>'linked' = 'false' then
    raise notice 'OK 3 : exigé ; le groupe le dit, et dit quelle clé est à un compte';
  else raise notice 'ÉCHEC 3 : %', v_out; end if;

  -- 4. Paul, sans compte : plus rien de la liste, ni partage, ni invitation
  if jsonb_array_length(public.marque_points_group_docs('cle-paul')) = 0
     and jsonb_array_length(public.marque_points_group_docs(v_admin)) = 1 then
    raise notice 'OK 4 : sans compte, la liste du groupe est vide ; avec, elle ne l''est pas';
  else raise notice 'ÉCHEC 4'; end if;
  begin
    perform public.marque_points_put('l_paul_1', '{"kind":"list","id":"l_paul_1","items":[]}'::jsonb, 'cle-paul', null);
    raise notice 'ÉCHEC 5 : Paul a partagé sans compte';
  exception when others then
    raise notice 'OK 5 : sans compte, on ne partage plus dans le groupe';
  end;
  begin
    perform public.marque_points_invite('cle-paul', 60, 1);
    raise notice 'ÉCHEC 6 : Paul a invité sans compte';
  exception when others then
    raise notice 'OK 6 : sans compte, on n''invite plus';
  end;
  -- 7. mais ce qu'il a par un lien, il y contribue encore, comme un visiteur
  perform public.marque_points_put('l_courses_1', '{"kind":"list","id":"l_courses_1","items":[{"id":"i1"}]}'::jsonb, null, null);
  if jsonb_array_length((public.marque_points_get('l_courses_1'))->'items') = 1 then
    raise notice 'OK 7 : par un lien, on contribue toujours, sans compte';
  else raise notice 'ÉCHEC 7'; end if;

  -- 8. ne plus l'exiger : Paul revoit tout
  perform set_config('request.jwt.claim.sub', '', true);
  v_out := public.marque_points_set_accounts(v_admin, false);
  if v_out->>'status' = 'ok' and jsonb_array_length(public.marque_points_group_docs('cle-paul')) = 1 then
    raise notice 'OK 8 : ne plus l''exiger rend tout aux appareils sans compte';
  else raise notice 'ÉCHEC 8 : %', v_out; end if;

  -- 9. la liste des appareils dit lesquels ont un compte
  if (select bool_and((row->>'account')::boolean = (row->>'label' <> 'Paul'))
        from jsonb_array_elements(public.marque_points_group_keys(v_admin)) row) then
    raise notice 'OK 9 : la liste des appareils dit lesquels ont un compte';
  else raise notice 'ÉCHEC 9 : %', public.marque_points_group_keys(v_admin); end if;
end;
$$;
