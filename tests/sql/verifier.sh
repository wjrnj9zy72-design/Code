#!/usr/bin/env bash
# Le SQL du guide contre un vrai PostgreSQL : chaque contrôle de tests/sql/ dans
# une base neuve, montée avec les étapes 2 et 2 bis de docs/DEPLOIEMENT.md.
#
#   tests/sql/verifier.sh                   base neuve, telle que le guide la crée
#   tests/sql/verifier.sh --depuis <commit> base créée avec le guide de ce commit,
#                                           puis supabase/mise-a-jour.sql passé
#                                           deux fois : la mise à jour d'une base
#                                           existante, et qu'on peut la repasser
#
# Il faut PostgreSQL (initdb, pg_ctl, psql) : sinon, `apt-get install -y postgresql`.
# Un serveur jetable est lancé dans un dossier temporaire, puis arrêté.
set -u
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
DEPUIS=""
[ "${1:-}" = "--depuis" ] && DEPUIS="${2:?un commit après --depuis}"

BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -x "$BIN/initdb" ] || { echo "PostgreSQL introuvable : apt-get install -y postgresql"; exit 1; }
TMP="$(mktemp -d)"; chmod 777 "$TMP"
PG="su postgres -c"
$PG "$BIN/initdb -D $TMP/data -A trust -U postgres" > /dev/null || exit 1
$PG "$BIN/pg_ctl -D $TMP/data -o '-k $TMP -p 54329 -c listen_addresses=' -l $TMP/pg.log -w start" > /dev/null || exit 1
trap '$PG "$BIN/pg_ctl -D $TMP/data -m immediate stop" > /dev/null 2>&1; rm -rf "$TMP"' EXIT
psql_() { $PG "psql -h $TMP -p 54329 -v ON_ERROR_STOP=1 -q $*"; }

# Supabase fournit ces rôles et pgcrypto ; un PostgreSQL nu, non.
cat > "$TMP/socle.sql" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
create extension if not exists pgcrypto;
SQL

GUIDE="$RACINE/docs/DEPLOIEMENT.md"
if [ -n "$DEPUIS" ]; then git -C "$RACINE" show "$DEPUIS:docs/DEPLOIEMENT.md" > "$TMP/guide.md" || exit 1; GUIDE="$TMP/guide.md"; fi
awk '/^```sql/{n++; dedans=1; next} /^```/{dedans=0} dedans && n==1' "$GUIDE" > "$TMP/etape2.sql"
awk '/^```sql/{n++; dedans=1; next} /^```/{dedans=0} dedans && n==2' "$GUIDE" > "$TMP/etape2bis.sql"
chmod 644 "$TMP"/*.sql; cp "$ICI"/*.sql "$RACINE/supabase/mise-a-jour.sql" "$TMP/" 2>/dev/null; chmod 644 "$TMP"/*.sql

ECHECS=0
for controle in "$ICI"/*.sql; do
  nom="$(basename "$controle" .sql)"
  psql_ "-d postgres -c 'create database essai_$nom'" || exit 1
  for f in socle etape2 etape2bis; do
    sortie="$(psql_ "-d essai_$nom -f $TMP/$f.sql" 2>&1)" || { echo "Le schéma ne passe pas ($f) :"; echo "$sortie" | grep -v NOTICE | tail -5; exit 1; }
  done
  if [ -n "$DEPUIS" ]; then
    for fois in 1 2; do
      sortie="$(psql_ "-d essai_$nom -f $TMP/mise-a-jour.sql" 2>&1)" || { echo "La mise à jour échoue (passage $fois) :"; echo "$sortie" | grep -v NOTICE | tail -5; exit 1; }
    done
  fi
  sortie="$(psql_ "-d essai_$nom -f $TMP/$nom.sql" 2>&1)"
  if [ $? -eq 0 ]; then
    echo "$nom : $(echo "$sortie" | grep -c 'OK [0-9]') contrôle(s) OK"
  else
    ECHECS=$((ECHECS + 1)); echo "$nom : ÉCHEC"; echo "$sortie" | grep -E 'ÉCHEC|ERROR' | head -3
  fi
done
[ "$ECHECS" -eq 0 ] && echo "Tout passe." || echo "$ECHECS contrôle(s) en échec."
exit "$ECHECS"
