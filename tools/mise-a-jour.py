"""
Génère supabase/mise-a-jour.sql à partir du guide (docs/DEPLOIEMENT.md, étape 2 bis).

    python3 tools/mise-a-jour.py            écrit le fichier
    python3 tools/mise-a-jour.py --coller   l'écrit, et affiche la version à coller

Le fichier ne porte que ce qu'une base déjà en place doit recevoir : à chaque
changement du SQL du guide qui demande une mise à jour, ajoutez ici la fonction,
la table ou la colonne concernée, relancez, et tests/migration.test.js vérifie
que les deux disent la même chose.

Pour la donner à coller dans Supabase : voir CLAUDE.md (le SQL se donne dans la
conversation, en un seul bloc, sans commentaires).
"""
from pathlib import Path
import re
root = Path(__file__).resolve().parent.parent
guide = (root / 'docs/DEPLOIEMENT.md').read_text()
bis = re.findall(r'^```sql\n(.*?)^```', guide, flags=re.S | re.M)[1]
def function(name):
    m = re.search(r'(create or replace function public\.' + name + r'\(.*?\n\$\$;\n)', bis, flags=re.S); assert m, name; return m.group(1)
def grant(name):
    m = re.search(r'(grant execute on function public\.' + name + r'\([^)]*\) to [^;]*;)', bis); assert m, name; return m.group(1)
def revoke(name):
    m = re.search(r'(revoke all on function public\.' + name + r'\([^)]*\) from [^;]*;)', bis); assert m, name; return m.group(1)
def table(name):
    m = re.search(r"(create table if not exists public\." + name + r" \(.*?\n\);\nalter table public\." + name + r" enable row level security;\n)", bis, flags=re.S); assert m, name; return m.group(1)
def accounts_column():
    m = re.search(r"(alter table public\.marque_points_group_key\n  add column if not exists user_id uuid;\ncreate index if not exists marque_points_group_key_user[^;]*;\n)", bis); assert m; return m.group(1)
def accounts_required_column():
    m = re.search(r"(alter table public\.marque_points_group\n  add column if not exists accounts_required[^;]*;\n)", bis); assert m; return m.group(1)
def trigger(name):
    m = re.search(r"(drop trigger if exists " + name + r" on [^;]*;\ncreate trigger " + name + r"\n[^;]*;\n)", bis); assert m, name; return m.group(1)
def alter(column):
    m = re.search(r"(alter table public\.marque_points_games\n  add column if not exists " + column + r"[^;]*;\n)", bis); assert m, column; return m.group(1)
