\pset tuples_only on
do $$
declare
  v_key text; v_secret text := 'secret-de-gui-0123456789abcdef'; v_doc jsonb; v_id text := 'v_fusion_00001';
  v_base jsonb;
begin
  select cle into v_key from public.marque_points_new_group('Fusion');
  v_base := jsonb_build_object('kind','poll','id',v_id,'question','Quel soir ?','owned',true,
    'options','[{"id":"o1","text":"vendredi"},{"id":"o2","text":"samedi"}]'::jsonb,
    'people','[{"id":"w1","name":"Gui"}]'::jsonb,'votes','{}'::jsonb,'peopleAt',10,'updatedAt',10);
  perform public.marque_points_put(v_id, v_base, v_key, v_secret);

  -- Paul, visiteur, s'ajoute et coche samedi.
  perform public.marque_points_put(v_id, v_base || jsonb_build_object(
    'people','[{"id":"w1","name":"Gui"},{"id":"w2","name":"Paul"}]'::jsonb,
    'votes','{"w2|o2":{"v":"yes","at":20}}'::jsonb,'peopleAt',20,'updatedAt',20), null, null);

  -- 1. L'organisateur, sans avoir reçu Paul, coche vendredi (sa copie a peopleAt 10).
  perform public.marque_points_put(v_id, v_base || jsonb_build_object(
    'votes','{"w1|o1":{"v":"yes","at":30}}'::jsonb,'updatedAt',30), v_key, v_secret);
  v_doc := public.marque_points_get(v_id);
  if (v_doc->'votes') ? 'w2|o2' and (v_doc->'votes') ? 'w1|o1' then
    raise notice 'OK 1 : le coché de l''organisateur n''efface plus celui de Paul';
  else raise notice 'ÉCHEC 1 : %', v_doc->'votes'; end if;
  if jsonb_array_length(v_doc->'people') = 2 then
    raise notice 'OK 2 : ni son nom';
  else raise notice 'ÉCHEC 2 : %', v_doc->'people'; end if;

  -- 3. Paul décoche : la case décochée, plus récente, l'emporte.
  perform public.marque_points_put(v_id, v_doc || jsonb_build_object('votes','{"w2|o2":{"v":null,"at":40}}'::jsonb), null, null);
  v_doc := public.marque_points_get(v_id);
  if v_doc->'votes'->'w2|o2'->'v' = 'null'::jsonb and (v_doc->'votes') ? 'w1|o1' then
    raise notice 'OK 3 : décocher est une réponse comme une autre, et le reste tient';
  else raise notice 'ÉCHEC 3 : %', v_doc->'votes'; end if;

  -- 4. Une copie en retard (case plus ancienne) ne ramène pas un coché décoché.
  perform public.marque_points_put(v_id, v_doc || jsonb_build_object('votes','{"w2|o2":{"v":"yes","at":20}}'::jsonb), v_key, v_secret);
  v_doc := public.marque_points_get(v_id);
  if v_doc->'votes'->'w2|o2'->'v' = 'null'::jsonb then
    raise notice 'OK 4 : une copie en retard ne ressuscite pas une case décochée';
  else raise notice 'ÉCHEC 4 : %', v_doc->'votes'; end if;

  -- 5. L'organisateur retire Paul en connaissance de cause (peopleAt plus récent).
  perform public.marque_points_put(v_id, v_doc || jsonb_build_object(
    'people','[{"id":"w1","name":"Gui"}]'::jsonb,'peopleAt',50,'updatedAt',50), v_key, v_secret);
  v_doc := public.marque_points_get(v_id);
  if jsonb_array_length(v_doc->'people') = 1 then
    raise notice 'OK 5 : mais l''organisateur qui retire quelqu''un en le sachant est suivi';
  else raise notice 'ÉCHEC 5 : %', v_doc->'people'; end if;

  -- 6. Un sondage sans organisateur (d'avant) se fond pareil.
  perform public.marque_points_put('v_ancien_fusion', '{"kind":"poll","id":"v_ancien_fusion","people":[{"id":"a"},{"id":"b"}],"options":[],"votes":{"a|x":{"v":"yes","at":5}},"peopleAt":1,"updatedAt":5}'::jsonb, v_key);
  perform public.marque_points_put('v_ancien_fusion', '{"kind":"poll","id":"v_ancien_fusion","people":[{"id":"a"},{"id":"b"}],"options":[],"votes":{"b|x":{"v":"yes","at":6}},"peopleAt":1,"updatedAt":6}'::jsonb, null);
  if (public.marque_points_get('v_ancien_fusion')->'votes') ?& array['a|x','b|x'] then
    raise notice 'OK 6 : un sondage d''avant ne perd plus de votes non plus';
  else raise notice 'ÉCHEC 6'; end if;

  -- 7. Une liste, elle, s'écrit toujours d'un bloc (rien à fondre ici).
  perform public.marque_points_put('l_liste_00001', '{"kind":"list","id":"l_liste_00001","items":[1]}'::jsonb, v_key);
  perform public.marque_points_put('l_liste_00001', '{"kind":"list","id":"l_liste_00001","items":[2]}'::jsonb, null);
  if public.marque_points_get('l_liste_00001')->'items' = '[2]'::jsonb then
    raise notice 'OK 7 : les listes ne changent pas de régime';
  else raise notice 'ÉCHEC 7'; end if;
end $$;
