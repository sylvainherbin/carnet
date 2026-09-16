import { test } from "node:test";
import assert from "node:assert/strict";
import { carnet } from "./aide.js";
import { exportDerive, ligneJour, isoWeek, lendemain } from "../src/calculs.js";

const ENTETE = "date;decision;regle;motif;groupes;series;tonnage;series_Pecs;tonnage_Pecs;series_Dos;tonnage_Dos;series_Jambes;tonnage_Jambes;series_Épaules;tonnage_Épaules;series_Bras;tonnage_Bras;series_Autre;tonnage_Autre;rpe_moy;rpe_max;fc_seance;fc_max;kcal;kcal_montre;tapis_min;tapis_km;repas;nuit_fc_min;nuit_fc_moy;nuit_fc_hmin;nuit_n;vfc;sommeil_min;poids;notes";

test("export dérivé : en-tête, une ligne par date, ligne du 15/09", () => {
  const data = carnet();
  const lignes = exportDerive(data).split("\n");
  assert.equal(lignes[0], ENTETE);
  const dates = new Set([...data.sessions, ...data.treadmill, ...data.weights, ...data.daily].map((x) => x.date));
  assert.equal(lignes.length, 1 + dates.size);
  assert.equal(lignes.find((l) => l.startsWith("2026-09-15")),
    "2026-09-15;maintenu;;séance faite;Pecs;12;8965;12;8965;0;0;0;0;0;0;0;0;0;0;7.8;10;94;133;422;;15;1.55;;50;54;08:15;114;44.7;478;75.1;");
  assert.equal(exportDerive({ sessions: [], treadmill: [], weights: [], daily: [] }), "");
});

test("export : les cellules contenant ; ou guillemets sont protégées", () => {
  const data = { sessions: [{ date: "2026-09-20", exercise: "X", group: "Dos", sets: [{ kg: 50, reps: 10 }], rpe: 7, note: 'dur; "ok"' }], treadmill: [], weights: [], durations: [], daily: [] };
  const l = exportDerive(data).split("\n")[1];
  assert.ok(l.endsWith(';"dur; ""ok"""'));
  assert.equal(ligneJour(data, "2026-09-20").tonnage, 500);
});

test("semaines ISO et lendemain", () => {
  assert.equal(isoWeek("2026-09-15"), "2026-S38");
  assert.equal(isoWeek("2026-01-01"), "2026-S01");
  assert.equal(isoWeek("2026-12-31"), "2026-S53");
  assert.equal(lendemain("2026-02-28"), "2026-03-01");
  assert.equal(lendemain("2026-12-31"), "2027-01-01");
});
