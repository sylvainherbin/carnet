import { test } from "node:test";
import assert from "node:assert/strict";
import { carnet } from "./aide.js";
import { kcalSeance, kcalTapis, weightFor } from "../src/calculs.js";

test("kcal des vraies séances : chronos de saisie, tapis inclus", () => {
  const data = carnet();
  const k1 = kcalSeance(data, "2026-09-01");
  assert.deepEqual([k1.total, k1.muscu, k1.tapis, k1.mMin, k1.mode, k1.kg], [429, 259, 170, 78, "chrono", 74.3]);
  const k15 = kcalSeance(data, "2026-09-15");
  assert.deepEqual([k15.total, k15.mode, k15.hr, k15.hrMax], [422, "chrono", 94, 133]);
  assert.equal(kcalSeance(data, "2026-01-01"), null); // rien ce jour-là
});

test("kcal sans poids corporel : null ; sans chronos : 3 min par série", () => {
  const base = { weights: [], treadmill: [], durations: [], sessions: [{ date: "2026-09-20", exercise: "X", group: "Dos", sets: [{ kg: 50, reps: 10 }] }] };
  assert.equal(kcalSeance(base, "2026-09-20"), null);
  const k = kcalSeance({ ...base, weights: [{ date: "2026-09-19", kg: 75 }] }, "2026-09-20");
  assert.equal(k.mode, "estimées");
  assert.equal(k.mMin, 3);
  // 40 s à 6 MET + 2 min 20 à 2 MET, 75 kg
  const attendu = (3.5 * 75 / 200) * (6 * (40 / 60) + 2 * (3 - 40 / 60));
  assert.equal(k.muscu, Math.round(attendu));
});

test("kcalTapis : marche sous 8 km/h, course au-dessus, pente", () => {
  const marche = kcalTapis({ min: 30, km: 3 }, 75); // 100 m/min
  assert.equal(Math.round(marche), Math.round((3.5 + 0.1 * 100) * 75 / 200 * 30));
  const course = kcalTapis({ min: 30, km: 5 }, 75); // 166,7 m/min
  assert.ok(course > marche);
  assert.ok(kcalTapis({ min: 30, km: 3, slope: 5 }, 75) > marche);
  assert.equal(kcalTapis({ min: 30 }, 75), 0);
});

test("weightFor : dernier poids connu à la date, sinon le premier", () => {
  const w = [{ date: "2026-09-10", kg: 75 }, { date: "2026-09-01", kg: 74 }];
  assert.equal(weightFor(w, "2026-09-05"), 74);
  assert.equal(weightFor(w, "2026-09-12"), 75);
  assert.equal(weightFor(w, "2026-08-01"), 74);
  assert.equal(weightFor([], "2026-08-01"), null);
});
