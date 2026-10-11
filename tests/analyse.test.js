import { test } from "node:test";
import assert from "node:assert/strict";
import { lire } from "./aide.js";
import {
  nuitJour, tableSeries, tableJours, tableExercices, couverture, syntheseAnalyse, exportAnalyseJours, COLONNES_ANALYSE_JOURS,
  spearman, rhoMin, icSpearman, nuitContreSeance, RECUP_VERSION, EFFECTIF_UTILE,
} from "../src/calculs.js";

// ---- Statistiques : valeurs établies à la main -------------------------------
test("Spearman : rangs, ex æquo, série constante", () => {
  // d² = 1+1+1+1+0 = 4 → 1 − 6·4 / (5·24) = 0,8
  assert.equal(spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]), 0.8);
  assert.equal(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1);
  // ex æquo : rangs x = 1 ; 2,5 ; 2,5 ; 4 contre 1..4 → 4,5 / √(4,5 × 5) = 0,9487
  assert.ok(Math.abs(spearman([1, 2, 2, 3], [1, 2, 3, 4]) - 0.9487) < 1e-4);
  assert.equal(spearman([3, 3, 3, 3], [1, 2, 3, 4]), null);
  assert.equal(spearman([1, 2], [1, 2]), null); // moins de trois points
});

test("puissance : corrélation minimale détectable (Fisher, 80 %, 5 %)", () => {
  // tanh(2,8 / √13) = tanh(0,7766) = 0,6507
  assert.ok(Math.abs(rhoMin(16) - 0.6507) < 1e-3);
  assert.ok(Math.abs(rhoMin(40) - Math.tanh(2.8 / Math.sqrt(37))) < 1e-12);
  assert.equal(rhoMin(3), null);
  assert.ok(rhoMin(40) < rhoMin(16));
});

test("intervalle par rééchantillonnage : même graine, même intervalle", () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], y = [2, 1, 4, 3, 6, 5, 8, 7, 10, 9];
  assert.deepEqual(icSpearman(x, y, { graine: 7 }), icSpearman(x, y, { graine: 7 }));
  const [lo, hi] = icSpearman(x, y, { graine: 7 });
  assert.ok(lo <= spearman(x, y) && spearman(x, y) <= hi && lo >= -1 && hi <= 1);
  assert.deepEqual(icSpearman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), [1, 1]);
  assert.equal(icSpearman([1, 2, 3], [1, 2, 3]), null); // trop peu de points
});

test("nuit contre séance : seuls les jours où les deux valeurs existent, effectif jugé", () => {
  const jours = [
    { date: "a", nuit: { sommeilH: 7 }, recupEcart: 1, rpeMoy: 7 },
    { date: "b", nuit: { sommeilH: 6 }, recupEcart: null, rpeMoy: 8 },
    { date: "c", nuit: { sommeilH: null }, recupEcart: 2, rpeMoy: 7 },
    { date: "d", nuit: { sommeilH: 5 }, recupEcart: 3, rpeMoy: 7 },
    { date: "e", nuit: { sommeilH: 8 }, recupEcart: 0, rpeMoy: 7 },
  ];
  const r = nuitContreSeance(jours, "sommeilH", "recupEcart");
  assert.deepEqual(r.points, [{ date: "a", x: 7, y: 1 }, { date: "d", x: 5, y: 3 }, { date: "e", x: 8, y: 0 }]);
  assert.equal(r.n, 3);
  assert.equal(r.rho, -1); // rangs x : 2, 1, 3 ; rangs y : 2, 3, 1 → d² = 0+4+4 = 8 → 1 − 6·8 / (3·8) = −1
  assert.equal(r.ic, null); // moins de 5 points
  assert.equal(r.suffisant, false);
  assert.equal(EFFECTIF_UTILE, 40);
});

