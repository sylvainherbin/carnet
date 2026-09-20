# AGENTS.md — Carnet

Consignes pour les agents de code (Codex, Claude Code, autres) qui travaillent
sur ce dépôt. Le dépôt est **public** : ce fichier ne contient et ne doit
contenir aucun secret ni aucune donnée personnelle.

## Le projet

Carnet est une PWA personnelle de suivi d'entraînement et de récupération :
saisie des séances de musculation série par série, tapis, poids, décision du
matin (maintenu / allégé / repos), et résumé de la nuit à partir des données de
l'Apple Watch. Elle fonctionne hors ligne, et un seul utilisateur s'en sert,
surtout depuis un iPhone.

- React 19 + Vite + Tailwind v4 + Recharts, sans backend.
- Synchronisation par l'API GitHub Contents sur `carnet-data.json`, à la
  racine de la branche `main`, avec le `sha` comme verrou optimiste.
- Servie par GitHub Pages depuis la branche `gh-pages` (pas depuis `main`).

## Fichiers clés

| Chemin | Rôle |
|---|---|
| `src/calculs.js` | Tous les calculs, sans React ni navigateur : résumé de nuit, séance, progression, export. C'est ce qui est testé. |
| `src/githubSync.js` | Lecture et écriture GitHub, lecture tolérante des fichiers déposés par les raccourcis. |
| `src/CarnetEntrainement.jsx` | Toute l'interface : état, synchro, import des relevés, onglets. |
| `public/sw.js` | Service worker : `CACHE = 'carnet-vNN'`, incrémenté à chaque déploiement. |
| `scripts/deploy.sh` | Déploiement complet (voir plus bas). |
| `tests/` | Tests `node:test` sur des copies figées de vrais fichiers (`tests/fixtures/`). |
| `carnet-data.json` | Données de l'app, écrites par l'app elle-même. |
| `daily/`, `fc/` | Fichiers déposés par les raccourcis iOS. |
| `plan/` | Séance et décision du jour, écrites par le coach ; l'app ne fait que lire. |

## Données déposées par les raccourcis iOS

Les raccourcis iOS sont des transports sans logique : ils lisent Santé et
déposent un fichier sur `main` par l'API GitHub. **Toute la logique est dans
l'app.** Il est coûteux de les modifier (côté téléphone, sans outil de
génération fiable), donc une évolution passe d'abord par l'app.

- `fc/AAAA-MM-JJ-HHMM.json` : FC d'une séance, créée une fois par séance, jamais
  réécrite. Forme tableau `[{t, bpm}]` ou compacte `{t, b}` (chaînes « | »).
- `daily/AAAA-MM-JJ.json` : relevé du matin, **réécrit** à chaque exécution du
  jour (GET du `sha`, puis PUT avec `sha` ; voir README). Un objet de chaînes
  parallèles séparées par « | » :
  - `fc`, `fc_t` : fréquence cardiaque et horodatages ;
  - `vfc`, `vfc_t` : VFC (ms) et horodatages ;
  - `som_d`, `som_f`, `som_v` : début, fin et phase de chaque segment de sommeil ;
  - `resp`, `resp_t`, `spo2`, `spo2_t`, `temp`, `temp_t` : respiration, SpO2,
    température du poignet ;
  - les anciens fichiers n'ont qu'une partie de ces clés (pas de `*_t` pour la
    VFC, par exemple) : l'app doit continuer à les lire.
  Horodatages locaux `AAAA-MM-JJ HH:MM:SS`, nombres pouvant avoir une virgule
  décimale. Le fichier peut contenir un objet JSON dupliqué (`{…}{…}`) :
  `lireJson` lit le premier.
- `daily-test/` : dépôts d'un raccourci en phase d'essai, non lus par l'app.

## Le plan du jour, écrit par le coach

