import { test } from "node:test";
import assert from "node:assert/strict";
import { parisMs, jourParis, heureParis, hhmmParis, ajouteJours, isoWeek, localMs } from "../src/calculs.js";

test("heure de Paris : été (UTC+2) et hiver (UTC+1)", () => {
  assert.equal(parisMs(2026, 7, 1, 12), Date.UTC(2026, 6, 1, 10));
  assert.equal(parisMs(2026, 12, 1, 12), Date.UTC(2026, 11, 1, 11));
  assert.equal(hhmmParis(Date.UTC(2026, 6, 1, 10, 5)), "12:05");
  assert.equal(heureParis(Date.UTC(2026, 11, 1, 22, 30)), 23);
});

test("jour de Paris : minuit passé à Paris, pas encore en UTC", () => {
  assert.equal(jourParis(Date.UTC(2026, 9, 12, 22, 30)), "2026-10-13");
  assert.equal(jourParis(Date.UTC(2026, 9, 12, 21, 59)), "2026-10-12");
  assert.equal(jourParis(Date.UTC(2026, 11, 31, 23, 30)), "2027-01-01");
});

test("changements d'heure : 29/03/2026 (+1 h) et 25/10/2026 (−1 h)", () => {
  assert.equal(parisMs(2026, 3, 29, 1, 59, 59), Date.UTC(2026, 2, 29, 0, 59, 59));
  assert.equal(parisMs(2026, 3, 29, 3, 0, 0), Date.UTC(2026, 2, 29, 1, 0, 0));
  assert.equal(parisMs(2026, 10, 25, 3, 0, 0), Date.UTC(2026, 9, 25, 2, 0, 0));
  assert.equal(parisMs(2026, 10, 24, 12), Date.UTC(2026, 9, 24, 10));
  assert.equal(localMs("2026-10-25", 7), Date.UTC(2026, 9, 25, 6)); // journée de 25 h
  assert.equal(localMs("2026-10-26") - localMs("2026-10-25"), 25 * 3600000);
});

test("calendrier pur : ajouteJours et isoWeek ne dépendent pas des changements d'heure", () => {
  assert.equal(ajouteJours("2026-10-25", 1), "2026-10-26");
  assert.equal(ajouteJours("2026-03-29", -1), "2026-03-28");
  assert.equal(ajouteJours("2026-03-01", -14), "2026-02-15");
  assert.equal(isoWeek("2026-03-29"), "2026-S13");
  assert.equal(isoWeek("2026-10-25"), "2026-S43");
  assert.equal(isoWeek("2027-01-03"), "2026-S53");
  assert.equal(isoWeek("2027-01-04"), "2027-S01");
});

test("instant invalide : chaîne vide, pas d'exception", () => {
  assert.equal(jourParis(NaN), "");
  assert.equal(hhmmParis(undefined === 0 ? 0 : NaN), "");
});
