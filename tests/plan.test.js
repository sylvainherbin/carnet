import { test } from "node:test";
import assert from "node:assert/strict";
import { lire } from "./aide.js";
import { lirePlan, avancementPlan, seanceTerminee, planPrevuFait, poserPlanFait, decisionAEcrire, manquesDuPlan, verdictProgression, ligneJour, exportDerive } from "../src/calculs.js";

// Le coach dépose plan/AAAA-MM-JJ.json ; l'app ne fait que le lire. Le plan de
// fixture est construit pour les tests, sur la vraie séance Dos du 17/09
// (4 exercices, 12 séries faites) : il en prescrit 8, comme la décision
// « allégé » de ce jour-là.
const plan = () => lirePlan(lire("plan/2026-09-17.json"));
// Carnet au 20/09, qui contient la séance du 17/09 et son résumé de séance.
const carnet20 = () => lire("carnet-data-2026-09-20.json");
const DATE = "2026-09-17";

test("plan : lecture tolérante, champs optionnels, formes fausses écartées", () => {
  const p = plan();
  assert.equal(p.date, DATE);
  assert.equal(p.seance.groupe, "Dos");
  assert.equal(p.seance.exercices.length, 4);
  assert.deepEqual(p.seance.exercices[0], { nom: "Row", series: 2, reps: 10, kg: 80, note: "si la 1re sort à 9, stop l'exercice", pas: 0 });
  assert.equal(p.seance.exercices[3].pas, 5);
  assert.deepEqual(p.seance.tapis, { min: 10, pente: 13, kmh: 5.5 });
  assert.deepEqual(p.points, ["Poulie haut du pec : pas au programme"]);
  // plan absent, illisible ou sans date : rien, sans erreur
  for (const x of [null, undefined, "", 42, [], {}, { v: 1 }]) assert.equal(lirePlan(x), null);
  // champ inconnu ignoré, séance absente, exercice sans nom écarté
  const p2 = lirePlan({ date: DATE, inconnu: "x", seance: { exercices: [{ series: 3 }, { nom: "Row" }] } });
  assert.equal(p2.seance.exercices.length, 1);
  assert.equal(p2.decision, null);
  assert.equal(lirePlan({ date: DATE }).seance, null);
});

test("plan absent : l'onglet Séance se comporte comme avant", () => {
  const d = carnet20();
  const av = avancementPlan(null, d.sessions, DATE);
  assert.deepEqual(av.lignes, []);
  assert.equal(av.prevues, 0);
  assert.equal(av.faites, 12); // les séries du jour restent comptées
  assert.equal(planPrevuFait(null, d.sessions, DATE), null);
  assert.equal(decisionAEcrire(undefined, null), null);
  assert.deepEqual(manquesDuPlan(null, [], {}), []);
});

test("plan avec décision seule : pas de séance à afficher", () => {
  const p = lirePlan({ date: "2026-09-18", decision: { d: "repos", regle: "R1", motif: "sommeil 5 h" } });
  assert.equal(p.seance, null);
  assert.deepEqual(avancementPlan(p, [], "2026-09-18").lignes, []);
  assert.deepEqual(decisionAEcrire(undefined, p.decision), { d: "repos", regle: "R1", motif: "sommeil 5 h", par: "coach" });
});

test("plan réécrit : la décision du coach se met à jour, celle de Sylvain non", () => {
  const p1 = { d: "repos", regle: "R1", motif: "sommeil 5 h" };
  const p2 = { d: "allege", regle: "R1", motif: "sommeil 5 h 20" };
  const coach = { ...p1, par: "coach" };
  assert.equal(decisionAEcrire(coach, p1), null);                       // identique : rien à écrire
  assert.deepEqual(decisionAEcrire(coach, p2), { ...p2, par: "coach" }); // réécrit : on suit
  // modifiée ou saisie à la main : jamais écrasée
  assert.equal(decisionAEcrire({ d: "maintenu", regle: "", motif: "je me sens bien", par: "moi" }, p2), null);
  assert.equal(decisionAEcrire({ d: "maintenu", regle: "", motif: "" }, p2), null); // décision d'avant, sans origine
});

test("masquage : la séance est terminée quand tout le prescrit est fait", () => {
  const d = carnet20();
  const p = plan();
  const av = avancementPlan(p, d.sessions, DATE);
  assert.equal(av.prevues, 8);
  assert.equal(av.faites, 12);
  assert.deepEqual(av.lignes.map((x) => [x.nom, x.faites, x.fini]),
    [["Row", 3, true], ["PullDown", 3, true], ["Tirage vertical serré", 3, true], ["Hack squat", 0, false]]);
  // 8 séries sur 12 prévues : le bloc reste visible
  const gros = lirePlan({ date: DATE, seance: { exercices: [{ nom: "Row", series: 6 }, { nom: "PullDown", series: 6 }] } });
  assert.equal(seanceTerminee(gros, d.sessions, [], DATE), false);
  // tout le prescrit fait, sans résumé de séance : terminée
  const petit = lirePlan({ date: DATE, seance: { exercices: [{ nom: "Row", series: 3 }, { nom: "PullDown", series: 3 }] } });
  assert.equal(seanceTerminee(petit, d.sessions, [], DATE), true);
  // un exercice prévu jamais fait : le résumé de séance suffit à clore
  assert.equal(seanceTerminee(p, d.sessions, d.durations, DATE), true);
  assert.equal(seanceTerminee(p, d.sessions, [], DATE), false);
});

