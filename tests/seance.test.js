import { test } from "node:test";
import assert from "node:assert/strict";
import { carnet, lire } from "./aide.js";
import { parseFcFile, fenetreSeance, resumeSeance, denseRun, courbeFc, FC_PAS } from "../src/calculs.js";

const echantillons = (raw) => parseFcFile(raw).filter((s) => s.ms > 0 && s.bpm > 20 && s.bpm < 250).sort((a, b) => a.ms - b.ms);

test("séance du 15/09 : le recalcul reproduit exactement le résumé stocké par l'app", () => {
  const data = carnet();
  const samples = echantillons(lire("fc/2026-09-15-1152.json"));
  const w = fenetreSeance(data.sessions, data.treadmill, "2026-09-15");
  const rec = resumeSeance(samples, w, "2026-09-15");
  const stocke = data.durations.find((x) => x.date === "2026-09-15");
  assert.equal(rec.hr, stocke.hr);       // 94
  assert.equal(rec.hrMax, stocke.hrMax); // 133
  assert.deepEqual(rec.ex, stocke.ex);
  assert.deepEqual(rec.pics, stocke.pics);
  assert.deepEqual(rec.fc, stocke.fc);
  assert.equal(rec.n, 904);
  assert.deepEqual(rec.tap.map((t) => t.hr), data.treadmill.filter((t) => t.date === "2026-09-15").map((t) => t.hr));
});

test("séance du 15/09 : une série enregistrée sitôt finie = un pic de FC par série", () => {
  const data = carnet();
  const saisies = data.sessions.filter((s) => s.date === "2026-09-15");
  assert.equal(saisies.length, 12);
  assert.ok(saisies.every((s) => s.sets.length === 1 && s.at > 0));
  const w = fenetreSeance(data.sessions, data.treadmill, "2026-09-15");
  assert.equal(w.blocs.length, 12);
  assert.ok(w.blocs.every((b) => b.solo));
  const rec = resumeSeance(echantillons(lire("fc/2026-09-15-1152.json")), w, "2026-09-15");
  assert.equal(rec.pics.length, 12);
  assert.deepEqual(rec.pics.map((p) => p.id), saisies.sort((a, b) => a.at - b.at).map((s) => s.id));
  // pics dans l'ordre des séries : Dev incliné ×3, Dips ×3, Incline chest press ×3, Chest press ×3
  assert.deepEqual(rec.pics.map((p) => p.pic), [105, 100, 102, 107, 111, 107, 109, 96, 94, 104, 101, 106]);
});

test("fenêtre : premier bloc = 3 min avant la première saisie, fin = dernière saisie + 2 min, tapis englobé", () => {
  const t = Date.UTC(2026, 8, 20, 10, 0);
  const sessions = [
    { id: "a", date: "2026-09-20", exercise: "Row", sets: [{ kg: 80, reps: 10 }], at: t },
    { id: "b", date: "2026-09-20", exercise: "Row", sets: [{ kg: 80, reps: 10 }, { kg: 80, reps: 10 }], at: t + 5 * 60000 },
  ];
  const w = fenetreSeance(sessions, [{ id: "t", date: "2026-09-20", at0: t + 10 * 60000, min: 15 }], "2026-09-20");
  assert.deepEqual(w.win, [t - 3 * 60000, t + 25 * 60000]);
  assert.deepEqual(w.blocs.map((b) => b.solo), [true, false]);
  assert.deepEqual(w.blocs.map((b) => [b.from, b.to]), [[t - 3 * 60000, t], [t, t + 5 * 60000]]);
  // moins de deux saisies horodatées : fenêtre inconnue
  assert.equal(fenetreSeance(sessions.slice(0, 1), [], "2026-09-20"), null);
  assert.equal(fenetreSeance(sessions.map((s) => ({ ...s, at: undefined })), [], "2026-09-20"), null);
});

test("résumé sans fenêtre : détection par densité, pas de détail par exercice", () => {
  const t = Date.UTC(2026, 8, 20, 10, 0);
  const s = (i, bpm) => ({ ms: t + i * 5000, day: "2026-09-20", bpm });
  const dense = Array.from({ length: 200 }, (_, i) => s(i, 100 + (i % 20)));
  const rafale = [{ ms: t - 3600000, day: "2026-09-20", bpm: 60 }, { ms: t - 3600000 + 30000, day: "2026-09-20", bpm: 62 }];
  const rec = resumeSeance([...rafale, ...dense], null, "2026-09-20");
  assert.equal(rec.n, 200);
  assert.equal(rec.hrMax, 119);
  assert.equal(rec.ex, undefined);
  assert.equal(rec.pics, undefined);
  assert.equal(resumeSeance([], null, "2026-09-20"), null);
  assert.equal(denseRun(rafale).length, 0); // moins de 10 min : rien
});

test("courbeFc : une moyenne par tranche de 30 s, trous à null", () => {
  const t = 1_800_000_000_000; // multiple de FC_PAS
  const c = courbeFc([{ ms: t, bpm: 100 }, { ms: t + 10000, bpm: 110 }, { ms: t + 2 * FC_PAS, bpm: 120 }]);
  assert.equal(c.t0, t);
  assert.deepEqual(c.v, [105, null, 120]);
});

test("parseFcFile : formats tableau et compact, virgule décimale, dates invalides signalées par NaN", () => {
  const a = parseFcFile([{ t: "2026-09-15T10:00:00+02:00", bpm: 90 }]);
  assert.equal(a[0].bpm, 90);
  assert.ok(a[0].ms > 0);
  const b = parseFcFile({ t: "2026-09-15 10:00:00|bidon", b: "91,5|92 bpm" });
  assert.equal(b[0].bpm, 91.5);
  assert.equal(b[0].day, "2026-09-15");
  assert.equal(b[1].bpm, 92);
  assert.ok(Number.isNaN(b[1].ms));
  assert.equal(parseFcFile({}).length, 1); // chaîne vide → une ligne inexploitable, filtrée par l'appelant
});
