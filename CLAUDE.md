@AGENTS.md

# CLAUDE.md — session « Dev-carnet »

Complément à AGENTS.md pour Claude Code. Ne rien recopier d'AGENTS.md ici.
Dépôt public : aucun secret, aucune donnée personnelle ou de santé.

## Rôle

- Cette session développe Carnet et répond du code du dépôt.
- Le **coach** est une autre session Claude, distincte. Il lit
  `carnet-data.json`, `daily/` et `fc/`, et il écrit `plan/AAAA-MM-JJ.json` par
  l'API GitHub. Aucun canal direct avec lui : Sylvain fait le lien.
- GitHub (`main`) fait foi. La copie locale de Sylvain peut être en retard,
  et le clone cloud aussi : faire un `fetch` avant de conclure sur l'état des données.

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

## Commandes vérifiées dans le cloud (26/09/2026)

- Le conteneur tourne avec **Node 22.22**, pas 24, et le fuseau est **UTC**.
- `npm install` : OK, mais npm 10 réécrit `package-lock.json` (78 lignes en
  moins). Utiliser **`npm ci`**, qui laisse le fichier intact, et ne jamais
  committer ce diff.
- `npm test` : **60/62 en UTC**. Les deux tests de `tests/seance.test.js`
  sur le 15/09 échouent. Il faut lancer
  `TZ=Europe/Paris npm test` pour obtenir 62/62. Cause : `parseMs` lit les
  horodatages `fc/` en heure locale, alors que les `at` des saisies sont
  absolus. Les fixtures ont été enregistrées à l'heure de Paris.
- `npm run lint` : 0 erreur, 15 avertissements
  (`set-state-in-effect`, `exhaustive-deps`), tous dans
  `CarnetEntrainement.jsx`.
- `npm run build` : OK, avec un avertissement « chunk > 500 kB » (Recharts).
- Une session peut démarrer sur un clone sans remote `origin`. Dans ce cas,
  rattacher le dépôt GitHub à la session avec l'outil prévu, puis travailler
  dans ce clone. Ni `rsync` ni `gh` ne sont installés.

## Branches et commits

- Travail sur une branche `claude/…`, puis PR vers `main`. Jamais de push
  direct sur `main` ni sur `gh-pages`.
- L'application GitHub de Claude est installée sur le dépôt : la branche se
  pousse avec `git push -u origin <branche>`.
- Avant tout commit, montrer le diff à Sylvain et attendre son accord.

## Points ouverts

- **Déploiement depuis le cloud : pas validé, à ne pas lancer.**
  `scripts/deploy.sh` pousse `main` puis `gh-pages`, alors qu'une session
  cloud ne pousse que sur sa branche de travail. Il lui faut aussi `rsync`,
  absent ici, et il fait un `git add -A` sur tout le répertoire. Pour
  l'instant, le déploiement se fait sur la machine de Sylvain.
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
- **Taille de `carnet-data.json`** : environ 102 ko fin septembre 2026, pour
  une croissance d'environ 3,35 ko par jour. Au-delà de 1 Mo, l'API Contents
  (média `object`) renvoie un `content` vide (limite documentée, à
  revérifier). `pullRemote` échouerait alors en « hors ligne » permanent,
  vers début juillet 2027 au rythme actuel.
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
