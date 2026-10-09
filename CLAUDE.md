@AGENTS.md

# CLAUDE.md — session « Dev-carnet »

Complément à AGENTS.md pour Claude Code. Ne rien recopier d'AGENTS.md ici.
Dépôt public : aucun secret, aucune donnée personnelle ou de santé.

## Rôle

- Cette session développe Carnet et répond du code du dépôt.
- Le **coach** est une autre session Claude, distincte. Il lit
  `carnet-data.json`, `daily/` et `fc/`, et il écrit `plan/AAAA-MM-JJ.json` par
  l'API GitHub. Aucun canal direct avec lui : Sylvain fait le lien.
- GitHub (`main`) fait foi. La copie locale peut être en retard : faire un
  `git pull` avant de conclure sur l'état des données.

## Contrat de données avec le coach

Tout changement de forme se signale à Sylvain **avant** d'être fait.

- **Ce que l'app lit dans `plan/`** (`lirePlan`, `src/calculs.js`) :
  `date` (obligatoire), `v`, `ecrit`, `nuit`, `decision.{d,regle,motif}`,
  `seance.{groupe,titre,notion,echauffement[],tapis.{min,pente,kmh}}`,
  `seance.exercices[].{nom,series,reps,kg,note,pas}`, `points[]`.
  - `series`, `reps`, `kg`, `pas` et les nombres de `tapis` sont
    **numériques** par contrat : ils passent par `nb()`. Un texte non
    numérique comme une fourchette `"8-10"` donnerait 0 et disparaîtrait de
    l'affichage sans rien signaler. Le coach n'en a jamais écrit, donc le code
    reste tel quel.
  - `decision.d` doit valoir `maintenu`, `allege` (sans accent) ou `repos`,
    les clés de `DECISIONS` (`CarnetEntrainement.jsx`). « allégé » n'est que
    l'étiquette affichée. Toute autre valeur s'affiche brute, et aucun bouton
    radio ne la reflète.
  - `seance.groupe` doit être une valeur de `GROUPS` pour présélectionner le
    groupe.
  - `exercices[].nom` doit correspondre exactement au nom de l'exercice
    saisi, sinon l'avancement reste à 0. Un nom inconnu crée l'exercice
    (`manquesDuPlan`).
- **Ce que l'app écrit dans `carnet-data.json` et que le coach lit :**
  `daily[].decision.par` (`coach` ou `moi`), `daily[].plan`
  (`{prevues, faites, conforme}`), les résumés de nuit (`v`, `sha`, `n`,
  `min`, `moy`, `hMin`, `vfc`, `vfcN`, `resp`, `respN`, `spo2`, `spo2Min`,
  `temp`, `dodo`, `coucher`, `lever`, `somAbsent`), les résumés de séance
  (`durations[]` : `hr`, `hrMax`, `ex`, `pics`, `fc`), `sessions[].rpeAuto`,
  et les colonnes de `exportDerive`.
