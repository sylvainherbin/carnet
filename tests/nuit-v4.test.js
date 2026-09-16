import { test } from "node:test";
import assert from "node:assert/strict";
import { lire, hhmm } from "./aide.js";
import { resumeNuit, ecartTemp, NUIT_VERSION, TEMP_REF_MIN } from "../src/calculs.js";

// Relevé du raccourci de seconde génération (16/09 au soir) : treize clés, dont
// les horodatages de VFC, la respiration, la SpO2 et la température du poignet.
const raw = () => lire("daily-test/2026-09-16.json");

test("v4 : la nuit elle-même ne change pas par rapport au relevé de midi", () => {
  const r = resumeNuit(raw(), "2026-09-16");
  assert.equal(r.v, NUIT_VERSION);
  assert.deepEqual([r.n, r.min, r.moy, r.hMin, r.dodo], [86, 51, 55, "05:21", 360]);
  assert.equal(hhmm(r.coucher), "00:55");
  assert.equal(hhmm(r.lever), "07:15");
});

test("v4 : VFC limitée aux mesures faites pendant le sommeil", () => {
  const r = resumeNuit(raw(), "2026-09-16");
  assert.equal(r.vfcN, 4); // 10 mesures dans le relevé, 4 pendant la nuit
  assert.equal(r.vfc, 50); // médiane des 4 ; la journée entière donnait 32
  // sans horodatages, on retombe sur tout le relevé
  const sans = { ...raw() }; delete sans.vfc_t;
  const r2 = resumeNuit(sans, "2026-09-16");
  assert.equal(r2.vfcN, 10);
  assert.equal(r2.vfc, 30.8);
});

test("v4 : respiration, SpO2 et température du poignet", () => {
  const r = resumeNuit(raw(), "2026-09-16");
  assert.equal(r.resp, 14);
  assert.equal(r.respN, 38);
  assert.equal(r.spo2, 94); // 9 mesures pendant les phases de sommeil (une tombe dans un réveil)
  assert.equal(r.spo2Min, 91);
  assert.equal(r.temp, 35.89); // mesure horodatée 23:15 la veille, avant le premier segment
});

test("v4 : un ancien relevé sans ces clés donne le même résumé qu'en v3, sans les champs", () => {
  const r = resumeNuit(lire("daily/2026-09-15.json"), "2026-09-15");
  assert.deepEqual([r.n, r.min, r.hMin, r.vfc, r.vfcN], [114, 50, "08:15", 44.7, 10]);
  assert.equal(r.resp, undefined);
  assert.equal(r.spo2, undefined);
  assert.equal(r.temp, undefined);
});

test("ecartTemp : médiane des 28 nuits précédentes, à partir de 5 valeurs", () => {
  const d = (i, temp) => ({ date: `2026-09-${String(i).padStart(2, "0")}`, n: 1, temp });
  const daily = [d(1, 35.5), d(2, 35.6), d(3, 35.4), d(4, 35.7), d(5, 35.5), d(6, 35.9)];
  assert.equal(ecartTemp(daily, "2026-09-06"), 0.4); // médiane 35.5
  assert.equal(ecartTemp(daily, "2026-09-05"), null); // 4 valeurs avant
  assert.equal(ecartTemp(daily, "2026-09-07"), null); // pas de température ce jour
  assert.equal(TEMP_REF_MIN, 5);
  // les nuits sans température ne comptent pas
  const troue = [...daily.slice(0, 5), { date: "2026-09-05b", n: 1 }, d(6, 35.9)];
  assert.equal(ecartTemp(troue, "2026-09-06"), 0.4);
});
