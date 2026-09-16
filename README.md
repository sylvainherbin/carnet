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
