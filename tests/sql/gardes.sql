\pset tuples_only on
do $$
declare
  v_admin text; v_group text; v_other text; v_out jsonb; v_token text; v_big jsonb;
  v_gui uuid := '22222222-2222-2222-2222-222222222222';
begin
  select cle into v_admin from public.marque_points_new_group('Mifa');
  select id into v_group from public.marque_points_group where name = 'Mifa';
  select cle into v_other from public.marque_points_new_group('Voisins');
  insert into public.marque_points_group_key (id, group_id, label, key_hash, key_salt, admits)
  values ('k_paul_g', v_group, 'Paul', md5('cle-paul' || 'sel'), 'sel', false);
  perform public.marque_points_put('l_garde_1', '{"kind":"list","id":"l_garde_1","items":[]}'::jsonb, v_admin, null);

  -- 1. des agendas qui frappent à une adresse coupée ne font taire personne
  v_token := (public.marque_points_calendar(v_admin))->>'token';
  for i in 1..30 loop perform public.marque_points_agenda('0000000000000000000000000000dead'); end loop;
  if (public.marque_points_agenda(v_token))->>'status' = 'ok' then
    raise notice 'OK 1 : trente adresses inconnues, et l''agenda du groupe répond toujours';
  else raise notice 'ÉCHEC 1 : %', public.marque_points_agenda(v_token); end if;

  -- 2. seule une clé qui fait entrer coupe l'agenda
  if (public.marque_points_forget_calendar('cle-paul'))->>'status' = 'unknown'
     and (public.marque_points_agenda(v_token))->>'status' = 'ok' then
    raise notice 'OK 2 : une clé simple ne coupe pas l''agenda de tout le monde';
  else raise notice 'ÉCHEC 2'; end if;

  -- 3. un lot ne se retire qu'avec une clé de son groupe
  perform public.marque_points_put_set('lot_garde_1', '{"games":[]}'::jsonb, '123456', v_admin);
  if (public.marque_points_forget_set('lot_garde_1', v_other))->>'status' = 'unknown'
     and exists (select 1 from public.marque_points_games where id = 'lot_garde_1') then
    raise notice 'OK 3 : la clé d''un autre groupe ne retire pas le lot';
  else raise notice 'ÉCHEC 3'; end if;

  -- 4. le groupe exige un compte : Paul, sans compte, n'a plus ni agenda, ni
  -- suppression, ni lot
  perform set_config('request.jwt.claim.sub', v_gui::text, true);
  perform public.marque_points_account_link(v_admin, 'Gui');
  perform public.marque_points_set_accounts(v_admin, true);
  if (public.marque_points_calendar('cle-paul'))->>'status' = 'account'
     and (public.marque_points_calendar(v_admin))->>'status' = 'ok' then
    raise notice 'OK 4 : sans compte, pas d''agenda ; avec, si';
  else raise notice 'ÉCHEC 4'; end if;
  begin
    perform public.marque_points_delete('l_garde_1', 'cle-paul', null);
    raise notice 'ÉCHEC 5 : Paul a supprimé sans compte';
  exception when others then
    raise notice 'OK 5 : sans compte, on ne supprime plus dans le groupe';
  end;
  begin
    perform public.marque_points_put_set('lot_garde_2', '{"games":[]}'::jsonb, '123456', 'cle-paul');
    raise notice 'ÉCHEC 6 : Paul a déposé un lot sans compte';
  exception when others then
    raise notice 'OK 6 : sans compte, pas de lot';
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.marque_points_set_accounts(v_admin, false);

  -- 7. un visiteur n'enfle pas un sondage au-delà de la limite, envoi après envoi
  perform public.marque_points_put('p_garde_1', '{"kind":"poll","id":"p_garde_1","options":[],"votes":{}}'::jsonb,
                                   v_admin, 'secret-organisateur-garde');
  for i in 0..9 loop
    begin
      select jsonb_build_object('kind', 'poll', 'id', 'p_garde_1',
               'votes', jsonb_object_agg('v' || i || '_' || n || '|o', jsonb_build_object('v', md5(n::text) || md5(n::text), 'at', n)))
        into v_big from generate_series(1, 1500) n;
      perform public.marque_points_put('p_garde_1', v_big, null, null);
    exception when others then null;
    end;
  end loop;
  if pg_column_size((select data from public.marque_points_games where id = 'p_garde_1')::jsonb) <= 200000
     and jsonb_typeof((public.marque_points_get('p_garde_1'))->'votes') = 'object' then
    raise notice 'OK 7 : le sondage reste sous la limite, et lisible';
  else raise notice 'ÉCHEC 7 : % octets', pg_column_size((select data from public.marque_points_games where id = 'p_garde_1')); end if;
end;
$$;
