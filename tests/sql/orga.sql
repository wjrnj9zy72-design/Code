\pset tuples_only on
do $$
declare
  v_key text; v_secret text := 'secret-de-gui-0123456789abcdef'; v_doc jsonb; v_id text := 'v_fete_voisins_1';
begin
  select cle into v_key from public.marque_points_new_group('Mifa');

  -- Gui crée le sondage, en organisateur.
  perform public.marque_points_put(v_id, jsonb_build_object(
    'kind','poll','id',v_id,'question','Quel soir ?','closedAt',null,'date',null,'owned',true,
    'options', '[{"id":"o1","text":"vendredi"},{"id":"o2","text":"samedi"}]'::jsonb,
    'people', '[{"id":"w1","name":"Gui"},{"id":"w2","name":"Paul"}]'::jsonb,
    'votes', '{}'::jsonb, 'peopleAt', 1, 'updatedAt', 1), v_key, v_secret);

  -- 1. un visiteur tente de tout changer : seul son vote passe
  perform public.marque_points_put(v_id, jsonb_build_object(
    'kind','poll','id',v_id,'question','PIRATÉ','closedAt',999,'date','2030-01-01','owned',false,
    'options', '[]'::jsonb,
    'people', '[{"id":"w1","name":"Pirate"}]'::jsonb,
    'votes', '{"w2|o2":{"v":"yes","at":2}}'::jsonb, 'peopleAt', 2, 'updatedAt', 2), null, null);
  v_doc := public.marque_points_get(v_id);
  if v_doc->>'question' = 'Quel soir ?' and v_doc->'closedAt' = 'null'::jsonb and v_doc->'date' = 'null'::jsonb
     and jsonb_array_length(v_doc->'options') = 2 and (v_doc->>'owned')::boolean then
    raise notice 'OK 1 : question, clôture, date et choix restent ceux de l''organisateur';
  else raise notice 'ÉCHEC 1 : %', v_doc; end if;
  if (v_doc->'votes') ? 'w2|o2' then raise notice 'OK 2 : mais son vote est pris';
  else raise notice 'ÉCHEC 2 : %', v_doc->'votes'; end if;
  if v_doc->'people'->0->>'name' = 'Gui' and jsonb_array_length(v_doc->'people') = 2 then
    raise notice 'OK 3 : il ne renomme ni ne retire personne';
  else raise notice 'ÉCHEC 3 : %', v_doc->'people'; end if;

  -- 4. un visiteur s'ajoute lui-même
  perform public.marque_points_put(v_id, (v_doc || jsonb_build_object(
    'people', (v_doc->'people') || '[{"id":"w3","name":"Mme Durand"}]'::jsonb,
    'votes', (v_doc->'votes') || '{"w3|o2":{"v":"yes","at":3}}'::jsonb, 'peopleAt', 3, 'updatedAt', 3)), null, null);
  v_doc := public.marque_points_get(v_id);
  if jsonb_array_length(v_doc->'people') = 3 and (v_doc->'votes') ? 'w3|o2' then
    raise notice 'OK 4 : un visiteur peut s''ajouter et voter';
  else raise notice 'ÉCHEC 4 : %', v_doc; end if;

  -- 5. un membre du groupe, avec la clé mais sans le secret : même régime
  perform public.marque_points_put(v_id, v_doc || '{"date":"2026-10-10","closedAt":5}'::jsonb, v_key, null);
  v_doc := public.marque_points_get(v_id);
  if v_doc->'date' = 'null'::jsonb and v_doc->'closedAt' = 'null'::jsonb then
    raise notice 'OK 5 : la clé du groupe ne suffit pas à fixer la date ni à clore';
  else raise notice 'ÉCHEC 5 : %', v_doc; end if;

  -- 6. l'organisateur, lui, fixe la date et clôt
  perform public.marque_points_put(v_id, v_doc || '{"date":"2026-10-10","at":"19:00","closedAt":6}'::jsonb, v_key, v_secret);
  v_doc := public.marque_points_get(v_id);
  if v_doc->>'date' = '2026-10-10' and (v_doc->>'closedAt')::int = 6 then
    raise notice 'OK 6 : l''organisateur fixe la date et clôt';
  else raise notice 'ÉCHEC 6 : %', v_doc; end if;

  -- 7. un membre ne peut pas supprimer, même avec la clé
  begin
    perform public.marque_points_delete(v_id, v_key, null);
    raise notice 'ÉCHEC 7 : un membre a supprimé';
  exception when others then
    raise notice 'OK 7 : un membre ne supprime pas (%)', sqlerrm;
  end;

  -- 8. l'organisateur supprime
  perform public.marque_points_delete(v_id, v_key, v_secret);
  if public.marque_points_get(v_id) is null then raise notice 'OK 8 : l''organisateur supprime';
  else raise notice 'ÉCHEC 8'; end if;

  -- 9. un sondage d'avant, sans organisateur : rien ne change
  perform public.marque_points_put('v_ancien_sondage', '{"kind":"poll","id":"v_ancien_sondage","question":"Avant","people":[],"options":[],"votes":{}}'::jsonb, v_key);
  perform public.marque_points_put('v_ancien_sondage', '{"kind":"poll","id":"v_ancien_sondage","question":"Changé","date":"2026-11-01","people":[],"options":[],"votes":{}}'::jsonb, null);
  if public.marque_points_get('v_ancien_sondage')->>'question' = 'Changé' then
    raise notice 'OK 9 : un sondage sans organisateur reste ouvert à tous, comme avant';
  else raise notice 'ÉCHEC 9'; end if;

  -- 10. un secret trop court ne fait pas d'organisateur
  perform public.marque_points_put('v_secret_court', '{"kind":"poll","id":"v_secret_court"}'::jsonb, v_key, 'court');
  if (select owner_hash from public.marque_points_games where id = 'v_secret_court') is null then
    raise notice 'OK 10 : un secret trop court est ignoré';
  else raise notice 'ÉCHEC 10'; end if;
end $$;
