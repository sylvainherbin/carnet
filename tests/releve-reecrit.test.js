import { test } from "node:test";
import assert from "node:assert/strict";
import { lire, hhmm, empreinte, carnet } from "./aide.js";
import { resumeNuit, fusionNuit, dailyAImporter, NUIT_VERSION } from "../src/calculs.js";

// Le raccourci a déposé daily/2026-09-17.json deux fois : à 08:48, Santé
// n'avait pas encore la nuit du 16→17 (dernier bloc de sommeil : celui du
// 15→16) ; à 09:00, le fichier réécrit la contenait (coucher 03:09).
const AVANT = "daily-17/0848.json", APRES = "daily-17/0900.json";
const DATE = "2026-09-17", NOM = "2026-09-17.json";
const resume = (rel) => ({ ...resumeNuit(lire(rel), DATE), sha: empreinte(rel) });

test("empreintes : celles du listage GitHub pour les deux versions", () => {
  assert.equal(empreinte(AVANT), "1c877bcfb2f4a170b17934f87cf3ed9d8f9f217e");
  assert.equal(empreinte(APRES), "722e5b42462de1c54e133a0dbba3c935e863618c");
});

test("nuit non reçue : un dernier bloc terminé avant le jour du relevé n'est pas attribué", () => {
  const r = resumeNuit(lire(AVANT), DATE);
  assert.equal(r.somAbsent, true);
  for (const k of ["dodo", "coucher", "lever"]) assert.equal(r[k], undefined, k);
  // FC sur la fenêtre de repli, minuit → 07:00 (éveil compris, d'où la moyenne)
  assert.deepEqual([r.n, r.min, r.hMin, r.moy], [93, 52, "05:41", 62]);
  assert.deepEqual([r.vfc, r.vfcN], [35.1, 4]);
});

test("nuit reçue : le fichier réécrit donne la nuit du 16→17", () => {
  const r = resumeNuit(lire(APRES), DATE);
  assert.equal(r.somAbsent, undefined);
  assert.deepEqual([r.n, r.min, r.hMin, r.moy, r.dodo], [75, 50, "08:29", 56, 320]);
  assert.equal(hhmm(r.coucher), "03:09");
  assert.equal(hhmm(r.lever), "08:41");
  assert.deepEqual([r.vfc, r.vfcN], [35.1, 4]);
});

test("nuit non reçue : une nuit qui se termine le jour du relevé n'est pas touchée", () => {
  const r = resumeNuit(lire("daily/2026-09-16.json"), "2026-09-16");
  assert.equal(r.somAbsent, undefined);
  assert.equal(r.dodo, 360);
  assert.equal(hhmm(r.lever), "07:15");
});

test("fichier réécrit : réimporté malgré une version à jour, repas et décision conservés", () => {
  const limit = "2026-09-03";
  const dec = { d: "maintenu", regle: "", motif: "séance faite" };
  const entree = { ...resume(AVANT), repas: "19:35", decision: dec };
  assert.equal(entree.v, NUIT_VERSION);
  const daily = [entree];
  // même contenu : rien à faire
  assert.deepEqual(dailyAImporter([{ name: NOM, sha: empreinte(AVANT) }], daily, limit), []);
  // contenu réécrit : la date revient
  const todo = dailyAImporter([{ name: NOM, sha: empreinte(APRES) }], daily, limit);
  assert.deepEqual(todo.map((f) => f.name), [NOM]);
  const x = fusionNuit(entree, resume(APRES));
  assert.equal(x.somAbsent, undefined);
  assert.equal(x.sha, empreinte(APRES));
  assert.deepEqual([x.n, x.min, x.hMin, x.moy, x.dodo, x.vfc], [75, 50, "08:29", 56, 320, 35.1]);
  assert.equal(x.repas, "19:35");
  assert.deepEqual(x.decision, dec);
});

test("fichier réécrit : l'âge ne compte pas, une entrée sans empreinte est reprise une fois", () => {
  const vieille = { ...resume(AVANT) };
  // réécrit, mais plus vieux que la limite des nouveaux relevés
  assert.equal(dailyAImporter([{ name: NOM, sha: empreinte(APRES) }], [vieille], "2026-10-01").length, 1);
  // sans entrée et plus vieux que la limite : ignoré, comme avant
  assert.equal(dailyAImporter([{ name: NOM, sha: empreinte(APRES) }], [], "2026-10-01").length, 0);
  // la ligne réellement en place le 17/09 (v4, résumée sur la version de 08:48, sans empreinte)
  const enPlace = { date: DATE, v: 4, n: 0, vfc: 35.1, vfcN: 4, dodo: 360, coucher: 1789512909000, lever: 1789535721000, repas: "19:35" };
  assert.equal(dailyAImporter([{ name: NOM, sha: empreinte(APRES) }], [enPlace], "2026-09-03").length, 1);
  // une entrée à jour, même empreinte : laissée telle quelle
  const d16 = carnet().daily.find((y) => y.date === "2026-09-16");
  assert.equal(dailyAImporter([{ name: "2026-09-16.json", sha: "x" }], [{ ...d16, v: NUIT_VERSION, sha: "x" }], "2026-09-03").length, 0);
});
