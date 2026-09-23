\pset tuples_only on
-- Ce qui est supprimé ne revient pas, et un sondage clos ne prend plus de votes.
do $$
declare
  v_mifa text; v_voisins text; v_secret text := 'secret-orga-0123456789abcdef'; v_err text;
begin
  select cle into v_mifa from public.marque_points_new_group('Mifa');
  select cle into v_voisins from public.marque_points_new_group('Voisins');
  perform public.marque_points_put('v_supprime_001', '{"kind":"poll","id":"v_supprime_001","question":"Secret","owned":true,"people":[],"options":[],"votes":{}}'::jsonb, v_mifa, v_secret);
  perform public.marque_points_delete('v_supprime_001', v_mifa, v_secret);

  -- 1. Paul (Voisins), qui l'avait encore à l'écran, coche : refusé
  begin
    perform public.marque_points_put('v_supprime_001', '{"kind":"poll","id":"v_supprime_001","votes":{"x|y":{"v":"yes","at":9}}}'::jsonb, v_voisins, null);
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'document supprime' then raise exception 'ÉCHEC 1 : recréé dans un autre groupe (%)', v_err; end if;
  raise notice 'OK 1 : un supprimé ne se recrée pas dans un autre groupe';

  -- 2. ni dans le sien
  begin
    perform public.marque_points_put('v_supprime_001', '{"kind":"poll","id":"v_supprime_001"}'::jsonb, v_mifa, null);
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'document supprime' then raise exception 'ÉCHEC 2 : recréé dans son groupe (%)', v_err; end if;
  if public.marque_points_get('v_supprime_001') is not null then raise exception 'ÉCHEC 2 : il est revenu'; end if;
  if public.marque_points_group_docs(v_voisins) <> '[]'::jsonb then raise exception 'ÉCHEC 2 : listé chez Voisins'; end if;
  raise notice 'OK 2 : ni dans le sien, et personne ne le liste';

  -- 3. supprimer deux fois ne casse rien
  perform public.marque_points_delete('v_supprime_001', v_mifa, v_secret);
  raise notice 'OK 3 : supprimer deux fois ne casse rien';

  -- 4. sondage clos : un visiteur ne vote plus, l'organisateur rouvre
  perform public.marque_points_put('v_clos_00001', '{"kind":"poll","id":"v_clos_00001","owned":true,"closedAt":1000,"people":[{"id":"p1","name":"Gui"}],"votes":{}}'::jsonb, v_mifa, v_secret);
  perform public.marque_points_put('v_clos_00001', '{"kind":"poll","id":"v_clos_00001","closedAt":null,"people":[{"id":"p1","name":"Gui"},{"id":"p2","name":"Zoé"}],"votes":{"o|p2":{"v":"yes","at":9}}}'::jsonb, null, null);
  if public.marque_points_get('v_clos_00001')->'votes' <> '{}'::jsonb
     or public.marque_points_get('v_clos_00001')->>'closedAt' is null
     or jsonb_array_length(public.marque_points_get('v_clos_00001')->'people') <> 1 then
    raise exception 'ÉCHEC 4 : un visiteur a écrit dans un sondage clos : %', public.marque_points_get('v_clos_00001');
  end if;
  perform public.marque_points_put('v_clos_00001', '{"kind":"poll","id":"v_clos_00001","owned":true,"closedAt":null,"people":[{"id":"p1","name":"Gui"}],"votes":{}}'::jsonb, null, v_secret);
  if public.marque_points_get('v_clos_00001')->>'closedAt' is not null then raise exception 'ÉCHEC 4 : l''organisateur ne rouvre pas'; end if;
  raise notice 'OK 4 : un sondage clos ne prend plus de votes, et l''organisateur le rouvre';
end $$;
