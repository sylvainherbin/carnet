import { test } from "node:test";
import assert from "node:assert/strict";
import { lire } from "./aide.js";
import { parseFcFile, fenetreSeance, resumeSeance, recupSerie, recuperationSeance, recupDefinitive, fcSerieExport, COLONNES_FC_SERIE } from "../src/calculs.js";

// ---- Données réelles : séance du 09/10/2026 (copies figées) ----------------
// Valeurs attendues relevées à la main dans les échantillons bruts du fichier
// fc/, pas tirées de la fonction testée.
const echantillons = (raw) => parseFcFile(raw).filter((s) => s.ms > 0 && s.bpm > 20 && s.bpm < 250).sort((a, b) => a.ms - b.ms);
const reel = () => {
  const data = lire("carnet-data-2026-10-09.json");
  const samples = echantillons(lire("fc/2026-10-09-1204.json"));
  return { data, samples, r: recuperationSeance(samples, data.sessions, data.treadmill, "2026-10-09") };
};
const ligne = (r, id) => r.lignes.find((l) => l.id === id);

test("récup réelle : pic après la validation (Leg press, +24 s), distinct du pic de bloc", () => {
  const { data, r } = reel();
  // 10:58:15 129 bpm, validation 10:57:51.131 ; +30 s : 112 et 111 → 112 ; +60 s : 99 et 98 → 99
  assert.deepEqual(r.recup.find((x) => x.id === "ftz2neul"), { id: "ftz2neul", pic: 129, t: 24, f30: 112, f60: 99, ctx: "meme_exercice" });
  const bloc = data.durations.find((x) => x.date === "2026-10-09").pics.find((p) => p.id === "ftz2neul").pic;
  assert.equal(bloc, 121); // l'ancien pic de bloc manque le sommet tombé après la validation
});

test("récup réelle : pic avant la validation (Leg extension, −8 s)", () => {
  const { r } = reel();
  // 11:34:04 132 bpm, validation 11:34:11.672 ; +30 s : 124 et 122 → 123 ; +60 s : 107 et 106 → 107
  assert.deepEqual(r.recup.find((x) => x.id === "2lmtvsf3"), { id: "2lmtvsf3", pic: 132, t: -8, f30: 123, f60: 107, ctx: "meme_exercice" });
});

test("récup réelle : transition d'exercice gardée avec son contexte, mesure signée", () => {
  const { r } = reel();
  // Leg press → Hack squat : 123 bpm à 11:06:37 ; +60 s : 117, 125, 126 → 123 (la FC remonte en changeant de machine)
  assert.deepEqual(r.recup.find((x) => x.id === "sgh37ugk"), { id: "sgh37ugk", pic: 123, t: 21, f30: 116, f60: 123, ctx: "transition" });
});

test("récup réelle : trou de mesure → null, avec son motif", () => {
  const { r } = reel();
  // Hack squat 30×10 : pic 125 à 11:15:27, puis aucun échantillon de 11:15:36 à 11:16:12 (36 s)
  assert.equal(r.recup.find((x) => x.id === "0jmvdt75"), undefined);
  assert.deepEqual(ligne(r, "0jmvdt75"), { id: "0jmvdt75", ctx: "meme_exercice", pic: 125, t: -8, motif: "trou de mesure" });
});

test("récup réelle : dernière série sans FC après elle → null, séance non complète", () => {
  const { r } = reel();
  // le fichier s'arrête à 12:03:44, 8 s après la dernière validation
  assert.equal(ligne(r, "gszej396").motif, "pas de mesure à +60 s");
  assert.equal(ligne(r, "gszej396").ctx, "fin_seance");
  assert.equal(r.complet, false);
});

test("récup réelle : les pics de bloc existants ne changent pas", () => {
  const { data, samples } = reel();
  const w = fenetreSeance(data.sessions, data.treadmill, "2026-10-09");
  const stocke = data.durations.find((x) => x.date === "2026-10-09");
  assert.deepEqual(resumeSeance(samples, w, "2026-10-09").pics, stocke.pics);
  assert.deepEqual(stocke.pics.map((p) => p.pic), [121, 129, 114, 138, 130, 129, 133, 132, 130, 129, 120, 117, 124, 126, 124, 120]);
});

