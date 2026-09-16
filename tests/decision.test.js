import { test } from "node:test";
import assert from "node:assert/strict";
import { poserDecision, fusionNuit, resumeNuit } from "../src/calculs.js";
import { lire } from "./aide.js";

// Le 16/09 au matin, l'app restée ouverte depuis la veille avait encore le 15
// dans le champ date du formulaire de séance : la décision du 16 est partie sur
// la ligne du 15. La décision doit viser le jour courant, et ne toucher à
// aucune autre ligne.
const nuit15 = { date: "2026-09-15", v: 3, n: 114, min: 50, moy: 54, hMin: "08:15", decision: { d: "maintenu", regle: "", motif: "séance faite" } };

test("nuit du jour pas encore importée : ligne créée vide, la dernière ligne n'est pas touchée", () => {
  const daily = [{ date: "2026-09-14", v: 3, n: 97 }, nuit15];
  const out = poserDecision(daily, "2026-09-16", "d", "repos");
  assert.deepEqual(out.map((x) => x.date), ["2026-09-14", "2026-09-15", "2026-09-16"]);
  assert.deepEqual(out[2], { date: "2026-09-16", decision: { d: "repos" } });
  assert.deepEqual(out[1], nuit15); // le 15 garde sa propre décision
  assert.equal(daily.length, 2); // l'entrée reçue n'est pas modifiée
  assert.equal(daily[1].decision.d, "maintenu");
});

test("champs posés un à un sur le jour courant, ligne insérée dans l'ordre des dates", () => {
  let daily = [nuit15, { date: "2026-09-17", repas: "20:10" }];
  daily = poserDecision(daily, "2026-09-16", "d", "repos");
  daily = poserDecision(daily, "2026-09-16", "regle", "R1");
  daily = poserDecision(daily, "2026-09-16", "motif", "sommeil 6h00");
  assert.deepEqual(daily.map((x) => x.date), ["2026-09-15", "2026-09-16", "2026-09-17"]);
  assert.deepEqual(daily[1].decision, { d: "repos", regle: "R1", motif: "sommeil 6h00" });
  assert.deepEqual(daily[0].decision, nuit15.decision);
  assert.equal(daily[2].decision, undefined);
});

test("nuit déjà importée : la décision s'ajoute sans toucher aux champs calculés", () => {
  const nuit16 = { date: "2026-09-16", v: 3, n: 86, min: 51, hMin: "05:21", repas: "19:25" };
  const out = poserDecision([nuit15, nuit16], "2026-09-16", "d", "allege");
  assert.deepEqual(out[1], { ...nuit16, decision: { d: "allege" } });
});

test("décision entièrement effacée : le champ disparaît, une souche vide disparaît avec lui", () => {
  let daily = poserDecision([nuit15], "2026-09-16", "motif", "x");
  daily = poserDecision(daily, "2026-09-16", "motif", "");
  assert.deepEqual(daily.map((x) => x.date), ["2026-09-15"]);
  // sur une vraie nuit, seule la décision part
  daily = poserDecision([{ date: "2026-09-16", n: 86, decision: { d: "repos" } }], "2026-09-16", "d", "");
  assert.deepEqual(daily, [{ date: "2026-09-16", n: 86 }]);
});

test("la souche créée avant l'import garde sa décision quand la nuit arrive", () => {
  const souche = poserDecision([], "2026-09-16", "d", "repos")[0];
  const frais = resumeNuit(lire("daily/2026-09-16.json"), "2026-09-16");
  const x = fusionNuit(souche, frais);
  assert.equal(x.n, 86);
  assert.deepEqual(x.decision, { d: "repos" });
});