// ---- Jeu synthétique : tout se calcule à la main ----------------------------
const T1 = 1_800_000_000_000;
const rec = (o) => ({ ctx: "meme_exercice", ...o });
const donnees = () => ({
  sessions: [
    { id: "a", date: "2026-09-01", group: "Pecs", exercise: "X", sets: [{ kg: 60, reps: 10 }], rpe: 7, at: T1 },
    { id: "b", date: "2026-09-01", group: "Pecs", exercise: "X", sets: [{ kg: 60, reps: 10 }], rpe: 8, at: T1 + 300000 },
    { id: "c", date: "2026-09-01", group: "Dos", exercise: "Y", sets: [{ kg: 40, reps: 10 }, { kg: 40, reps: 10 }], rpe: 6, at: T1 + 600000 },
    { id: "t", date: "2026-09-01", group: "Pecs", exercise: "X", sets: [{ kg: 100, reps: 4 }], rpe: 10, test: true, at: T1 + 900000 },
    { id: "e", date: "2026-09-08", group: "Pecs", exercise: "X", sets: [{ kg: 60, reps: 11 }], rpe: 7, at: T1 + 7 * 864e5 },
    { id: "f", date: "2026-09-08", group: "Pecs", exercise: "X", sets: [{ kg: 60, reps: 11 }], rpe: 7, elastique: true, at: T1 + 7 * 864e5 + 300000 },
    { id: "v", date: "2025-03-18", group: "Pecs", exercise: "X", sets: [{ kg: 30, reps: 10 }] }, // 2025 : ni RPE ni heure
  ],
  treadmill: [],
  durations: [
    { date: "2026-09-01", recupV: RECUP_VERSION, recup: [
      rec({ id: "a", pic: 120, t: 5, f30: 110, f60: 100, f0: 90, t0: -60 }),
      rec({ id: "b", pic: 118, t: 3, f30: 112, f60: 104, f0: 91, t0: -70 }),
      rec({ id: "t", pic: 130, t: 2, f30: 118, f60: 90 }),
    ] },
    { date: "2026-09-08", recupV: 2, recup: [
      rec({ id: "e", pic: 125, t: 4, f30: 112, f60: 101 }),
      rec({ id: "f", pic: 120, t: 4, f30: 110, f60: 100 }),
    ] },
  ],
  daily: [
    { date: "2026-09-01", n: 50, min: 52, moy: 58, dodo: 420, vfc: 50, vfcN: 3, decision: { d: "maintenu", par: "coach" }, plan: { prevues: 4, faites: 4, conforme: true } },
  ],
  weights: [],
});

test("nuit du matin : statut et mesures, jamais de zéro inventé", () => {
  const daily = [
    { date: "j1", n: 50, min: 52, moy: 58, dodo: 344, vfc: 37.7, vfcN: 3 },
    { date: "j2", n: 50, min: 52, dodo: 420 },
    { date: "j3", n: 50, min: 52, vfc: 40 },
    { date: "j4", n: 50, min: 52 },
    { date: "j5", n: 0 },
    { date: "j6", repas: "20:00" },
  ];
  const n = (d) => nuitJour(daily, d);
  assert.deepEqual([n("j1").statut, n("j1").sommeilH, n("j1").vfc, n("j1").vfcN, n("j1").fcMin, n("j1").fcMoy], ["complète", 5.73, 37.7, 3, 52, 58]); // 344 / 60
  assert.deepEqual([n("j2").statut, n("j2").sommeilH, n("j2").vfc], ["sans VFC", 7, null]);
  assert.deepEqual([n("j3").statut, n("j3").sommeilH, n("j3").vfc], ["sans sommeil", null, 40]);
  assert.equal(n("j4").statut, "partielle");
  assert.equal(n("j5").statut, "vide");
  assert.equal(n("j6").statut, "souche");
  assert.deepEqual(n("j7"), { statut: "absente" });
});