// ---- Cas synthétiques : instants numériques, sans fuseau --------------------
const AT = 1_800_000_000_000;
const D = "2026-01-10";
const serie = (id, at, ex = "X", sets = [{ kg: 50, reps: 10 }]) => ({ id, date: D, exercise: ex, sets, at });
// Échantillons toutes les 5 s de at−100 s à at+150 s. Montée linéaire de 90
// (at−40 s) au pic de 130 (at+p s), puis −0,4 bpm/s jusqu'à 95.
const profil = (p, at = AT) => {
  const v = [];
  for (let o = -100; o <= 150; o += 5) {
    const bpm = o < -40 ? 90 : o <= p ? 90 + (40 * (o + 40)) / (p + 40) : Math.max(95, 130 - 0.4 * (o - p));
    v.push({ ms: at + o * 1000, bpm });
  }
  return v;
};
const avec = (smp, o, bpm) => smp.map((x) => (x.ms === AT + o * 1000 ? { ...x, bpm } : x));

test("synthèse : pic avant la validation, FC à +30 et +60 s", () => {
  // pic 130 à −10 s ; +30 s : 120, 118, 116 → 118 ; +60 s : 108, 106, 104 → 106
  assert.deepEqual(recupSerie(profil(-10), serie("a", AT), null, serie("b", AT + 300000)), { ctx: "meme_exercice", pic: 130, t: -10, f30: 118, f60: 106 });
});

test("synthèse : pic après la validation", () => {
  assert.deepEqual(recupSerie(profil(20), serie("a", AT), null, serie("b", AT + 300000)), { ctx: "meme_exercice", pic: 130, t: 20, f30: 118, f60: 106 });
});

test("synthèse : pics multiples", () => {
  // deux sommets égaux : le dernier ouvre la descente (+5 s) ; +35 s : 114, 112, 110 → 112 ; +65 s : 102, 100, 98 → 100
  assert.deepEqual(recupSerie(avec(profil(-10), 5, 130), serie("a", AT), null, null), { ctx: "fin_seance", pic: 130, t: 5, f30: 112, f60: 100 });
  // pic à +40 s dans la fenêtre, mais 133 à +55 s : la FC montait encore
  assert.equal(recupSerie(avec(profil(40), 55, 133), serie("a", AT), null, null).motif, "pic non établi");
  // rebond après +30 s (129 à +45 s, puis 133 et 132 hors fenêtre de pic) :
  // mesure gardée, signée ; +60 s : 129, 133, 132 → 131 > pic
  const rebond = [[45, 129], [50, 133], [55, 132]].reduce((s, [o, b]) => avec(s, o, b), profil(-10));
  assert.deepEqual(recupSerie(rebond, serie("a", AT), null, null), { ctx: "fin_seance", pic: 130, t: -10, f30: 118, f60: 131 });
});

test("synthèse : série suivante trop proche", () => {
  // pic à −10 s, +60 s = at+50 s ; la suivante validée à +100 s commence vers +40 s
  assert.equal(recupSerie(profil(-10), serie("a", AT), null, serie("b", AT + 100000)).motif, "série suivante trop proche");
});

test("synthèse : trou de mesure, FC manquante, FC aberrante", () => {
  const trou = profil(-10).filter((x) => !(x.ms > AT + 15000 && x.ms < AT + 40000)); // 25 s sans mesure
  assert.equal(recupSerie(trou, serie("a", AT), null, null).motif, "trou de mesure");
  assert.equal(recupSerie([], serie("a", AT), null, null).motif, "FC absente");
  const pointe = [...profil(-10), { ms: AT - 22000, bpm: 175 }].sort((a, b) => a.ms - b.ms);
  assert.equal(recupSerie(pointe, serie("a", AT), null, null).motif, "pic isolé (artefact)");
});

test("synthèse : changement d'exercice, pause longue, tapis intercalé", () => {
  assert.deepEqual(recupSerie(profil(-10), serie("a", AT), null, serie("b", AT + 300000, "Y")), { ctx: "transition", pic: 130, t: -10, f30: 118, f60: 106 });
  assert.deepEqual(recupSerie(profil(-10), serie("a", AT), null, serie("b", AT + 1200000)), { ctx: "meme_exercice", pic: 130, t: -10, f30: 118, f60: 106 });
  assert.equal(recupSerie(profil(-10), serie("a", AT), null, null, [[AT + 30000, AT + 600000]]).motif, "tapis");
});

