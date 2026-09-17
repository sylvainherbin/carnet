import { test } from "node:test";
import assert from "node:assert/strict";
import { carnet } from "./aide.js";
import { repriseSeance } from "../src/calculs.js";

// Le formulaire de séance reprend le groupe et l'exercice de la dernière série
// de la date, pour qu'une app rouverte en pleine séance ne revienne pas sur Pecs.

test("reprise : dernière série de la date, sur les vraies séances", () => {
  const s = carnet().sessions;
  assert.deepEqual(repriseSeance(s, "2026-09-15").group, "Pecs");
  assert.equal(repriseSeance(s, "2026-09-10").group, "Dos");
  assert.equal(repriseSeance(s, "2026-09-12").group, "Jambes");
  assert.equal(repriseSeance(s, "2026-09-16"), null); // pas de séance ce jour-là
});

test("reprise : l'heure de saisie prime sur l'ordre du tableau, l'ordre départage le reste", () => {
  const d = "2026-09-17";
  const s = [
    { date: d, group: "Dos", exercise: "Row", at: 300 },
    { date: d, group: "Dos", exercise: "PullDown", at: 100 },
    { date: "2026-09-18", group: "Pecs", exercise: "Dips", at: 999 },
  ];
  assert.deepEqual(repriseSeance(s, d), { group: "Dos", exercise: "Row" });
  const sansHeure = [{ date: d, group: "Pecs", exercise: "Dips" }, { date: d, group: "Épaules", exercise: "Upper Back" }];
  assert.deepEqual(repriseSeance(sansHeure, d), { group: "Épaules", exercise: "Upper Back" });
  assert.deepEqual(repriseSeance([{ date: d, exercise: "Row" }], d), { group: null, exercise: "Row" });
});

