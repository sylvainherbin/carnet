import { test } from "node:test";
import assert from "node:assert/strict";
import { lireJson } from "../src/githubSync.js";
import { parseMs } from "../src/calculs.js";

test("lireJson : fichier normal, fichier déposé deux fois de suite, fichier cassé", () => {
  assert.deepEqual(lireJson('{"t":"a|b","b":"1|2"}'), { t: "a|b", b: "1|2" });
  // le raccourci a déjà écrit « {…}{…} » : on lit le premier objet
  assert.deepEqual(lireJson(' {"t":"a}|b","b":"1"}{"t":"a}|b","b":"1"}\n'), { t: "a}|b", b: "1" });
  assert.deepEqual(lireJson("[1,2][3]"), [1, 2]);
  assert.throws(() => lireJson('{"t":'));
  assert.throws(() => lireJson(""));
});

test("parseMs : heure locale de la montre, ISO avec fuseau, rebut", () => {
  const local = parseMs("2026-09-15 08:15:51");
  const d = new Date(local);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()], [2026, 8, 15, 8, 15, 51]);
  assert.equal(parseMs("2026-09-15T08:15:51Z"), Date.UTC(2026, 8, 15, 8, 15, 51));
  assert.equal(parseMs("2026-09-15T08:15:51+02:00"), Date.UTC(2026, 8, 15, 6, 15, 51));
  assert.ok(Number.isNaN(parseMs("bidon")));
  assert.ok(Number.isNaN(parseMs("")));
});