test("synthèse : la queue de la série précédente ne passe pas pour le pic", () => {
  // série précédente validée à −100 s : sa queue vaut 136 à −60 s ; la fenêtre
  // commence à précédente + 45 s = −55 s, où elle n'est plus qu'à 122.
  const smp = [];
  for (let o = -100; o <= 150; o += 5) {
    const queue = { [-70]: 140, [-65]: 138, [-60]: 136, [-55]: 122, [-50]: 110 }[o];
    const bpm = queue ?? (o < -45 ? 140 : o <= -5 ? 100 + (25 * (o + 45)) / 40 : 125 - 0.4 * (o + 5));
    smp.push({ ms: AT + o * 1000, bpm });
  }
  // pic 125 à −5 s ; +30 s : 115, 113, 111 → 113 ; +60 s : 103, 101, 99 → 101
  assert.deepEqual(recupSerie(smp, serie("a", AT), serie("p", AT - 100000), null), { ctx: "fin_seance", pic: 125, t: -5, f30: 113, f60: 101 });
});

test("synthèse : séance — dernière série, doublons, entrées anciennes", () => {
  const sessions = [serie("a", AT), serie("b", AT + 300000), serie("vieux", undefined, "X", [{ kg: 50, reps: 10 }, { kg: 50, reps: 8 }])];
  const smp = [...profil(-10), ...profil(-10, AT + 300000)].sort((a, b) => a.ms - b.ms);
  const r = recuperationSeance(smp, sessions, [], D);
  assert.deepEqual(r.recup.map((x) => [x.id, x.ctx]), [["a", "meme_exercice"], ["b", "fin_seance"]]);
  assert.equal(r.complet, true); // FC jusqu'à +150 s après la dernière validation
  assert.equal(r.lignes.length, 2); // l'entrée sans heure n'a pas de ligne
  // fichiers redéposés : chaque échantillon en double, même résultat
  const double = [...smp, ...smp].sort((a, b) => a.ms - b.ms);
  assert.deepEqual(recuperationSeance(double, sessions, [], D).recup, r.recup);
  // entrée multi-séries horodatée : pas de récupération par série
  const multi = recuperationSeance(smp, [serie("m", AT, "X", [{ kg: 50, reps: 10 }, { kg: 50, reps: 8 }])], [], D);
  assert.deepEqual(multi.lignes, [{ id: "m", ctx: "fin_seance", motif: "plusieurs séries ou sans heure" }]);
  assert.deepEqual(multi.recup, []);
  // aucune saisie horodatée, ou aucune FC dans la séance : rien à calculer
  assert.equal(recuperationSeance(smp, [sessions[2]], [], D), null);
  assert.equal(recuperationSeance([], sessions, [], D), null);
});

test("recalcul historique : quand le calcul devient définitif", () => {
  const complet = { recup: [], complet: true }, partiel = { recup: [], complet: false };
  assert.equal(recupDefinitive(complet, "2026-10-09", "2026-10-09", false), true);
  // FC incomplète : définitif seulement une fois le lendemain passé
  assert.equal(recupDefinitive(partiel, "2026-10-07", "2026-10-09", false), true);
  assert.equal(recupDefinitive(partiel, "2026-10-08", "2026-10-09", false), false);
  // FC absente, ou lecture en échec : jamais définitif
  assert.equal(recupDefinitive(null, "2026-09-01", "2026-10-09", false), false);
  assert.equal(recupDefinitive(complet, "2026-09-01", "2026-10-09", true), false);
});

test("export par série : colonnes FC distinctes, vides plutôt que zéro", () => {
  assert.deepEqual(COLONNES_FC_SERIE, ["fc_pic_bloc", "fc_pic_fin", "fc_tpic_fin_s", "fc30_fin", "fc60_fin", "drop30", "drop60", "fc_contexte"]);
  const durations = [{ date: D, pics: [{ id: "a", pic: 121 }, { id: "b", pic: 110 }], recup: [{ id: "a", pic: 129, t: 24, f30: 112, f60: 99, ctx: "meme_exercice" }, { id: "c", pic: 123, t: 21, f30: null, f60: 125, ctx: "transition" }] }];
  assert.deepEqual(fcSerieExport(durations, serie("a", AT)), [121, 129, 24, 112, 99, 17, 30, "meme_exercice"]);
  assert.deepEqual(fcSerieExport(durations, serie("b", AT)), [110, "", "", "", "", "", "", ""]);
  assert.deepEqual(fcSerieExport(durations, serie("c", AT)), ["", 123, 21, "", 125, "", -2, "transition"]);
  assert.deepEqual(fcSerieExport(durations, serie("a", AT, "X", [{ kg: 1, reps: 1 }, { kg: 1, reps: 1 }])), ["", "", "", "", "", "", "", ""]);
});