test("table des séries : une ligne par saisie horodatée à une série, grandeurs dérivées", () => {
  const s = tableSeries(donnees());
  assert.deepEqual(s.map((x) => x.id), ["a", "b", "t", "e", "f"]); // c (2 séries) et v (sans heure) absentes
  const a = s[0];
  assert.deepEqual([a.rang, a.pic, a.f30, a.f60, a.f0, a.drop30, a.drop60, a.amplitude, a.retour60, a.mesuree, a.versionRecup], [1, 120, 110, 100, 90, 10, 20, 30, 10, true, RECUP_VERSION]);
  assert.deepEqual(s.map((x) => [x.rang, x.elastique, x.test]), [[1, false, false], [2, false, false], [3, false, true], [1, false, false], [1, true, false]]);
  // pas de FC avant : pas d'amplitude ni de retour, pas de zéro
  const t = s[2];
  assert.deepEqual([t.f0, t.amplitude, t.retour60, t.drop60], [null, null, null, 40]);
});

test("table des jours : agrégats, séries test écartées, comparaison à soi-même", () => {
  const j = tableJours(donnees());
  assert.deepEqual(j.map((x) => x.date), ["2026-09-01", "2026-09-08"]); // 2025 absent : ni RPE ni heure
  const d1 = j[0], d2 = j[1];
  assert.equal(d1.groupes, "Pecs+Dos");
  assert.deepEqual([d1.decision, d1.decisionPar, d1.planPrevues, d1.planFaites, d1.planConforme], ["maintenu", "coach", 4, 4, true]);
  assert.deepEqual([d1.series, d1.seriesHorodatees, d1.seriesMesurees, d1.tonnage, d1.rpeMoy, d1.rpeAuto], [5, 3, 2, 2400, 7, 0]); // RPE (7+8+6)/3 ; test exclu du RPE
  // baisses du 01/09 (même exercice, hors test) : 20 et 14 → médiane 17 ; le test (40) est écarté
  // médiane propre de X sans élastique : 20, 14 (01/09) et 24 (08/09) → 20 ; écarts 0 et −6 → moyenne −3
  assert.deepEqual([d1.recupMed, d1.recupNb, d1.recupEcart, d1.fcAvantMed, d1.versionRecup], [17, 2, -3, 90.5, true]);
  assert.deepEqual([d1.nuit.statut, d1.nuit.sommeilH, d1.nuit.vfc], ["complète", 7, 50]);
  // 08/09 : sans nuit ni décision ; X sans élastique (24) et avec (20) sont deux séries d'observations
  assert.deepEqual([d2.nuit.statut, d2.decision, d2.planConforme], ["absente", null, null]);
  assert.deepEqual([d2.recupMed, d2.recupNb, d2.versionRecup], [22, 2, false]);
  // 08/09 : X sans élastique 24 − 20 = +4 ; X avec élastique 20 − 20 = 0 (médiane propre 20) ; moyenne 2
  assert.equal(d2.recupEcart, 2);
});

test("table des exercices : élastique séparé, tests écartés, paires à charge égale", () => {
  const e = tableExercices(donnees());
  assert.deepEqual(e.map((x) => [x.exercise, x.elastique, x.seances.length]), [["X", false, 2], ["X", true, 1], ["Y", false, 1]]);
  const x = e[0];
  assert.deepEqual(x.seances[0], { date: "2026-09-01", kg: 60, reps: 10, e1rm: 80, rpeMoy: 7.5, series: 2, mesures: 2, recupMed: 17, recupEcart: -3, fcAvantMed: 90.5 }); // le test 100×4 est écarté
  assert.deepEqual(x.paires, [{ date: "2026-09-08", kg: 60, dReps: 1, dRpe: -0.5 }]);
  assert.equal(e[1].seances[0].e1rm, 82);
});

test("couverture : nuits, séries mesurées, recalcul", () => {
  const c = couverture(donnees());
  assert.deepEqual(c.nuits, { complete: 1, jours: 2, parStatut: { complète: 1, absente: 1 } });
  assert.deepEqual([c.series.horodatees, c.series.mesurees, c.series.fcAvantMesuree, c.series.tests], [5, 5, 2, 1]);
  assert.deepEqual(c.recalcul, { dates: 2, aJour: 1 });
  assert.equal(c.decisions, 1);
});