`plan/AAAA-MM-JJ.json` est déposé par le coach (une session Claude distincte) :
décision du matin, séance prescrite (exercices, séries, reps, charges, notes,
échauffement, tapis), points d'attention. **Le coach en est le seul auteur :
l'app ne doit jamais y écrire ni le supprimer**, pour qu'il n'y ait aucune
course avec la synchro de `carnet-data.json` ni avec les raccourcis. Le fichier
peut être réécrit plusieurs fois dans la journée ; l'app prend la dernière
version, sans fusion. Tout est optionnel sauf `date`, un champ inconnu est
ignoré, et un plan absent ou mal formé ne doit jamais empêcher la saisie à la
main (`lirePlan`, `avancementPlan`, `seanceTerminee`, `planPrevuFait`).

La décision venue du plan est écrite sur la ligne `daily` du jour avec
`decision.par = "coach"` ; dès que Sylvain la saisit ou la modifie, elle passe à
`"moi"` et une réécriture du plan ne l'écrase plus (`decisionAEcrire`).

Chaque nuit est résumée une fois (`resumeNuit`) et le résumé est rangé dans
`carnet-data.json` → `daily[]`, avec `v` (`NUIT_VERSION`) et `sha` (empreinte
git du fichier résumé). Une version plus ancienne ou un `sha` différent
déclenche un nouveau résumé. Les champs saisis à la main (`repas`,
`decision`) sont toujours conservés (`CHAMPS_MANUELS`).

## Commandes

```
npm install
npm test                           # node --test "tests/**/*.test.js", Node 24
npm run lint                       # oxlint, configuration .oxlintrc.json
npm run build                      # vite build → dist/
scripts/deploy.sh vNN "message"    # déploiement complet
```

`scripts/deploy.sh` incrémente `CACHE` dans `public/sw.js`, lance lint, tests
et build, commit et pousse `main`, copie `dist/` dans `gh-pages` **sans
supprimer les anciens assets** (Pages sert `index.html` avec dix minutes de
cache HTTP), puis vérifie en ligne que `sw.js` et chaque asset répondent.

## Règles

- **Ne jamais committer de jeton ni de secret.** Le jeton GitHub vit dans le
  `localStorage` du téléphone et dans un fichier iCloud lu par les raccourcis,
  jamais dans le dépôt, ni dans un raccourci, ni dans ce fichier.
- **Ne pas casser la lecture des fichiers `daily/` et `fc/` existants**, y
  compris les anciens formats. Ajouter une clé est possible ; en retirer ou en
  renommer une demande de modifier les raccourcis, ce qu'on évite.
- **Un changement de méthode de résumé de nuit incrémente `NUIT_VERSION`**, et
  le commentaire au-dessus liste ce que chaque version a changé.
- **Tout calcul va dans `src/calculs.js`**, avec un test. Les valeurs attendues
  des tests sont vérifiées à la main sur les fixtures avant d'être écrites en
  dur : un test qui casse signale un résultat déjà validé qui change.
- **Fixtures figées :** on n'édite pas un fichier de `tests/fixtures/` pour
  faire passer un test ; on en ajoute un nouveau.
- **`carnet-data.json`** est écrit par l'app. Une correction à la main doit
  être minimale (seule la ligne concernée), garder l'indentation d'un espace
  (`JSON.stringify(data, null, 1)`) et ne pas reformater le fichier.
- **Ne jamais supprimer d'assets sur `gh-pages`** ni forcer un push.
- **Pas de nouvelle dépendance** sans raison forte : les tests tournent avec
  Node seul.
- Commentaires et messages de commit en français, dans le style existant.
- L'API GitHub est lue sans jeton côté app (60 requêtes par heure et par
  adresse) : toute lecture automatique doit rester économe.

## Pour un audit

Lire le code, les tests et ce fichier. Reproduire hors navigateur quand c'est
possible (`node` sur `src/calculs.js`). Pour chaque constat : fichier et ligne,
scénario concret qui produit le défaut, et distinction entre ce qui est vérifié
et ce qui est supposé. Un audit ne modifie aucun fichier, ne lance ni
déploiement ni commit.
