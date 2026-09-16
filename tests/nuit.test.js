import { test } from "node:test";
import assert from "node:assert/strict";
import { lire, hhmm } from "./aide.js";
import { resumeNuit, parseSommeil, derniereNuit, fusionNuit, nuitAJour, NUIT_VERSION, NUIT_TROU, mediane } from "../src/calculs.js";

test("nuit du 15/09 : phases de sommeil sur deux nuits, on ne garde que la dernière", () => {
  const r = resumeNuit(lire("daily/2026-09-15.json"), "2026-09-15");
  assert.equal(r.v, NUIT_VERSION);
  assert.equal(r.n, 114);
  assert.equal(r.min, 50);
  assert.equal(r.moy, 54);
  assert.equal(r.hMin, "08:15");
  assert.equal(r.vfc, 44.7);
  assert.equal(r.vfcN, 10);
  assert.equal(r.dodo, 478); // 7 h 58 dormies
  assert.equal(hhmm(r.coucher), "01:29");
  assert.equal(hhmm(r.lever), "09:35");
  assert.equal(new Date(r.coucher).getDate(), 15); // pas la nuit du 13 au 14 présente dans le même fichier
});

test("nuit du 16/09 : nuit courte, peu d'échantillons", () => {
  const r = resumeNuit(lire("daily/2026-09-16.json"), "2026-09-16");
  assert.equal(r.n, 86);
  assert.equal(r.min, 51);
  assert.equal(r.moy, 55);
  assert.equal(r.hMin, "05:21");
  assert.equal(r.dodo, 360);
  assert.equal(hhmm(r.coucher), "00:55");
  assert.equal(hhmm(r.lever), "07:15");
});

test("nuit du 07/09 : sans phases de sommeil, fenêtre de repli minuit–7 h", () => {
  const r = resumeNuit(lire("daily/2026-09-07.json"), "2026-09-07");
  assert.equal(r.n, 99);
  assert.equal(r.min, 48);
  assert.equal(r.moy, 62);
  assert.equal(r.hMin, "06:55");
  assert.equal(r.vfc, 72.5);
  assert.equal(r.dodo, undefined);
  assert.equal(r.coucher, undefined);
});

test("relevé du 01/09 : ancien format (FC de repos Apple seulement), nuit vide", () => {
  const r = resumeNuit(lire("daily/2026-09-01.json"), "2026-09-01");
  assert.equal(r.n, 0);
  assert.equal(r.repos, 79);
  assert.equal(r.min, undefined);
  assert.equal(r.hMin, undefined);
  assert.equal(r.vfc, undefined); // le champ vfc du fichier est du texte non numérique
});

test("relevé vide : aucun plantage, n = 0", () => {
  const r = resumeNuit({}, "2026-09-20");
  assert.deepEqual(r, { date: "2026-09-20", v: NUIT_VERSION, n: 0 });
});

test("hMin : première atteinte du minimum arrondi (Santé rend des valeurs fractionnaires)", () => {
  const raw = { fc_t: "2026-09-10 02:00:00|2026-09-10 03:00:00|2026-09-10 04:00:00", fc: "52.4|51.6|51.5" };
  const r = resumeNuit(raw, "2026-09-10");
  assert.equal(r.min, 52); // 51.5 → 52, 51.6 → 52
  assert.equal(r.hMin, "02:00"); // 52.4 s'arrondit à 52 : premier échantillon
});

test("parseSommeil : « Réveillé » et « Au lit » ne comptent pas comme sommeil, segments invalides écartés", () => {
  const raw = { som_d: "2026-09-10 23:00:00|2026-09-10 23:30:00|2026-09-11 00:00:00|bidon", som_f: "2026-09-10 23:30:00|2026-09-11 00:00:00|2026-09-11 06:00:00|2026-09-11 07:00:00", som_v: "Au lit|Réveillé|Profond|Lent" };
  const p = parseSommeil(raw);
  assert.equal(p.length, 3);
  assert.deepEqual(p.map((x) => x.dort), [false, false, true]);
});

test("derniereNuit : coupure sur un trou de plus de NUIT_TROU heures", () => {
  const h = 3600000, t0 = Date.UTC(2026, 8, 10);
  const seg = (a, b) => ({ from: t0 + a * h, to: t0 + b * h, dort: true });
  const som = [seg(30, 31), seg(0, 3), seg(3.5, 7), seg(26, 30)];
  const bloc = derniereNuit(som);
  assert.deepEqual(bloc.map((s) => [(s.from - t0) / h, (s.to - t0) / h]), [[26, 30], [30, 31]]);
  // un trou d'exactement NUIT_TROU heures ne coupe pas
  assert.equal(derniereNuit([seg(0, 1), seg(1 + NUIT_TROU, 6)]).length, 2);
  assert.equal(derniereNuit([]).length, 0);
});

test("fusionNuit : les champs calculés viennent du frais, repas et decision de l'existant", () => {
  const existant = { date: "2026-09-15", v: 2, n: 120, min: 52, hMin: "02:48", repas: "21:30", decision: { d: "repos", regle: "R1", motif: "sommeil 6h00" } };
  const frais = { date: "2026-09-15", v: 3, n: 114, min: 50, hMin: "08:15" };
  const x = fusionNuit(existant, frais);
  assert.equal(x.n, 114);
  assert.equal(x.hMin, "08:15");
  assert.equal(x.repas, "21:30");
  assert.deepEqual(x.decision, existant.decision);
  // une entrée-souche créée par une saisie manuelle (sans n) est complétée
  assert.equal(fusionNuit({ date: "2026-09-15", repas: "20:00" }, frais).repas, "20:00");
  assert.equal(fusionNuit({ date: "2026-09-15" }, frais).repas, undefined);
});

test("nuitAJour : une version antérieure ou une souche sans relevé est à recalculer", () => {
  assert.equal(nuitAJour({ n: 10, v: NUIT_VERSION }), true);
  assert.equal(nuitAJour({ n: 10, v: NUIT_VERSION - 1 }), false);
  assert.equal(nuitAJour({ n: 10 }), false); // v absent = v1
  assert.equal(nuitAJour({ repas: "21:00" }), false);
  assert.equal(nuitAJour({ n: 0, v: NUIT_VERSION }), true); // relevé vide déjà résumé : pas de relance
});

test("mediane", () => {
  assert.equal(mediane([3, 1, 2]), 2);
  assert.equal(mediane([4, 1, 3, 2]), 2.5);
  assert.equal(mediane([7]), 7);
});