test("export journalier : en-tête stable, cellules vides plutôt que zéro", () => {
  const l = exportAnalyseJours(donnees()).split("\n");
  assert.equal(l[0], COLONNES_ANALYSE_JOURS.join(";"));
  assert.equal(l[0], "date;groupes;decision;decision_par;plan_prevues;plan_faites;plan_conforme;nuit_statut;sommeil_h;vfc;vfc_n;fc_min_nuit;series;series_horodatees;series_mesurees;rpe_moy;rpe_auto;tonnage;recup60_mediane;recup60_nb;recup60_ecart_exercice;fc_avant_mediane;recalcul_a_jour");
  assert.equal(l[1], "2026-09-01;Pecs+Dos;maintenu;coach;4;4;1;complète;7;50;3;52;5;3;2;7;0;2400;17;2;-3;90.5;1");
  assert.equal(l[2], "2026-09-08;Pecs;;;;;;absente;;;;;2;2;2;7;0;1320;22;2;2;;0"); // tonnage 60×11 ×2 = 1320
});

test("synthèse : structure stable, déterministe, sans modifier les données", () => {
  const d = donnees(), avant = JSON.stringify(d);
  const a = syntheseAnalyse(d, "2026-10-11"), b = syntheseAnalyse(d, "2026-10-11");
  assert.deepEqual(Object.keys(a), ["version", "recupVersion", "genere", "avertissements", "couverture", "jours", "exercices", "nuitContreSeance"]);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(d), avant);
  assert.equal(a.nuitContreSeance.length, 6);
  assert.ok(a.nuitContreSeance.every((c) => !("points" in c) && c.suffisant === false));
  assert.ok(a.avertissements.length >= 4);
});

// ---- Photo réelle du 11/10/2026 : valeurs établies à la main (Python indépendant) ----
test("réel : jour du 11/10 (allégé, plan dépassé, nuit courte)", () => {
  const data = lire("carnet-data-2026-10-11.json");
  const j = tableJours(data);
  assert.equal(j.length, 24);
  const d = j.find((x) => x.date === "2026-10-11");
  assert.deepEqual([d.decision, d.decisionPar, d.planPrevues, d.planFaites, d.planConforme], ["allege", "coach", 8, 12, false]);
  assert.deepEqual([d.nuit.statut, d.nuit.sommeilH, d.nuit.vfc, d.nuit.vfcN, d.nuit.fcMin], ["complète", 5.73, 37.7, 3, 53]);
  assert.deepEqual([d.series, d.seriesHorodatees, d.seriesMesurees, d.tonnage, d.rpeMoy, d.rpeAuto], [12, 12, 7, 6395, 7, 0]); // 4 séries test écartées des mesures
  // baisses à 60 s (même exercice, hors test) : 13, 22, 23, 25, 17, 20, 17 → médiane 20 ; écarts à la médiane de chaque exercice : moyenne −1
  assert.deepEqual([d.recupMed, d.recupNb, d.recupEcart, d.fcAvantMed], [20, 7, -1, null]);
  assert.equal(d.versionRecup, false); // photo antérieure à la version 3 : le recalcul n'est pas fait
  assert.equal(couverture(data).nuits.complete, 16);
});

test("réel : Shoulder press, séances et paires à charge égale", () => {
  const e = tableExercices(lire("carnet-data-2026-10-11.json")).find((x) => x.exercise === "Shoulder press" && !x.elastique);
  assert.deepEqual(e.seances.map((s) => [s.date, s.kg, s.reps]), [["2026-09-07", 60, 11], ["2026-09-14", 60, 10], ["2026-09-21", 65, 10], ["2026-09-29", 65, 10], ["2026-10-05", 70, 10], ["2026-10-11", 80, 10]]);
  // 60 kg : 11 → 10 répétitions, RPE 10 → 7 ; 65 kg : mêmes répétitions, RPE du 29/09 tous par défaut → null
  assert.deepEqual(e.paires, [{ date: "2026-09-14", kg: 60, dReps: -1, dRpe: -3 }, { date: "2026-09-29", kg: 65, dReps: 0, dRpe: null }]);
});