out = "\n".join([
"""-- Mise à jour d'une base déjà en place — à passer une fois, en entier.
--
-- Supabase → SQL Editor → New query → collez tout ce fichier → Run.
-- Réponse attendue : « Success. No rows returned ».
--
-- Sans danger à repasser : rien ici n'efface de données, et tout ce qui
-- existe déjà est remplacé en place. Ce que ça apporte :
--
--   1. les invitations valent deux jours au lieu d'un ;
--   2. « Lien seulement » : un document que seuls ceux qui ont le lien voient,
--      absent des onglets et de l'agenda du groupe ;
--   3. l'organisateur : qui crée un sondage garde seul la main sur la date,
--      la clôture, la question, les choix et la suppression ; les autres
--      votent, et s'ajoutent eux-mêmes ;
--   4. un sondage se fond case par case au lieu d'être remplacé : une copie
--      en retard n'efface plus les votes arrivés entre-temps ;
--   5. ce qui est supprimé ne revient plus : un téléphone qui gardait un
--      sondage supprimé ne peut plus le recréer, ni le ranger dans un autre
--      groupe ; et un sondage clos ne prend plus de votes ;
--   6. les comptes, facultatifs : se connecter par e-mail retrouve ses
--      groupes et ses droits d'organisateur sur tout nouvel appareil ; et
--      chacun peut supprimer son compte et son adresse ;
--   7. un groupe peut exiger un compte : sans compte, un appareil n'y voit
--      plus ce qui est partagé, n'y partage plus et n'y invite plus ;
--   8. qui répond à un sondage par un lien peut y ajouter des choix, et
--      retirer ceux qu'il a ajoutés ;
--   9. l'agenda d'un groupe ne se tait plus parce qu'un autre agenda frappe à
--      une adresse coupée ; un groupe qui exige un compte ferme aussi son
--      agenda, la suppression et les lots aux clés sans compte ; seule une clé
--      qui fait entrer coupe l'agenda ; un lot ne se retire qu'avec une clé de
--      son groupe ; un sondage ne grossit plus sans fin sous les envois des
--      visiteurs.
--
-- Généré depuis docs/DEPLOIEMENT.md, étape 2 bis ; un test vérifie que les
-- deux disent la même chose. Modifiez le guide, pas ce fichier seul.
""",
"-- 6 et 7. Les comptes, et les groupes qui en exigent un : les colonnes d'abord,\n-- que les fonctions ci-dessous lisent.\n" + accounts_column() + "\n" + accounts_required_column(),
"-- 1. Deux jours pour une invitation.\n" + function('marque_points_invite'),
"-- 2. « Lien seulement », et 3. l'organisateur.\n" + alter('listed') + "\n" + alter('owner_hash'),
"-- 4. Les votes fondus case par case.\n" + function('marque_points_merge_votes'),
"-- 5. La trace de ce qui a été supprimé : des identifiants, rien du contenu.\n" + table('marque_points_gone'),
"""-- Les versions précédentes de l'écriture et de la suppression : remplacées
-- ci-dessous par des versions qui connaissent l'organisateur. Les laisser
-- ferait deux fonctions du même nom, entre lesquelles la base refuserait de
-- choisir. Ce sont des fonctions, pas des données : rien n'est perdu.
drop function if exists public.marque_points_put(text, jsonb, text);
drop function if exists public.marque_points_delete(text, text);
""",
"-- 8. Les choix qu'ajoutent les visiteurs.\n" + function('marque_points_add_options'),
function('marque_points_put'),
function('marque_points_delete'),
function('marque_points_group_docs'),
function('marque_points_agenda'),
"-- 9. L'agenda, et ce qu'un groupe qui exige un compte ferme aussi.\n" + function('marque_points_calendar'),
function('marque_points_forget_calendar'),
function('marque_points_put_set'),
function('marque_points_forget_set'),
"-- Les mêmes droits qu'avant, sur les nouvelles versions, rien de plus ;\n-- et la fonte des votes n'est qu'un outil de l'écriture, pas une porte.\n" + "\n".join(
    [grant(n) for n in ['marque_points_invite', 'marque_points_put', 'marque_points_delete', 'marque_points_group_docs', 'marque_points_agenda',
                         'marque_points_calendar', 'marque_points_forget_calendar', 'marque_points_put_set', 'marque_points_forget_set']]
    + [revoke('marque_points_merge_votes'), revoke('marque_points_add_options')]) + "\n",
"-- 6. Les comptes : les secrets d'organisateur.\n"
+ table('marque_points_account') + "\n" + table('marque_points_account_owner')
+ "\n" + table('marque_points_account_cut'),
function('marque_points_account_cut_mark'),
trigger('marque_points_account_cut_mark'),
function('marque_points_account_link'),
function('marque_points_account_owner_put'),
function('marque_points_account_restore'),
function('marque_points_account_leave'),
function('marque_points_account_delete'),
"-- 7. Exiger un compte dans un groupe.\n" + function('marque_points_group_of'),
function('marque_points_group_keys'),
function('marque_points_set_accounts'),
"-- Pour les comptes connectés seulement, pas pour la clé publique de la page.\n" + "\n".join(
    [revoke(n) for n in ['marque_points_account_link', 'marque_points_account_owner_put', 'marque_points_account_restore', 'marque_points_account_leave', 'marque_points_account_delete']]
    + [grant(n) for n in ['marque_points_account_link', 'marque_points_account_owner_put', 'marque_points_account_restore', 'marque_points_account_leave', 'marque_points_account_delete']]
    + [revoke('marque_points_account_cut_mark')]
    + [grant(n) for n in ['marque_points_group_of', 'marque_points_group_keys', 'marque_points_set_accounts']]) + "\n",
])
(root / 'supabase/mise-a-jour.sql').write_text(out)
import sys
if '--coller' in sys.argv:
    # La version à coller dans Supabase : sans les commentaires, plus courte à
    # copier sur un téléphone ; les instructions sont exactement les mêmes.
    kept = [line for line in out.split('\n') if not re.match(r'^\s*--', line)]
    print(re.sub(r'\n{3,}', '\n\n', '\n'.join(kept)).strip())
else:
    print(len(out.splitlines()), 'lignes')
