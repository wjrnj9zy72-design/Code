# Mettre l'app en ligne, avec parties partagées

À la fin : une adresse web que vous ouvrez depuis n'importe quel téléphone, et
un bouton *Partager* qui donne un lien ouvrant **la même partie** chez quelqu'un
d'autre, avec ses scores, en direct.

Deux services, tous deux gratuits et sans carte bancaire : **Supabase** garde
les parties, **GitHub Pages** sert l'app. Comptez vingt minutes la première
fois.

---

## 1. Créer la base de données

1. Allez sur [supabase.com](https://supabase.com), créez un compte, puis un
   projet (n'importe quel nom ; choisissez la région la plus proche de vous).
   Notez le mot de passe de base de données qu'il vous demande, même si l'app
   n'en a pas besoin.
2. Le projet met une minute ou deux à démarrer.
3. Ouvrez **SQL Editor** dans le menu de gauche, collez tout le bloc ci-dessous,
   et cliquez sur **Run**.

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

Vous devez voir « Success. No rows returned ».

## 2. Récupérer les deux valeurs

Dans **Project Settings → API** (ou **API Keys** selon la version) :

- **Project URL** — quelque chose comme `https://abcdefgh.supabase.co`
- **anon public** — une longue chaîne commençant par `eyJ…`

La clé `anon` est **faite pour être publique** : elle se retrouvera dans le code
de la page, lisible par tout le monde. Ce n'est pas une fuite, c'est son rôle.
Ce qui protège vos parties, c'est que la table est verrouillée et qu'une partie
ne se lit qu'avec son identifiant exact, qui est un numéro aléatoire.
Ne copiez **jamais** la clé `service_role` : celle-là donne tous les droits.

## 3. Vérifier avant de publier

Sur votre ordinateur, dans le dossier du projet :

```bash
node tools/check-remote.js https://abcdefgh.supabase.co eyJ…
```

Il écrit une partie de test, la relit, la supprime, et vous dit ce qui cloche le
cas échéant. Ne passez à la suite que si les cinq lignes sont au vert.

## 4. Brancher l'app

Ouvrez `src/config.js` et collez vos deux valeurs :

```js
export const REMOTE = {
  url: 'https://abcdefgh.supabase.co',
  key: 'eyJ…',
};
```

Puis enregistrez et envoyez :

```bash
npm run bundle          # reconstruit le fichier autonome avec la configuration
git add -A && git commit -m "Brancher la base partagée" && git push
```

## 5. Publier l'app

1. Sur GitHub, ouvrez **Settings → Pages**.
2. Dans **Source**, choisissez **GitHub Actions**.
3. C'est tout : le fichier `.github/workflows/pages.yml` fait le reste à chaque
   envoi sur `main`. Il lance les tests d'abord — une version cassée ne part pas
   en ligne.
4. L'onglet **Actions** montre la progression. À la fin, l'adresse ressemble à
   `https://<votre-compte>.github.io/Code/`.

**Dépôt privé** : GitHub Pages demande un dépôt public dans l'offre gratuite.
Si vous préférez garder le dépôt privé, publiez plutôt sur
[Cloudflare Pages](https://pages.cloudflare.com) ou [Netlify](https://netlify.com),
qui acceptent les dépôts privés gratuitement ; le dossier à publier est celui
que le workflow appelle `site`.

## 6. Sur le téléphone

Ouvrez l'adresse dans Safari, puis **Partager → Sur l'écran d'accueil**. Dans
une partie, le bouton **Partager** donne le lien à envoyer aux autres joueurs :
ils ouvrent la partie telle quelle, et peuvent y ajouter des manches. Chaque
appareil se rafraîchit tout seul toutes les cinq secondes tant que la partie est
à l'écran.

---

## Ce que ce montage implique

- **Qui a le lien a tous les droits** sur cette partie : la lire, y ajouter des
  manches, la supprimer. Il n'y a pas de comptes ni de mots de passe — le lien
  *est* la clé. C'est le même principe qu'un document partagé « par lien ».
- **Une partie ne se trouve pas par hasard.** Son identifiant est un nombre
  aléatoire de 122 bits ; la table n'est pas listable, même avec la clé publique.
- **La clé publique permet d'écrire.** Quelqu'un qui la récupère dans le code de
  la page pourrait écrire de fausses parties dans la base. Il ne verrait pas les
  vôtres pour autant. Les garde-fous du script SQL limitent la casse ; si cela
  arrivait, régénérez la clé depuis Supabase et remettez-la dans `config.js`.
- **Deux personnes qui saisissent la même manche en même temps** : la dernière
  écriture gagne, et l'autre saisie est perdue. Pour une table où une seule
  personne marque, le cas ne se présente pas.
- **Sans configuration, rien ne change** : `src/config.js` vide, l'app garde
  tout dans le navigateur et n'envoie rien nulle part. Le fichier autonome
  `dist/marque-points.html` reste utilisable hors ligne dans tous les cas.
- **Limites de l'offre gratuite Supabase** : 500 Mo de base et une mise en
  veille du projet après une semaine sans activité (il se réveille tout seul à
  la requête suivante, avec quelques secondes de retard). Une partie pèse
  quelques kilo-octets : vous n'atteindrez jamais la limite.
