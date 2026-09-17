# Carnet

Carnet d'entraînement personnel : PWA hors-ligne (React + Vite + Tailwind),
synchronisée par l'API GitHub sur `carnet-data.json`, alimentée par deux
raccourcis iOS qui déposent la FC de séance (`fc/`) et le relevé quotidien de
nuit (`daily/`). Servie par GitHub Pages depuis la branche `gh-pages`.

- `src/calculs.js` : tous les calculs, sans React — testés hors navigateur.
- `src/githubSync.js` : lecture/écriture GitHub, lecture tolérante des fichiers déposés.
- `src/CarnetEntrainement.jsx` : l'interface.
- `tests/` : tests sur des copies figées de vrais fichiers (`tests/fixtures/`).

```
npm test              # node --test, aucune dépendance
npm run lint          # oxlint
scripts/deploy.sh v28 "message"   # lint + tests + build + push + vérification en ligne
```

Le script de déploiement ne supprime jamais les anciens assets de `gh-pages` :
Pages sert `index.html` avec un cache de 10 min qui peut encore pointer dessus.

## Dépôt du relevé quotidien depuis les raccourcis

L'API Contents refuse un `PUT` sans `sha` sur un fichier qui existe déjà
(422, `"sha" wasn't supplied`). Un raccourci qui dépose `daily/<date>.json`
par un simple `PUT` échoue donc dès sa deuxième exécution du jour, et il faut
supprimer le fichier à la main pour qu'il repasse. La séquence à mettre dans
les raccourcis pour que la dernière exécution écrase la précédente :

1. **Lire le fichier du jour.**
   `GET https://api.github.com/repos/sylvainherbin/carnet/contents/daily/<date>.json?ref=main`
   avec les en-têtes `Authorization: Bearer <jeton>` et
   `Accept: application/vnd.github+json`.
   Au premier passage du jour, la réponse est un 404
   (`{"message": "Not Found", …}`) : « Obtenir le contenu de l'URL » ne
   s'arrête pas pour autant, le raccourci continue.
2. **Récupérer `sha`.** « Obtenir la valeur de `sha` » dans la réponse : l'empreinte
   du fichier existant, ou rien après un 404.
3. **Écrire, avec ou sans `sha`.**
   `PUT` sur la même URL (sans `?ref`), mêmes en-têtes, corps JSON :

   ```json
   { "message": "Relevé quotidien", "branch": "main",
     "content": "<relevé en base64>", "sha": "<sha de l'étape 2>" }
   ```

   Dans Raccourcis, « Définir la valeur du dictionnaire » échoue sur une valeur
   vide : on fait donc deux branches, `Si sha a une valeur` → `PUT` avec `sha`,
   `Sinon` → le même `PUT` sans la clé `sha`.
4. **Contrôler.** Une réponse réussie contient `content.sha` ; sinon, afficher
   `message` dans une notification (« dépôt échoué … ») plutôt que d'échouer
   sans bruit.

Un 409 ou un 422 reste possible si le fichier change entre la lecture et
l'écriture (deux exécutions simultanées) : relancer suffit. Côté app, un
fichier réécrit est repéré par son empreinte et résumé de nouveau, repas et
décision conservés (`dailyAImporter`).

Les fichiers `fc/` ne sont pas concernés : chaque séance a son propre nom
(`fc/AAAA-MM-JJ-HHMM.json`), créé une seule fois.
