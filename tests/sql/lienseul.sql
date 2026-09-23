\pset tuples_only on
\pset format unaligned
do $$
declare
  v_key text; v_group text; v_token text; v_docs jsonb; v_listed jsonb; v_agenda jsonb;
begin
  select cle into v_key from public.marque_points_new_group('Mifa');
  select id into v_group from public.marque_points_group where name = 'Mifa';

  -- un sondage du groupe, et un « lien seulement », tous deux datés
  perform public.marque_points_put('v_famille_0001',
    '{"kind":"poll","id":"v_famille_0001","question":"Quel soir pour la raclette ?","date":"2026-10-09","people":[],"options":[],"votes":{}}'::jsonb, v_key);
  perform public.marque_points_put('v_voisins_0001',
    '{"kind":"poll","id":"v_voisins_0001","question":"Quel soir pour la fête des voisins ?","date":"2026-10-09","linkOnly":true,"people":[],"options":[],"votes":{}}'::jsonb, v_key);

  -- 1. le groupe ne liste que le sien
  v_listed := public.marque_points_group_docs(v_key);
  if jsonb_array_length(v_listed) = 1 and v_listed->0->>'id' = 'v_famille_0001' then
    raise notice 'OK 1 : le groupe ne liste pas le « lien seulement »';
  else raise notice 'ÉCHEC 1 : %', v_listed; end if;

  -- 2. mais le lien l'ouvre
  if public.marque_points_get('v_voisins_0001')->>'question' like '%voisins%' then
    raise notice 'OK 2 : le lien l''ouvre, sans clé';
  else raise notice 'ÉCHEC 2'; end if;

  -- 3. l'agenda du groupe ne le porte pas
  v_token := public.marque_points_calendar(v_key)->>'token';
  v_agenda := public.marque_points_agenda(v_token);
  if jsonb_array_length(v_agenda->'docs') = 1 and v_agenda->'docs'->0->>'id' = 'v_famille_0001' then
    raise notice 'OK 3 : l''agenda du groupe (FamilyWall) ne le porte pas';
  else raise notice 'ÉCHEC 3 : %', v_agenda; end if;

  -- 4. quelqu'un qui a le lien peut voter…
  perform public.marque_points_put('v_voisins_0001',
    '{"kind":"poll","id":"v_voisins_0001","question":"Quel soir pour la fête des voisins ?","linkOnly":true,"people":[],"options":[],"votes":{"a|b":{"v":"yes"}}}'::jsonb, null);
  if (public.marque_points_get('v_voisins_0001')->'votes') ? 'a|b' then
    raise notice 'OK 4 : qui a le lien peut y répondre';
  else raise notice 'ÉCHEC 4'; end if;

  -- 5. …mais pas le faire apparaître dans le groupe en réécrivant linkOnly
  perform public.marque_points_put('v_voisins_0001',
    '{"kind":"poll","id":"v_voisins_0001","question":"piraté","linkOnly":false,"people":[],"options":[],"votes":{}}'::jsonb, null);
  if jsonb_array_length(public.marque_points_group_docs(v_key)) = 1 then
    raise notice 'OK 5 : réécrire linkOnly ne le fait pas apparaître dans le groupe';
  else raise notice 'ÉCHEC 5'; end if;

  -- 6. le propriétaire garde le droit de le supprimer, avec sa clé
  perform public.marque_points_delete('v_voisins_0001', v_key);
  if public.marque_points_get('v_voisins_0001') is null then
    raise notice 'OK 6 : la clé du groupe le supprime';
  else raise notice 'ÉCHEC 6'; end if;

  -- 7. et sans clé, on ne crée toujours rien
  begin
    perform public.marque_points_put('v_intrus_00001', '{"kind":"poll","linkOnly":true}'::jsonb, null);
    raise notice 'ÉCHEC 7 : un inconnu a pu créer';
  exception when others then
    raise notice 'OK 7 : « lien seulement » ne dispense pas de la clé pour créer';
  end;
end $$;
