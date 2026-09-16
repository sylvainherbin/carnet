import { test } from "node:test";
import assert from "node:assert/strict";
import { carnet } from "./aide.js";
import { verdictProgression, seriesParGroupe, recordE1rm, e1rm, PAS_DEFAUT } from "../src/calculs.js";

const AVANT = "2026-09-17";

test("verdicts sur les vraies séances (état du 16/09)", () => {
  const { sessions, pas } = carnet();
  const v = (ex) => verdictProgression(sessions, ex, AVANT, pas[ex] ?? PAS_DEFAUT);
  assert.deepEqual([v("Adducteurs").verdict, v("Adducteurs").cible], ["monte", 40]);
  assert.deepEqual([v("Rotary Calf").verdict, v("Rotary Calf").cible], ["monte", 55]);
  assert.deepEqual([v("Row").verdict, v("Row").cible, v("Row").date], ["monte", 85, "2026-09-10"]);
  assert.deepEqual([v("Dips").verdict, v("Dips").cible, v("Dips").rpes], ["reste", 140, [8, 8]]);
  assert.deepEqual([v("Dev incliné").verdict, v("Dev incliné").rpes], ["reste", [8, 8, 10]]);
  // pas par exercice : 2,5 kg sur les haltères
  assert.deepEqual([v("Haltères postérieur").pas, v("Haltères postérieur").cible], [2.5, 20]);
  // séance de 2025 sans RPE
  assert.deepEqual([v("Leg press").verdict, v("Leg press").motif], ["?", "RPE non saisi"]);
  assert.equal(verdictProgression(sessions, "Inconnu", AVANT), null);
});

test("règle : charge de travail = poids le plus fréquent, le plus lourd à égalité", () => {
  const s = (kg, reps, rpe, date = "2026-09-01") => ({ date, exercise: "X", group: "Dos", sets: [{ kg, reps }], rpe });
  // échauffement à 40 écarté, travail à 60
  let v = verdictProgression([s(40, 10, 4), s(60, 8, 7), s(60, 8, 7), s(60, 8, 7)], "X", "2026-09-02");
  assert.deepEqual([v.kg, v.verdict, v.cible], [60, "monte", 65]);
  // égalité 60/70 → 70
  v = verdictProgression([s(60, 8, 7), s(70, 6, 9), s(70, 6, 9), s(60, 8, 7)], "X", "2026-09-02");
  assert.deepEqual([v.kg, v.verdict, v.cible], [70, "descend", 65]);
  // mélange → reste
  v = verdictProgression([s(60, 8, 7), s(60, 8, 8)], "X", "2026-09-02");
  assert.equal(v.verdict, "reste");
  // une seule série notée → ?
  v = verdictProgression([s(60, 8, 7), s(60, 8, null)], "X", "2026-09-02");
  assert.deepEqual([v.verdict, v.motif], ["?", "une seule série notée"]);
  // seule la dernière séance avant la date compte
  v = verdictProgression([s(60, 8, 7), s(60, 8, 7), s(50, 8, 10, "2026-09-05"), s(50, 8, 10, "2026-09-05")], "X", "2026-09-06");
  assert.deepEqual([v.date, v.verdict, v.cible], ["2026-09-05", "descend", 45]);
  // ne descend pas sous zéro
  assert.equal(verdictProgression([s(2, 8, 10), s(2, 8, 10)], "X", "2026-09-02").cible, 0);
});

test("séries par groupe et plafond", () => {
  const { sessions } = carnet();
  assert.deepEqual(seriesParGroupe(sessions, "2026-09-15"), { Pecs: 12 });
  assert.deepEqual(seriesParGroupe(sessions, "2026-01-01"), {});
});

test("records e1RM (Epley, 1 rep = charge)", () => {
  const { sessions } = carnet();
  assert.equal(recordE1rm(sessions, "Dips"), 234);
  assert.equal(recordE1rm(sessions, "Row"), 260);
  assert.equal(recordE1rm(sessions, "Inconnu"), 0);
  assert.ok(recordE1rm(sessions, "Row", "2026-09-01") <= 260);
  assert.equal(e1rm(100, 1), 100);
  assert.equal(e1rm(100, 10), 100 * (1 + 10 / 30));
});
