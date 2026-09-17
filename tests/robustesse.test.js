import { test } from "node:test";
import assert from "node:assert/strict";
import { lire, carnet } from "./aide.js";
import { carnetValide, carnetVide, resumeNuit } from "../src/calculs.js";

const DEFAUT = ["Dev incliné", "Dev couché", "Chest press", "Dips", "PullDown", "Row", "Leg extension", "Leg Curl", "Leg press", "Shoulder press"];

test("import : un JSON valide mais de forme fausse est refusé", () => {
  assert.equal(carnetValide(carnet()), true);
  assert.equal(carnetValide({ sessions: [], weights: [] }), true);
  assert.equal(carnetValide({ sessions: {}, weights: [] }), false); // plantait le rendu, puis la réouverture
  assert.equal(carnetValide({ sessions: [], weights: {} }), false);
  assert.equal(carnetValide({ sessions: [], weights: [], daily: "x" }), false);
  assert.equal(carnetValide({ sessions: [], weights: [], pas: [] }), false);
  assert.equal(carnetValide({ weights: [] }), false);
  for (const x of [null, undefined, [], 42, "{}"]) assert.equal(carnetValide(x), false);
});

test("carnet vide : une décision, un repas ou un exercice ajouté comptent", () => {
  assert.equal(carnetVide({ ...JSON.parse('{"sessions":[],"treadmill":[],"weights":[],"durations":[],"daily":[]}'), exercises: DEFAUT, pas: {} }, DEFAUT), true);
  assert.equal(carnetVide({ sessions: [], treadmill: [], weights: [], durations: [], daily: [], exercises: DEFAUT }, DEFAUT), true);
  // décision du matin seule, sur un appareil neuf : le carnet n'est pas vide
  assert.equal(carnetVide({ sessions: [], treadmill: [], weights: [], durations: [], daily: [{ date: "2026-09-18", decision: { d: "repos" } }], exercises: DEFAUT }, DEFAUT), false);
  assert.equal(carnetVide({ sessions: [], treadmill: [], weights: [], durations: [{ date: "2026-09-18", min: 40 }], daily: [], exercises: DEFAUT }, DEFAUT), false);
  assert.equal(carnetVide({ sessions: [], treadmill: [], weights: [], durations: [], daily: [], exercises: [...DEFAUT, "Pulley"] }, DEFAUT), false);
  assert.equal(carnetVide({ sessions: [], treadmill: [], weights: [], durations: [], daily: [], exercises: DEFAUT, pas: { Row: 5 } }, DEFAUT), false);
  assert.equal(carnetVide(carnet(), DEFAUT), false);
});

test("VFC : avec horodatages et aucune mesure pendant le sommeil, pas de VFC", () => {
  const raw = lire("daily-test/2026-09-16.json");
  const nuit = resumeNuit(raw, "2026-09-16");
  assert.deepEqual([nuit.vfc, nuit.vfcN], [50, 4]); // 4 mesures pendant le sommeil
  // une seule mesure, en pleine journée : plus de repli sur le relevé entier
  const jour = { ...raw, vfc: "31", vfc_t: "2026-09-16 12:00:00" };
  const r = resumeNuit(jour, "2026-09-16");
  assert.equal(r.vfc, undefined);
  assert.equal(r.vfcN, undefined);
  // ancien fichier sans horodatages : le repli reste, sinon on perdrait l'historique
  const ancien = resumeNuit(lire("daily/2026-09-15.json"), "2026-09-15");
  assert.deepEqual([ancien.vfc, ancien.vfcN], [44.7, 10]);
});