test("un fichier fc/ déposé sans aucune série ne termine pas la séance (16/09)", () => {
  const d = carnet20();
  assert.equal(d.sessions.filter((s) => s.date === "2026-09-16").length, 0);
  const p = lirePlan({ date: "2026-09-16", seance: { exercices: [{ nom: "Row", series: 3 }] } });
  // le 16/09, un fichier FC est arrivé un jour de repos : aucun résumé n'a été créé
  assert.equal(seanceTerminee(p, d.sessions, d.durations, "2026-09-16"), false);
  // et même avec une entrée durations sans résumé d'exercices, sans série : rien
  const fcSeul = [{ date: "2026-09-16", fc: { t0: 1, v: [80, 90] } }];
  assert.equal(seanceTerminee(p, d.sessions, fcSeul, "2026-09-16"), false);
});

test("RPE automatique : compté dans le verdict, mais signalé", () => {
  const base = { date: "2026-09-10", group: "Dos", exercise: "Row", sets: [{ kg: 80, reps: 10 }] };
  const auto = [1, 2, 3].map((i) => ({ ...base, id: `a${i}`, rpe: 7, rpeAuto: true }));
  const choisi = [1, 2, 3].map((i) => ({ ...base, id: `c${i}`, rpe: 7 }));
  const v1 = verdictProgression(auto, "Row", "2026-09-17", 2.5);
  assert.equal(v1.verdict, "monte"); // comportement voulu : le verdict reste calculé
  assert.equal(v1.cible, 82.5);
  assert.equal(v1.rpeAuto, true);    // mais l'affichage porte « RPE non renseigné »
  const v2 = verdictProgression(choisi, "Row", "2026-09-17", 2.5);
  assert.equal(v2.verdict, "monte");
  assert.equal(v2.rpeAuto, false);   // 7 choisi à la main est une mesure
  // une seule série automatique parmi des séries notées : plus de mention
  const melange = [...auto.slice(0, 1), { ...base, id: "m", rpe: 9 }];
  assert.equal(verdictProgression(melange, "Row", "2026-09-17", 2.5).rpeAuto, false);
});

test("exercices et pas du plan : créés une fois, jamais écrasés", () => {
  const p = plan();
  const exercises = ["Row", "PullDown", "Tirage vertical serré"];
  assert.deepEqual(manquesDuPlan(p, exercises, {}), [{ nom: "Hack squat", creer: true, pas: 5 }]);
  // exercice déjà connu, pas déjà réglé à la main : plus rien à faire
  assert.deepEqual(manquesDuPlan(p, [...exercises, "Hack squat"], { "Hack squat": 2.5 }), []);
  // exercice connu mais sans pas : seul le pas est posé
  assert.deepEqual(manquesDuPlan(p, [...exercises, "Hack squat"], {}), [{ nom: "Hack squat", creer: false, pas: 5 }]);
});

test("prévu contre fait : 8 prévues, 12 faites le 17/09", () => {
  const d = carnet20();
  const resume = planPrevuFait(plan(), d.sessions, DATE);
  assert.deepEqual(resume, { prevues: 8, faites: 12, conforme: false });
  const daily = poserPlanFait(d.daily, DATE, resume);
  assert.deepEqual(daily.find((x) => x.date === DATE).plan, resume);
  assert.equal(daily.find((x) => x.date === DATE).repas, "19:35");       // le reste de la ligne est conservé
  assert.equal(d.daily.find((x) => x.date === DATE).plan, undefined);    // tableau reçu non modifié
  // ligne créée si la date n'en a pas encore, et retirée si on efface le résumé
  const neuf = poserPlanFait([], "2026-09-21", { prevues: 6, faites: 6, conforme: true });
  assert.deepEqual(neuf, [{ date: "2026-09-21", plan: { prevues: 6, faites: 6, conforme: true } }]);
  assert.deepEqual(poserPlanFait(neuf, "2026-09-21", null), []);
  // conforme quand le prescrit est fait exactement
  const pile = lirePlan({ date: DATE, seance: { exercices: [{ nom: "Row", series: 3 }, { nom: "PullDown", series: 3 }, { nom: "Tirage vertical serré", series: 3 }, { nom: "Pulley", series: 3 }] } });
  assert.deepEqual(planPrevuFait(pile, d.sessions, DATE), { prevues: 12, faites: 12, conforme: true });
});

test("export : les nouvelles colonnes sont présentes et remplies", () => {
  const d = carnet20();
  d.daily = poserPlanFait(d.daily, DATE, { prevues: 8, faites: 12, conforme: false });
  d.daily = d.daily.map((x) => x.date === DATE ? { ...x, decision: { ...x.decision, par: "coach" } } : x);
  d.sessions = d.sessions.map((s) => s.date === DATE ? { ...s, rpeAuto: true } : s);
  const l = ligneJour(d, DATE);
  assert.deepEqual([l.plan_prevues, l.plan_faites, l.plan_conforme], [8, 12, false]);
  assert.equal(l.decision_par, "coach");
  assert.equal(l.rpe_auto, 12);
  const entete = exportDerive(d).split("\n")[0].split(";");
  for (const c of ["decision_par", "rpe_auto", "plan_prevues", "plan_faites", "plan_conforme"]) assert.ok(entete.includes(c), c);
});