- Récupération après série (v49) : `durations[].recup` (`id`, `pic`, `t`,
  `f30`, `f60`, `ctx` = `meme_exercice` | `transition` | `fin_seance`) et
  `durations[].recupV` (`RECUP_VERSION`). Seules les séries mesurables y
  figurent ; les baisses (pic − f30/f60) se recalculent, elles peuvent être
  négatives. Ce `pic` est le pic de fin d'effort : il diffère de `pics`
  (maximum du bloc depuis la validation précédente, souvent la queue du pic
  de la série d'avant), laissé inchangé. Ne pas agréger les contextes
  ensemble : la baisse médiane vaut 18 en `meme_exercice`, 11 en
  `transition`.
- Renommer ou retirer l'un de ces champs, ou changer le sens d'un résumé
  (par exemple via `NUIT_VERSION`), modifie ce que le coach lit.
- `decision.par = "moi"` bloque **définitivement** la décision du coach pour
  ce jour-là : une réécriture du plan ne la touche plus.
- `fc/` n'est jamais réécrit. `daily/` l'est : le raccourci fait un GET du
  `sha` puis un PUT. `daily-test/` n'est lu par personne, ni l'app ni le
  coach.
- `SEUIL_R1_H = 6.5` (`Courbes`, `CarnetEntrainement.jsx`) recopie la règle
  R1 du coach pour la ligne du graphique de sommeil. Si le coach change R1,
  cette valeur ne suivra pas : le signaler à Sylvain.

## Choix volontaires (ne pas proposer de les changer)

- Le halo néon de l'interface est assumé : ne pas proposer de l'atténuer.
- La palette `G` des graphiques est volontairement distincte de la palette
  `T` de l'interface.
- `CHAMPS_CONSERVES` est une liste blanche délibérée.
- Les charges élevées et les grands trous de l'historique sont réels : ce ne
  sont pas des erreurs de données. N'écrire ici ni valeurs ni explications.
- Le dépôt et ses données sont publics par choix de Sylvain : ne pas relancer
  le sujet.
- Correction manuelle de `carnet-data.json` : une seule ligne touchée,
  indentation d'un espace, jamais de reformatage. Une réécriture complète du
  fichier (5 320 lignes) a déjà eu lieu par erreur.

## Carte du code

`src/calculs.js` (pur, testé) :
- FC de séance : `parseMs` (heure **locale** sans fuseau), `parseFcFile`
  (formats tableau et compact), `courbeFc`, `denseRun`, `fenetreSeance`,
  `resumeSeance`.
- Nuit : `NUIT_VERSION`, `parseSommeil`, `derniereNuit` (dernier bloc,
  coupure à `NUIT_TROU`), `resumeNuit`, `fusionNuit`, `CHAMPS_CONSERVES`,
  `nuitAJour`, `dailyAImporter`, `ecartTemp`.
- Carnet : `carnetValide` (garde à l'import et au chargement), `carnetVide`
  (autorise l'adoption du distant sans confirmation).
- Calories : `kcalTapis`, `kcalSeance`, `weightFor`.
- Progression : `verdictProgression`, `recordE1rm`, `seriesParGroupe`,
  `repriseSeance`.
- Plan : `lirePlan`, `avancementPlan`, `seanceTerminee`, `planPrevuFait`,
  `poserPlanFait`, `decisionAEcrire`, `poserDecision`, `manquesDuPlan`.
- Récupération : `recupSerie`, `recuperationSeance`, `recupDefinitive`
  (`RECUP`, `RECUP_VERSION`), `fcSerieExport` (colonnes du CSV tableur).
- Export : `ligneJour`, `exportDerive` (CSV `;`).

`src/githubSync.js` :
- `pullRemote` et `pushRemote` : verrou `sha`. Un 409 ou un 422 donne
  `{conflict}`.
- `pullPlanFile` : un 404 donne `null`.
- `listFcFiles`, `listDailyFiles` (avec `{name, sha}`), `pullFcFile`,
  `pullDailyFile`, `lireJson` (lit le premier objet d'un `{…}{…}`).
- Le propriétaire et le dépôt sont écrits en dur dans les URL.

`src/CarnetEntrainement.jsx` :
- Composant racine : les clés `localStorage` (`carnet-entrainement-v1`,
  `carnet-gh-*`, `carnet-plan`, `carnet-plan-masque`, `carnet-tapis-start`),
  `doPull` et `doPush`, `adopt`, l'effet de sauvegarde (le marqueur
  `GH_DIRTY` est posé tout de suite, l'écriture attend 400 ms, le push 2 s),
  `chargerPlan`, `importFc`, `importDaily`, et `relireTout` (au plus toutes
  les 2 min au retour dans l'app, plus au retour du réseau).
- Les onglets sont des fonctions du même fichier : `Seance` (bloc du plan,
  décision du matin, saisie), `Tapis`, `Poids` (heure du dernier repas
  rangée sur la nuit suivante), `Courbes`, `Records`, `Donnees` (import,
  export, jeton).
- Un `update(fn)` passe par `structuredClone`.
- `adopting` marque un `setData` venu du stockage ou de GitHub, pour qu'il
  ne compte pas comme une modification.

## Environnement (machine de Sylvain, 27/09/2026)

- **Node 24.20.0** et npm 11, installés par nvm et **absents du PATH par
  défaut** : `export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH`.
- Le fuseau de la machine est celui de Paris, donc `npm test` donne **62/62**
  sans rien régler. Les tests restent dépendants du fuseau : sous `TZ=UTC`,
  les deux tests de `tests/seance.test.js` sur le 15/09 échouent, parce que
  `parseMs` lit les horodatages `fc/` en heure locale alors que les `at` des
  saisies sont absolus, et que les fixtures ont été enregistrées à Paris.
- `npm ci` plutôt que `npm install`, qui peut réécrire `package-lock.json` :
  ce diff ne se committe pas.
- `npm run lint` : 0 erreur, 41 avertissements (`set-state-in-effect`,
  `exhaustive-deps`), tous dans `CarnetEntrainement.jsx`. `npx oxlint src`
  donne exactement le même compte : aujourd'hui, seul `src` produit des
  avertissements.
- `npm run build` : OK, avec un avertissement « chunk > 500 kB » (Recharts).
- `git`, `gh` et `rsync` sont installés, et le remote `origin` est en place.
  `gh` sert aux corrections de `carnet-data.json` par l'API.

## Commits et déploiement

- Travail directement sur `main`. Pas de branche ni de PR : c'est la raison
  du retour en local.
- Le déploiement passe par `scripts/deploy.sh vNN "message"`, qui incrémente
  `CACHE` dans `public/sw.js`, lance lint, tests et build, commit et pousse
  `main`, recopie `dist/` dans `gh-pages` sans supprimer d'assets, puis
  vérifie en ligne. Dernière version déployée : **v49**.
- Jamais de `--force`, jamais de suppression d'assets sur `gh-pages`.
- Rien n'est déployé sans l'accord de Sylvain. Lui décrire ce qui change
  avant de committer, et lui rendre compte de ce qui est parti.
- Terminer les messages de commit par les lignes d'attribution de la
  session.

## Points ouverts

- `scripts/deploy.sh` fait un `git add -A` sur tout le répertoire : vérifier
  l'état du dépôt avant de le lancer, pour ne pas emporter un fichier de
  travail.
- Les tests dépendent du fuseau : ils ne passent qu'à l'heure de Paris.
  Correctif retenu : fixer le fuseau dans `tests/aide.js`, **pas** dans
  `calculs.js`, dont le calcul est juste tant que l'app et les données
  partagent le même fuseau, ce qui est le cas en usage réel.
- Corrections d'AGENTS.md jugées fondées, pas encore appliquées : AGENTS.md
  est partagé avec Codex, il faut l'accord de Sylvain.
  - Documenter le fuseau des tests.
  - Remplacer `npm install` par `npm ci`.
  - Documenter les clés de `decision.d` et le fait que `reps` est numérique.
  - Signaler que `deploy.sh` ne lint que `src`, alors que `npm run lint`
    lint tout le dépôt.

## Pièges repérés

- **Fuseau** : les horodatages `daily/` et `fc/` n'ont pas de fuseau.
  - Un résumé de nuit reste cohérent dans n'importe quel fuseau, car tout y
    est relu localement.
  - Un résumé de séance, lui, croise des chaînes locales avec des `at`
    absolus : une séance importée dans un autre fuseau que celui où elle a
    été faite (voyage, déménagement) décale la fenêtre FC.
- **Sieste** : `derniereNuit` garde le **dernier** bloc de sommeil. Si le
  relevé du jour est réécrit après une sieste séparée de la nuit par plus de
  `NUIT_TROU` heures, la sieste remplace la nuit. Reproduit sur des données
  synthétiques, mais jamais arrivé : le relevé n'est déposé que le matin, et
  aucun segment de sommeil ne tombe l'après-midi dans `daily/`. On ne sait
  pas si Santé transmet les siestes. À surveiller si l'heure de dépôt change.
- **Quota anonyme de 60 requêtes par heure** :
  - Une relecture coûte au moins 3 requêtes (plan, carnet, liste `daily/`).
  - Elle en coûte 4 dès qu'une séance des 14 derniers jours attend encore
    son résumé FC : il faut alors lister `fc/`, puis lire les fichiers.
  - Au pire, cela fait environ 120 requêtes par heure. Le jeton n'est
    utilisé que pour écrire.
  - Un dépassement dégrade la synchro, mais l'app continue sur ses données
    locales.
  - Chaque hausse de `NUIT_VERSION` relit **tous** les fichiers de `daily/`
    d'un coup (`Promise.all`), pas seulement ceux des 14 derniers jours.
  - Un relevé illisible est retenté à chaque relecture.
- **Taille de `carnet-data.json`** : 164 ko le 09/10/2026, pour une
  croissance mesurée d'environ 4,3 ko par jour depuis le 20/09, plus la
  récupération par série (~1,5 ko par séance ; +32,6 ko pour le rattrapage de 22 séances). Au-delà de 1 Mo, l'API
  Contents (média `object`) renvoie un `content` vide (limite documentée, à
  revérifier). `pullRemote` échouerait alors en « hors ligne » permanent,
  vers le printemps 2027 au rythme actuel.
- **Rattrapage de la récupération** : `importFc` lit au plus
  `FC_LECTURES_RECUP` fichiers `fc/` par passage pour les dates pas encore
  définitives, sans limite d'âge. Une date sans aucun fichier ne coûte que
  le listage de `fc/`. Une date dont la FC ne couvre pas la dernière
  récupération (cas fréquent : le raccourci dépose vers midi) relit ses 1 à
  2 fichiers à chaque ouverture de l'app jusqu'à J+2, où elle devient
  définitive. Un fichier illisible : rien de définitif, on retente.
- **Dates limites** : `limit` et `nextDay` passent par `toISOString()`, qui
  donne une date UTC. Les dates saisies sont locales, d'où un décalage d'un
  jour possible autour de minuit. C'est sans effet pratique sur une fenêtre
  de 14 jours.
- `dailyAImporter` : une entrée `daily` sans `n` (souche créée par `repas`
  ou `decision`) est toujours considérée à résumer.
- Les messages de commit de l'app sont `Synchro carnet AAAA-MM-JJ HH:MM` et
  ceux du coach `Plan du coach : …`. L'historique de `main` en est rempli.
  Pour retrouver les commits de code :
  `git log -- src tests public scripts`.
