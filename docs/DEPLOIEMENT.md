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

-- Lire une partie, à condition d'en connaître l'identifiant exact.
create or replace function public.marque_points_get(p_id text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select data from public.marque_points_games where id = p_id;
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
    set data = excluded.data, updated_at = now();
end;
$$;

-- Supprimer une partie.
create or replace function public.marque_points_delete(p_id text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.marque_points_games where id = p_id;
$$;

grant execute on function public.marque_points_get(text) to anon, authenticated;
grant execute on function public.marque_points_put(text, jsonb) to anon, authenticated;
grant execute on function public.marque_points_delete(text) to anon, authenticated;
```

Attendu : **Success. No rows returned.**

Si un message rouge apparaît, c'est que le bloc n'a pas été collé en entier —
recollez-le depuis la première ligne `create table` jusqu'au dernier `grant`.

## Étape 2 bis — Les liens qui portent des parties

Cette étape ajoute les **lots** : un lien qui apporte plusieurs parties d'un
coup. Elle est facultative — sans elle, tout le reste de l'app fonctionne, seuls
les deux liens « avec parties » sont indisponibles et l'app le dit.

Deux secrets s'y ajoutent, et ils ne jouent pas le même rôle :

| | Qui l'a | Ce qu'il permet |
| --- | --- | --- |
| **La clé de partage** | vous seul, sur vos appareils | créer un lien avec des parties |
| **Un code à six chiffres** | la personne qui reçoit le lien | ouvrir ce lien-là |

La clé fait que **personne d'autre que vous ne peut partager des parties**, même
en récupérant la clé publique dans le code de la page. Le code, tiré au hasard à
chaque partage, fait qu'un lien transmis à quelqu'un d'autre ne vaut rien sans
lui : la base compte les codes faux et ferme le lot au dixième.

### 1. Le bloc SQL

**SQL Editor** → **New query**, collez **tout** ce bloc, puis **Run**.

```sql
-- ---------------------------------------------------------------------------
-- Les lots de parties : un lien qui apporte plusieurs parties d'un coup.
--
-- Deux secrets différents, pour deux rôles différents :
--   * la clé de partage, que vous seul détenez : sans elle, impossible de
--     créer un lot. C'est elle qui fait que vous êtes le seul à pouvoir
--     partager des parties.
--   * un code à six chiffres, tiré au hasard à chaque partage : c'est ce que
--     tape la personne qui reçoit le lien.
-- ---------------------------------------------------------------------------

alter table public.marque_points_games
  add column if not exists code_hash text,
  add column if not exists code_salt text,
  add column if not exists tries integer not null default 0;

-- La clé de partage. Une seule ligne, et seulement le condensé de la clé :
-- même en lisant cette table, on ne peut pas la reconstituer.
create table if not exists public.marque_points_owner (
  id boolean primary key default true check (id),
  key_hash text not null,
  key_salt text not null,
  created_at timestamptz not null default now()
);

alter table public.marque_points_owner enable row level security;

-- Tire une clé de partage, remplace celle qui existait, et l'affiche UNE fois.
-- Elle est retirée à tout le monde juste après (PostgreSQL accorde sinon
-- l'exécution à tous par défaut) : elle ne s'exécute donc que d'ici, depuis
-- l'éditeur SQL de votre projet, et jamais depuis l'app.
create or replace function public.marque_points_new_owner_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := replace(gen_random_uuid()::text, '-', '');
  v_salt text := md5(gen_random_uuid()::text);
begin
  insert into public.marque_points_owner (id, key_hash, key_salt)
  values (true, md5(v_key || v_salt), v_salt)
  on conflict (id) do update
    set key_hash = excluded.key_hash, key_salt = excluded.key_salt, created_at = now();
  return v_key;
end;
$$;

-- Cette clé est-elle la bonne ? L'app le demande pour dire à qui la saisit si
-- elle est reconnue. Une clé fait 122 bits : on ne la trouve pas en essayant.
create or replace function public.marque_points_is_owner(p_key text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.marque_points_owner
     where key_hash = md5(coalesce(p_key, '') || key_salt)
  );
$$;

-- Un lot protégé devient invisible à la lecture ordinaire : la seule porte est
-- marque_points_open_set, qui exige le code et compte les essais.
create or replace function public.marque_points_get(p_id text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select data from public.marque_points_games
   where id = p_id and code_hash is null;
$$;

-- Et l'écriture ordinaire ne peut pas écraser un lot.
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

-- La suppression ordinaire ne touche pas non plus aux lots : un lot ne
-- disparaît que par marque_points_forget_set, avec la clé de partage.
create or replace function public.marque_points_delete(p_id text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.marque_points_games
   where id = p_id and code_hash is null;
$$;

-- Créer un lot. Il faut la clé de partage, et un code à six chiffres qui ne
-- sera jamais stocké en clair.
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
begin
  if not public.marque_points_is_owner(p_key) then
    raise exception 'cle de partage invalide';
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

  insert into public.marque_points_games (id, data, updated_at, code_hash, code_salt, tries)
  values (p_id, p_data, now(), md5(p_code || v_salt), v_salt, 0);
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

-- Révoquer un lot : avec la clé de partage, donc vous seul. Le lien ne donne
-- plus rien à personne, même avec le bon code.
create or replace function public.marque_points_forget_set(p_id text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.marque_points_is_owner(p_key) then
    raise exception 'cle de partage invalide';
  end if;

  delete from public.marque_points_games
   where id = p_id and code_hash is not null;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Personne, sauf le propriétaire du projet depuis cet éditeur.
revoke all on function public.marque_points_new_owner_key() from public, anon, authenticated;

grant execute on function public.marque_points_is_owner(text) to anon, authenticated;
grant execute on function public.marque_points_put_set(text, jsonb, text, text) to anon, authenticated;
grant execute on function public.marque_points_open_set(text, text) to anon, authenticated;
grant execute on function public.marque_points_forget_set(text, text) to anon, authenticated;
```

Attendu : **Success. No rows returned.**

### 2. Tirer votre clé de partage

Effacez la zone de texte et lancez cette requête **une seule fois** :

```sql
select public.marque_points_new_owner_key();
```

Elle affiche une suite de 32 caractères, par exemple
`7c50632b32d14ea1974ca2a77503315d`. **Copiez-la maintenant** : elle ne sera plus
jamais affichée. La base n'en garde qu'une empreinte, pas la clé elle-même.

Relancer cette requête plus tard remplace la clé : les appareils qui avaient
l'ancienne ne peuvent plus créer de liens (les liens déjà créés continuent, eux,
de fonctionner). C'est le geste à faire si vous pensez que la clé a fuité.

### 3. La donner à l'app, une fois par appareil

Dans l'app : bas de l'accueil, section **Données** → **Clé de partage** → collez,
puis **Enregistrer la clé**. L'app répond *Clé reconnue* — c'est la base qui le
dit, pas l'app.

> ⚠️ Ne mettez **jamais** cette clé dans `src/config.js` ni ailleurs dans le
> dépôt : ce fichier est public, et la clé deviendrait publique avec lui. Elle se
> colle dans l'app, sur chaque appareil depuis lequel vous voulez partager des
> parties (Safari et l'app installée sur l'écran d'accueil comptent pour deux).

### 4. Vérifier

Toujours dans **SQL Editor**, une requête à la fois, en remplaçant
`VOTRE_CLE` par la clé copiée :

```sql
select public.marque_points_is_owner('VOTRE_CLE');
```

Attendu : **`true`**. Avec n'importe quoi d'autre à la place, **`false`**.

```sql
select public.marque_points_put_set('lot_de_test_1', '{"kind":"set","ids":["test"]}'::jsonb, '123456', 'VOTRE_CLE');
select public.marque_points_open_set('lot_de_test_1', '000000');
select public.marque_points_open_set('lot_de_test_1', '123456');
select public.marque_points_forget_set('lot_de_test_1', 'VOTRE_CLE');
```

Attendu, dans l'ordre : une cellule vide (la fonction ne renvoie rien),
`{"left": 9, "status": "wrong"}`, puis `{"status": "ok", "set": {…}}`, puis
`{"status": "ok"}`.

> Ce bloc et ces requêtes ont été exécutés tels quels sur un PostgreSQL 16 avec
> les mêmes rôles que chez Supabase. Sans la clé, la création d'un lot est
> refusée ; un lot n'est pas lisible par la fonction de lecture ordinaire, ni
> écrasable, ni supprimable par les fonctions ordinaires ; le dixième code faux
> le ferme définitivement ; et le rôle public ne peut pas tirer de nouvelle clé.

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
- **Un lot de parties** — le lien qui en apporte plusieurs d'un coup — ne se crée
  qu'avec la clé de partage, et ne s'ouvre qu'avec son code à six chiffres, dix
  essais au maximum. Il ne contient pas les parties, seulement la liste chiffrée
  de leurs identifiants : même en lisant la ligne dans la base, on ne sait pas
  quelles parties il désigne. Le chiffrement demande https (l'adresse de l'app en
  est une) ; sur une adresse en http, la liste est stockée en clair et l'app le
  dit.
- **Le code est à dire, pas à écrire dans le même message.** Un lien et son code
  envoyés ensemble ne protègent plus rien : le bouton *Copier* ne copie que le
  lien, exprès.
- **Révoquer un partage** se fait depuis *Mes partages*, dans la section
  **Données** : le lien ne donne plus rien à personne, même avec le bon code. Les
  parties elles-mêmes restent.
- **Une partie ouverte par un lot reste ouvrable par son propre lien** ensuite,
  comme toute partie partagée : le code protège le lot, pas chaque partie pour
  toujours.
- **Les dix essais peuvent être gâchés** par quelqu'un à qui le lien est parvenu
  sans le code : le lot se ferme, et il faut en refaire un. C'est le prix du
  plafond, et c'est le bon sens du compromis — mieux vaut un partage à refaire
  qu'un code à six chiffres essayé un million de fois.
- **Le bouton *Partager* d'une partie, lui, n'a pas changé** : il reste ouvert à
  qui utilise l'app, parce qu'une partie partagée doit pouvoir être tenue à
  plusieurs. Ce sont les liens qui portent *plusieurs* parties qui demandent la
  clé.
- **Deux personnes qui marquent la même partie en même temps** : les manches des
  deux sont conservées — chaque manche a son identifiant, et les deux copies sont
  fusionnées manche par manche. Seule une *même* manche corrigée des deux côtés
  au même moment garde la dernière version écrite.
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
