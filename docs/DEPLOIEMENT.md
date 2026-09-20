# Mettre l'app en ligne, avec parties partagées

À la fin : une adresse web que vous ouvrez depuis n'importe quel téléphone, et
un bouton *Partager* qui donne un lien ouvrant **la même partie** chez quelqu'un
d'autre, avec ses scores, en direct.

**Tout se fait au navigateur.** Pas de terminal, pas de Node.js, rien à
installer — ni sous Windows, ni ailleurs. Comptez une demi-heure.

Deux services, gratuits et sans carte bancaire : **Supabase** garde les parties,
**GitHub Pages** sert l'app.

> Les interfaces de Supabase et de GitHub changent de temps en temps. Si un
> bouton n'est pas là où c'est écrit, cherchez son intitulé : les noms bougent
> moins que les emplacements.

---

## Étape 0 — Fusionner la PR

L'app en ligne est publiée par un automatisme qui vit dans la branche `main`.
Tant que la PR n'est pas fusionnée, `main` contient une vieille version et
l'automatisme n'existe pas.

Sur GitHub, ouvrez la pull request ouverte sur le dépôt, puis
**Merge pull request** → **Confirm merge**.

## Étape 1 — Créer le projet Supabase

Vous êtes connecté à [supabase.com](https://supabase.com) et vous voyez soit une
liste de projets, soit un écran de bienvenue.

1. Cliquez **New project** (en haut à droite, ou au centre s'il n'y en a aucun).
2. Si une organisation vous est demandée, créez-la — n'importe quel nom, le
   vôtre fait l'affaire. C'est juste un dossier.
3. Remplissez :
   - **Name** : `marque-points`
   - **Database Password** : cliquez sur *Generate a password*. **Copiez-le dans
     un endroit sûr** — l'app ne s'en sert pas, mais Supabase ne vous le
     remontrera plus.
   - **Region** : la plus proche de vous (*Central EU (Frankfurt)* ou
     *West EU (Ireland)* depuis la France).
4. **Create new project**, puis patientez une à deux minutes : le projet se
   met en route.

## Étape 2 — Créer la table et les fonctions

1. Dans la colonne de gauche, cliquez **SQL Editor** (icône en forme de
   terminal). Puis **New query** si un éditeur vide ne s'ouvre pas tout seul.
2. Collez **tout** le bloc ci-dessous dans la grande zone de texte.
3. Cliquez **Run** en bas à droite (ou Ctrl + Entrée).

```sql
-- La table des parties. Personne n'y touche directement : elle est verrouillée,
-- et seules les trois fonctions ci-dessous sont accessibles depuis l'app.
create table if not exists public.marque_points_games (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.marque_points_games enable row level security;
-- Aucune règle d'accès n'est déclarée : la table est donc inatteignable
-- directement. C'est voulu.

-- Ces trois colonnes ne servent qu'aux lots de parties (étape 2 bis). Elles
-- sont créées ici, et les trois fonctions ci-dessous les respectent dès
-- maintenant, pour que relancer ce bloc plus tard ne puisse jamais défaire la
-- protection des lots. Sans l'étape 2 bis, elles restent vides et ne changent
-- rien.
alter table public.marque_points_games
  add column if not exists code_hash text,
  add column if not exists code_salt text,
  add column if not exists tries integer not null default 0;

-- Lire une partie, à condition d'en connaître l'identifiant exact. Un lot
-- protégé par un code n'est pas lisible ici : il a sa propre fonction.
create or replace function public.marque_points_get(p_id text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select data from public.marque_points_games
   where id = p_id and code_hash is null;
$$;

-- Écrire une partie, avec deux garde-fous : un identifiant de taille plausible
-- et une partie qui ne dépasse pas 200 Ko.
create or replace function public.marque_points_put(p_id text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id is null or length(p_id) < 8 or length(p_id) > 128 then
    raise exception 'identifiant invalide';
  end if;
  if pg_column_size(p_data) > 200000 then
    raise exception 'partie trop volumineuse';
  end if;

  insert into public.marque_points_games (id, data, updated_at)
  values (p_id, p_data, now())
  on conflict (id) do update
    set data = excluded.data, updated_at = now()
    where marque_points_games.code_hash is null;
end;
$$;

-- Supprimer une partie. Un lot ne s'efface pas ainsi : il se révoque.
create or replace function public.marque_points_delete(p_id text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.marque_points_games
   where id = p_id and code_hash is null;
$$;

grant execute on function public.marque_points_get(text) to anon, authenticated;
grant execute on function public.marque_points_put(text, jsonb) to anon, authenticated;
grant execute on function public.marque_points_delete(text) to anon, authenticated;
```

Attendu : **Success. No rows returned.**

Si un message rouge apparaît, c'est que le bloc n'a pas été collé en entier —
recollez-le depuis la première ligne `create table` jusqu'au dernier `grant`.

## Étape 2 bis — Les groupes

Cette étape ajoute les **groupes**, et avec eux tout le partage. Elle est
facultative : sans elle, l'app marche, mais chacun garde ses parties, ses listes
et ses sondages pour lui.

Un **groupe**, c'est un cercle de personnes — la famille, les copains du mardi —
et une **clé**. Qui a la clé :

- voit **tout ce qui est partagé dans le groupe**, parties, listes et sondages
  confondus, d'un seul bouton (*Tout récupérer*) ;
- peut **y partager** à son tour.

Et deux règles qui font le reste :

| | Faut-il une clé ? |
| --- | --- |
| **Commencer** à partager quelque chose | oui, celle d'un groupe |
| **Contribuer** à ce qui est déjà partagé — ajouter une manche, cocher une ligne, répondre | non |
| **Supprimer** quelque chose de partagé | oui, celle de son groupe |

C'est ce qui permet d'envoyer le lien d'une partie à quelqu'un d'extérieur : il
joue avec vous sans rien voir du reste, et sans pouvoir rien partager.

### 1. Le bloc SQL

**SQL Editor** → **New query**, collez **tout** ce bloc, puis **Run**.

```sql
-- ---------------------------------------------------------------------------
-- Les groupes, et les liens qui portent plusieurs choses à la fois.
--
-- Un groupe, c'est un cercle de personnes — la famille, les copains du mardi —
-- et une clé. Qui a la clé appartient au groupe : il voit tout ce qui y est
-- partagé, parties, listes et sondages confondus, et peut y partager à son
-- tour.
--
-- Deux règles, et elles suffisent :
--   * créer un partage demande la clé d'un groupe ;
--   * contribuer à un partage qui existe déjà n'en demande pas — c'est ce qui
--     permet d'envoyer un lien à quelqu'un d'extérieur au groupe et qu'il
--     puisse ajouter une manche ou cocher une ligne, sans rien voir du reste.
--
-- Un lot, en plus, se ferme d'un code à six chiffres : dix essais, puis il se
-- bloque. C'est la façon de faire entrer quelqu'un d'un coup pour une soirée,
-- sans lui donner la clé du groupe.
--
-- Ce bloc se relance sans dommage, autant de fois qu'on veut.
-- ---------------------------------------------------------------------------

-- La version d'avant n'avait qu'une clé, sans groupe : elle s'efface ici.
drop function if exists public.marque_points_new_owner_key();
drop function if exists public.marque_points_new_owner_key(text);
drop function if exists public.marque_points_is_owner(text);
drop function if exists public.marque_points_is_owner(text, text);
drop table if exists public.marque_points_owner;

create table if not exists public.marque_points_group (
  id text primary key,
  name text not null,
  key_hash text not null,
  key_salt text not null,
  created_at timestamptz not null default now()
);

alter table public.marque_points_group enable row level security;

-- Chaque document partagé appartient au groupe qui l'a créé.
alter table public.marque_points_games
  add column if not exists group_id text;

create index if not exists marque_points_games_group on public.marque_points_games (group_id);

-- Crée un groupe et affiche sa clé UNE fois. Ne s'exécute que d'ici, depuis
-- l'éditeur SQL du projet : PostgreSQL accorde sinon l'exécution à tous.
create or replace function public.marque_points_new_group(p_name text)
returns table (nom text, cle text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := replace(gen_random_uuid()::text, '-', '');
  v_salt text := md5(gen_random_uuid()::text);
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_name is null then
    raise exception 'donnez un nom au groupe';
  end if;

  insert into public.marque_points_group (id, name, key_hash, key_salt)
  values (replace(gen_random_uuid()::text, '-', ''), v_name, md5(v_key || v_salt), v_salt);

  return query select v_name, v_key;
end;
$$;

-- Renouvelle la clé d'un groupe : les appareils qui avaient l'ancienne en
-- sortent, ce qui y est partagé reste.
create or replace function public.marque_points_new_group_key(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := replace(gen_random_uuid()::text, '-', '');
  v_salt text := md5(gen_random_uuid()::text);
  v_id text;
begin
  select id into v_id from public.marque_points_group where name = btrim(coalesce(p_name, ''));
  if v_id is null then
    raise exception 'aucun groupe de ce nom';
  end if;

  update public.marque_points_group
     set key_hash = md5(v_key || v_salt), key_salt = v_salt, created_at = now()
   where id = v_id;
  return v_key;
end;
$$;

-- Le groupe qu'ouvre cette clé, ou rien. C'est ce que l'app demande quand on
-- colle une clé : elle en affiche le nom, plutôt qu'un simple « acceptée ».
create or replace function public.marque_points_group_of(p_key text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('id', id, 'name', name)
    from public.marque_points_group
   where key_hash = md5(coalesce(p_key, '') || key_salt)
   limit 1;
$$;

-- Tout ce qui est partagé dans ce groupe : de quoi rattraper un appareil qui
-- vient d'entrer, ou qui a été absent.
create or replace function public.marque_points_group_docs(p_key text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'updatedAt', g.data->'updatedAt')), '[]'::jsonb)
    from public.marque_points_games g
    join public.marque_points_group p on p.id = g.group_id
   where p.key_hash = md5(coalesce(p_key, '') || p.key_salt)
     and g.code_hash is null;
$$;

drop function if exists public.marque_points_put(text, jsonb);
drop function if exists public.marque_points_delete(text);

create or replace function public.marque_points_put(p_id text, p_data jsonb, p_key text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_group text;
begin
  if p_id is null or length(p_id) < 8 or length(p_id) > 128 then
    raise exception 'identifiant invalide';
  end if;
  if pg_column_size(p_data) > 200000 then
    raise exception 'donnee trop volumineuse';
  end if;

  select true into v_exists
    from public.marque_points_games
   where id = p_id and code_hash is null;

  if v_exists is null then
    -- Rien sous cet identifiant : c'est un partage qui commence, donc il faut
    -- dire dans quel groupe.
    select id into v_group from public.marque_points_group
     where key_hash = md5(coalesce(p_key, '') || key_salt);
    if v_group is null then
      raise exception 'cle de groupe invalide';
    end if;

    insert into public.marque_points_games (id, data, updated_at, group_id)
    values (p_id, p_data, now(), v_group);
  else
    -- La ligne existe : qui a le lien peut y contribuer.
    update public.marque_points_games
       set data = p_data, updated_at = now()
     where id = p_id and code_hash is null;
  end if;
end;
$$;

-- Supprimer ce qui est partagé demande la clé du groupe : sinon, quiconque a
-- reçu un lien pourrait effacer la partie de tout le monde.
create or replace function public.marque_points_delete(p_id text, p_key text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group text;
begin
  select group_id into v_group from public.marque_points_games
   where id = p_id and code_hash is null;
  if not found then
    return; -- rien à supprimer, rien à refuser
  end if;

  if v_group is null or v_group is distinct from (
    select id from public.marque_points_group
     where key_hash = md5(coalesce(p_key, '') || key_salt)
  ) then
    raise exception 'cle de groupe invalide';
  end if;

  delete from public.marque_points_games where id = p_id and code_hash is null;
end;
$$;

-- Un lot : la clé d'un groupe suffit, et il se range dans ce groupe.
create or replace function public.marque_points_put_set(
  p_id text, p_data jsonb, p_code text, p_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salt text := md5(gen_random_uuid()::text);
  v_group text;
begin
  select id into v_group from public.marque_points_group
   where key_hash = md5(coalesce(p_key, '') || key_salt);
  if v_group is null then
    raise exception 'cle de groupe invalide';
  end if;
  if p_id is null or length(p_id) < 8 or length(p_id) > 128 then
    raise exception 'identifiant invalide';
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    raise exception 'code invalide';
  end if;
  if pg_column_size(p_data) > 200000 then
    raise exception 'lot trop volumineux';
  end if;

  insert into public.marque_points_games (id, data, updated_at, code_hash, code_salt, tries, group_id)
  values (p_id, p_data, now(), md5(p_code || v_salt), v_salt, 0, v_group);
end;
$$;

create or replace function public.marque_points_forget_set(p_id text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.marque_points_group
     where key_hash = md5(coalesce(p_key, '') || key_salt)
  ) then
    raise exception 'cle de groupe invalide';
  end if;

  delete from public.marque_points_games
   where id = p_id and code_hash is not null;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Ouvrir un lot : dix essais en tout, et le compteur repart à zéro dès qu'un
-- code juste est donné. C'est ce plafond qui rend six chiffres suffisants.
create or replace function public.marque_points_open_set(p_id text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.marque_points_games;
begin
  select * into v_row from public.marque_points_games
   where id = p_id and code_hash is not null;

  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_row.tries >= 10 then
    return jsonb_build_object('status', 'locked');
  end if;
  if v_row.code_hash <> md5(coalesce(p_code, '') || v_row.code_salt) then
    update public.marque_points_games set tries = tries + 1 where id = p_id;
    return jsonb_build_object('status', 'wrong', 'left', 9 - v_row.tries);
  end if;

  update public.marque_points_games set tries = 0 where id = p_id;
  return jsonb_build_object('status', 'ok', 'set', v_row.data);
end;
$$;

-- Les clés se tirent depuis cet éditeur, et de nulle part ailleurs.
revoke all on function public.marque_points_new_group(text) from public, anon, authenticated;
revoke all on function public.marque_points_new_group_key(text) from public, anon, authenticated;

grant execute on function public.marque_points_open_set(text, text) to anon, authenticated;
grant execute on function public.marque_points_group_of(text) to anon, authenticated;
grant execute on function public.marque_points_group_docs(text) to anon, authenticated;
grant execute on function public.marque_points_put(text, jsonb, text) to anon, authenticated;
grant execute on function public.marque_points_delete(text, text) to anon, authenticated;
grant execute on function public.marque_points_put_set(text, jsonb, text, text) to anon, authenticated;
grant execute on function public.marque_points_forget_set(text, text) to anon, authenticated;
```

Attendu : **Success. No rows returned.**

> Si vous aviez passé la version précédente de cette étape — celle avec une clé
> unique, sans groupe —, ce bloc l'efface proprement : la clé d'avant ne servira
> plus, et les appareils devront recevoir une clé de groupe. Ce qui était déjà
> partagé reste.

### 2. Créer votre premier groupe

Effacez la zone de texte et lancez :

```sql
select * from public.marque_points_new_group('Famille');
```

Elle affiche deux colonnes : le **nom** et la **clé**, une suite de 32
caractères. **Copiez la clé maintenant** : elle ne sera plus jamais affichée. La
base n'en garde qu'une empreinte.

Recommencez avec un autre nom pour un autre cercle — `'Copains du mardi'`, par
exemple. Un appareil peut appartenir à plusieurs groupes ; l'app demande alors
dans lequel partager.

### 3. Donner la clé à l'app, une fois par appareil

Dans l'app : onglet **Aperçu** → section **Mes groupes** → collez la clé →
**Entrer**. L'app répond *Vous êtes dans Famille* — c'est la base qui le dit.

Faites-le sur chaque appareil du groupe : le vôtre, celui de la personne avec
qui vous partagez, Safari et l'app de l'écran d'accueil (qui comptent pour deux).
Puis **Tout récupérer** ramène d'un coup ce que le groupe partage déjà.

> ⚠️ Ne mettez **jamais** une clé de groupe dans `src/config.js` ni ailleurs dans
> le dépôt : ce fichier est public, et la clé le deviendrait avec lui.

### 4. Si une clé fuite

```sql
select public.marque_points_new_group_key('Famille');
```

Elle en tire une nouvelle : les appareils qui avaient l'ancienne sortent du
groupe, ce qui y est partagé reste, et il suffit de recoller la nouvelle clé là
où il faut.

### 5. Vérifier

Une requête à la fois, en remplaçant `VOTRE_CLE` par la clé copiée :

```sql
select public.marque_points_group_of('VOTRE_CLE');
```

Attendu : `{"id": "...", "name": "Famille"}`. Avec n'importe quoi d'autre à la
place : une cellule vide.

```sql
select public.marque_points_put('g_de_test_1', '{"id":"g_de_test_1"}'::jsonb);
select public.marque_points_put('g_de_test_1', '{"id":"g_de_test_1"}'::jsonb, 'VOTRE_CLE');
select public.marque_points_put('g_de_test_1', '{"id":"g_de_test_1","ok":true}'::jsonb);
select jsonb_array_length(public.marque_points_group_docs('VOTRE_CLE'));
select public.marque_points_delete('g_de_test_1', 'VOTRE_CLE');
```

Attendu, dans l'ordre : une **erreur rouge** `cle de groupe invalide` — c'est le
but ; une cellule vide ; une cellule vide encore (contribuer ne demande rien) ;
**1** ; et une cellule vide.

> Ce bloc et ces requêtes ont été exécutés tels quels sur un PostgreSQL 16 avec
> les rôles de Supabase : sans clé rien ne se crée, une clé n'ouvre que son
> groupe, un groupe ne voit pas les documents du groupe d'à côté, renouveler une
> clé fait sortir l'ancienne sans rien perdre, et le rôle public ne peut ni créer
> de groupe ni lire aucune table.

## Étape 3 — Vérifier, sans quitter la page

Toujours dans **SQL Editor**, effacez ce que vous venez de coller et lancez ces
quatre requêtes **une par une** — l'éditeur n'affiche que le résultat de la
dernière, donc tout coller d'un bloc ne montrerait rien d'utile.

**1. Écrire une partie de test**

```sql
select public.marque_points_put('test_marque_points', '{"id":"test_marque_points","ok":true}'::jsonb);
```

Résultat attendu : **`NULL`, ou une cellule vide** — les deux veulent dire la
même chose. C'est normal : cette fonction ne renvoie rien (`returns void`), et
l'éditeur l'affiche tantôt `NULL`, tantôt comme une case vide, pour dire
« exécutée, rien à signaler ». Une fonction absente donnerait une erreur rouge,
jamais une case vide.

**2. La relire** — la seule requête qui compte vraiment

```sql
select public.marque_points_get('test_marque_points');
```

Résultat attendu :

```
{"id": "test_marque_points", "ok": true}
```

Les espaces après les deux-points sont normaux : Postgres réécrit le JSON à sa
façon. **Si vous voyez ça, votre base est prête.** Si vous voyez `NULL`,
l'écriture n'a pas fonctionné : reprenez l'étape 2.

**3. La supprimer**

```sql
select public.marque_points_delete('test_marque_points');
```

Résultat attendu : **`NULL` ou une cellule vide**, pour la même raison qu'à la
première requête.

**4. Vérifier qu'elle a disparu**

```sql
select public.marque_points_get('test_marque_points');
```

Résultat attendu : **`NULL`** — et cette fois, ce `NULL` est la preuve que la
suppression a fonctionné.

En résumé :

| Requête | Attendu | Ce que ça veut dire |
| --- | --- | --- |
| `put` | `NULL` ou case vide | la fonction ne renvoie rien, c'est normal |
| `get` après écriture | le JSON | **tout fonctionne** |
| `delete` | `NULL` ou case vide | la fonction ne renvoie rien, c'est normal |
| `get` après suppression | `NULL` ou case vide | la partie a bien été effacée |

> Ce bloc SQL et ces requêtes ont été exécutés tels quels sur un PostgreSQL 16,
> avec les mêmes rôles que chez Supabase. La table s'est révélée inaccessible en
> lecture comme en écriture pour le rôle public, les deux garde-fous se sont
> déclenchés, et seules les fonctions ont fonctionné.

## Étape 4 — Copier les deux valeurs

Dans la colonne de gauche, tout en bas : **Project Settings** (roue dentée) →
**API** (ou **API Keys** selon la version).

- **Project URL** — ressemble à `https://abcdefgh.supabase.co`
- **anon public** — une très longue chaîne commençant par `eyJ`

Si la page vous montre plutôt l'adresse du point d'entrée REST,
`https://abcdefgh.supabase.co/rest/v1`, ce n'est pas grave : l'app accepte les
deux formes, avec ou sans barre oblique finale.

Gardez les deux sous la main (Bloc-notes, par exemple).

⚠️ Ne copiez **jamais** la clé `service_role`, juste en dessous : celle-là donne
tous les droits sur votre base. La clé `anon` est faite pour être publique et se
retrouvera dans le code de la page — c'est normal, et ce n'est pas elle qui
protège vos parties (voir la fin de ce document).

## Étape 5 — Brancher l'app, depuis GitHub

Pas besoin de récupérer le projet sur votre ordinateur : GitHub sait modifier un
fichier directement dans le navigateur.

1. Sur GitHub, ouvrez le dépôt, puis le fichier **`src/config.js`**.
2. Cliquez sur le **crayon** (*Edit this file*), en haut à droite du fichier.
3. Remplacez les deux lignes vides par vos valeurs :

```js
export const REMOTE = {
  url: 'https://abcdefgh.supabase.co',
  key: 'eyJ…',
};
```

Gardez bien les guillemets et les virgules.

4. **Commit changes…** → **Commit changes**, en laissant la branche `main`
   sélectionnée.

## Étape 6 — Publier l'app

GitHub Pages demande un dépôt **public** dans l'offre gratuite.

1. **Settings** → **General** → tout en bas, *Danger Zone* → **Change
   visibility** → *Make public*, et confirmez en tapant le nom du dépôt.
   (Le code n'a rien de secret : la clé `anon` est publique par nature, et
   aucune partie n'est stockée dans le dépôt.)
2. **Settings** → **Pages** → sous **Source**, choisissez **GitHub Actions**.
3. Onglet **Actions** : une exécution démarre toute seule. Deux minutes environ.
   Quand elle est verte, l'adresse s'affiche — quelque chose comme
   `https://votre-compte.github.io/Code/`.

**Si vous voulez garder le dépôt privé**, utilisez
[Cloudflare Pages](https://pages.cloudflare.com) à la place : créez un compte,
*Connect to Git*, choisissez le dépôt, laissez la commande de build vide et
indiquez `/` comme dossier à publier. Cela se fait aussi entièrement au
navigateur.

## Étape 7 — Sur le téléphone

Ouvrez l'adresse dans Safari (ou Chrome), puis **Partager → Sur l'écran
d'accueil** : vous avez l'app comme une application.

Vérifiez d'un coup d'œil que tout est branché : sur l'accueil, la ligne sous
**Données** doit dire que les parties sont enregistrées *dans ce navigateur et
dans la base partagée*. Si elle parle seulement du navigateur, l'étape 5 n'a pas
pris — vérifiez `src/config.js` sur GitHub, et que l'exécution dans *Actions*
est bien verte.

Dans une partie, le bouton **Partager** donne le lien à envoyer aux autres
joueurs. Ils ouvrent la partie telle quelle et peuvent y ajouter des manches ;
chaque écran se rafraîchit seul toutes les cinq secondes.

---

## Ce que ce montage implique

- **Rien ne part tout seul.** Une partie reste sur l'appareil qui l'a créée
  jusqu'à ce que quelqu'un appuie sur *Partager* — y compris chez les personnes
  à qui vous donnez l'adresse de l'app. Si vous hébergez la base, cochez
  *Envoyer mes nouvelles parties dans la base partagée* dans la section
  **Données** : vos appareils à vous enverront tout d'emblée, les autres non.
- **Qui a le lien a tous les droits** sur cette partie : la lire, y ajouter des
  manches, la supprimer. Il n'y a ni compte ni mot de passe — le lien *est* la
  clé, comme un document partagé « par lien ».
- **Une partie ne se trouve pas par hasard.** Son identifiant est un nombre
  aléatoire de 122 bits, et la table n'est pas listable, même avec la clé
  publique.
- **La clé publique permet d'écrire.** Quelqu'un qui la récupère dans le code de
  la page pourrait écrire de fausses parties dans la base. Il ne verrait pas les
  vôtres pour autant. Les garde-fous du script SQL limitent la casse ; le cas
  échéant, régénérez la clé depuis Supabase et refaites l'étape 5.
- **Un groupe est une clé.** Qui l'a peut partager dans ce groupe et voir tout
  ce qui y est partagé ; qui ne l'a pas ne peut rien y créer. La clé se colle sur
  chaque appareil, et se renouvelle en une requête si elle fuite.
- **Contribuer ne demande rien.** Un lien envoyé à quelqu'un d'extérieur lui
  permet d'ajouter une manche, de cocher une ligne, de répondre à un sondage —
  et rien d'autre : il ne voit pas le reste du groupe et ne peut rien partager.
- **Un lot de parties** — le lien qui en apporte plusieurs d'un coup — se crée
  avec la clé d'un groupe et s'ouvre avec son code à six chiffres, dix essais au
  maximum. Il ne contient pas les documents, seulement la liste chiffrée de leurs
  identifiants : même en lisant la ligne dans la base, on ne sait pas ce qu'il
  désigne. Le chiffrement demande https (l'adresse de l'app en est une) ; sur une
  adresse en http, la liste est stockée en clair et l'app le dit.
- **Le code est à dire, pas à écrire dans le même message.** Un lien et son code
  envoyés ensemble ne protègent plus rien : le bouton *Copier* ne copie que le
  lien, exprès.
- **Révoquer un partage** se fait depuis *Mes partages*, dans l'onglet Aperçu :
  le lien ne donne plus rien à personne, même avec le bon code.
- **Une partie ouverte par un lot reste ouvrable par son propre lien** ensuite :
  le code protège le lot, pas chaque partie pour toujours.
- **Les dix essais peuvent être gâchés** par quelqu'un à qui le lien est parvenu
  sans le code : le lot se ferme, et il faut en refaire un.
- **Sans configuration, rien ne change** : `src/config.js` laissé vide, l'app
  garde tout dans le navigateur et n'envoie rien nulle part. Le fichier autonome
  `dist/marque-points.html` reste utilisable hors ligne dans tous les cas.
- **Limites de l'offre gratuite Supabase** : 500 Mo de base, et une mise en
  veille du projet après une semaine sans activité — il se réveille tout seul à
  la requête suivante, avec quelques secondes de retard. Une partie pèse
  quelques kilo-octets : vous n'atteindrez jamais la limite.

## Annexe — vérifier depuis un terminal

Facultatif, et réservé à qui a déjà le projet et Node.js :

```bash
node tools/check-remote.js https://abcdefgh.supabase.co eyJ…
```

Sous **Windows**, dans PowerShell, `curl` n'est pas le vrai curl mais un alias :
écrivez `curl.exe`, ou utilisez la commande native :

```powershell
$url = "https://abcdefgh.supabase.co"
$key = "eyJ…"
$headers = @{ apikey = $key; Authorization = "Bearer $key" }
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/rpc/marque_points_get" `
  -Headers $headers -ContentType "application/json" `
  -Body '{"p_id":"test_marque_points"}'
```

La vérification de l'étape 3, faite dans l'éditeur SQL de Supabase, couvre
l'essentiel : ces commandes ne servent qu'à tester en plus le chemin réseau et
la clé.
