// Calculs purs du Carnet : aucune dépendance à React ni au DOM. Tout ce qui
// transforme les données en chiffres vit ici, pour être testé hors navigateur
// (scripts Node sur carnet-data.json) et partagé par l'export dérivé.

export const pad = (n) => String(n).padStart(2, "0");
export const GROUPS = ["Pecs", "Dos", "Jambes", "Épaules", "Bras", "Autre"];
export const e1rm = (kg, reps) => (reps === 1 ? kg : kg * (1 + reps / 30));

// ---- Estimation des calories (nécessite le poids corporel, onglet Poids) ----
// Tapis : équations ACSM marche (<8 km/h) / course, VO2 en ml/kg/min, 5 kcal par litre d'O2.
// Muscu : modèle travail/repos — ~6 MET pendant les séries (~40 s chacune), ~2 MET entre.
// Le temps de muscu vient, par ordre de préférence : des horodatages de saisie en direct
// (mode formulaire ; pauses plafonnées à 10 min pour absorber un tapis ou une interruption
// au milieu), de la durée saisie moins le tapis, ou à défaut de 3 min par série.
export const MET_TRAVAIL = 6, MET_REPOS = 2, SEC_PAR_SERIE = 40, PAUSE_MAX = 10, MIN_PAR_SERIE = 3;

// Le raccourci iOS dépose deux formats dans fc/. Le premier, historique, est un
// tableau de paires {t, bpm} construit par une boucle « Répéter avec chaque
// élément » — inutilisable dès qu'un vrai entraînement porte le nombre de mesures
// à plusieurs centaines, la boucle n'aboutissant plus. Le second, compact, est
// { t, b } : deux chaînes parallèles séparées par « | », produites d'un coup par
// « Combiner le texte » sur la liste entière. On lit les deux.
export const parseMs = (s) => {
  const str = String(s).trim();
  // Horodatage ISO à fuseau explicite (ancien format) : Date.parse suffit.
  if (/[Zz]$|[+-]\d\d:?\d\d$/.test(str)) return Date.parse(str);
  // « AAAA-MM-JJ HH:MM:SS » sans fuseau : c'est l'heure locale de la montre, que
  // WebKit refuse de parser tel quel. On construit la date explicitement, ce qui
  // la rend comparable aux horodatages de saisie, eux aussi locaux.
  const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(str);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN;
};
export const parseFcFile = (raw) => {
  let rows;
  if (Array.isArray(raw)) rows = raw.map((s) => [s.t, s.bpm]);
  else {
    const ts = String(raw?.t ?? "").split("|"), bs = String(raw?.b ?? "").split("|");
    rows = ts.map((t, i) => [t, bs[i]]);
  }
  return rows.map(([t, b]) => ({
    ms: parseMs(t),
    day: String(t).trim().slice(0, 10),
    bpm: Number(String(b).replace(",", ".").replace(/[^0-9.]/g, "")),
  }));
};

// Courbe conservée avec la séance : une moyenne par tranche de 30 s, soit ~150
// points pour une heure d'entraînement. Assez fin pour lire la forme de l'effort,
// assez léger pour voyager dans le fichier de synchronisation (~600 octets).
export const FC_PAS = 30000;
export const courbeFc = (arr) => {
  const t0 = Math.floor(arr[0].ms / FC_PAS) * FC_PAS;
  const seaux = [];
  arr.forEach((s) => { const i = Math.floor((s.ms - t0) / FC_PAS); (seaux[i] ||= []).push(s.bpm); });
  const n = Math.floor((arr[arr.length - 1].ms - t0) / FC_PAS) + 1;
  return { t0, v: Array.from({ length: n }, (_, i) => (seaux[i] ? Math.round(seaux[i].reduce((a, b) => a + b, 0) / seaux[i].length) : null)) };
};

// ---- Relevé quotidien : la nuit ----
// Le raccourci de midi dépose la FC depuis minuit et la VFC du jour, sous la
// même forme compacte que fc/ : { fc_t, fc, vfc }, chaînes « | ». Les premiers
// fichiers portaient à la place la « FC de repos » d'Apple (repos), une moyenne
// de journée sans rapport avec la nuit — gardée à titre d'archive. Les phases
// de sommeil (som_d, som_f, som_v : début, fin, phase) sont prévues ; tant
// qu'elles manquent, la nuit est prise entre minuit et NUIT_FIN heures.
export const NUIT_FIN = 7;
export const splitNum = (s) => String(s ?? "").split("|").map((x) => Number(String(x).replace(",", ".").replace(/[^0-9.]/g, ""))).filter((x) => x > 0);
export const mediane = (v) => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const localMs = (iso, h = 0) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, h).getTime(); };
// Segments de sommeil : dort = vrai hors « éveillé » et « au lit ». Les libellés
// viennent de Santé dans la langue du téléphone ; on reconnaît les deux états à
// exclure et on tient tout le reste (léger, profond, paradoxal, « endormi ») pour
// du sommeil, ce qui reste juste si Apple en ajoute un.
export const parseSommeil = (raw) => {
  if (!raw?.som_d) return [];
  const ds = String(raw.som_d).split("|"), fs = String(raw.som_f ?? "").split("|"), vs = String(raw.som_v ?? "").split("|");
  return ds.map((d, i) => ({ from: parseMs(d), to: parseMs(fs[i]), dort: !/éveil|awake|au lit|in bed/i.test(vs[i] || "") }))
    .filter((p) => p.from > 0 && p.to > p.from);
};
export const resumeNuit = (raw, date) => {
  const fc = parseFcFile({ t: raw?.fc_t ?? "", b: raw?.fc ?? "" }).filter((s) => s.ms > 0 && s.bpm > 20 && s.bpm < 250);
  const som = parseSommeil(raw);
  const dort = som.filter((p) => p.dort);
  const plages = dort.length ? dort.map((p) => [p.from, p.to]) : [[localMs(date), localMs(date, NUIT_FIN)]];
  const nuit = fc.filter((s) => plages.some(([a, b]) => s.ms >= a && s.ms <= b)).map((s) => s.bpm);
  const rec = { date, n: nuit.length };
  if (nuit.length) {
    rec.min = Math.round(Math.min(...nuit));
    rec.moy = Math.round(nuit.reduce((a, b) => a + b, 0) / nuit.length);
  }
  const vfc = splitNum(raw?.vfc);
  if (vfc.length) { rec.vfc = Math.round(mediane(vfc) * 10) / 10; rec.vfcN = vfc.length; }
  const repos = Number(raw?.repos);
  if (repos > 0) rec.repos = Math.round(repos);
  if (dort.length) {
    rec.dodo = Math.round(dort.reduce((a, p) => a + (p.to - p.from), 0) / 60000);
    rec.coucher = Math.min(...dort.map((p) => p.from));
    rec.lever = Math.max(...dort.map((p) => p.to));
  }
  return rec;
};

// Pendant un entraînement, la montre mesure la FC en continu (~5 s) ; au repos,
// seulement toutes les quelques minutes, avec de brèves rafales opportunistes.
// La plus longue plage à cadence serrée est donc la séance. Le seuil de 10 min
// écarte ces rafales : faute de plage assez longue, on préfère ne rien conclure.
export const denseRun = (samples) => {
  let best = [], run = [];
  const close = () => {
    const span = run.length ? run[run.length - 1].ms - run[0].ms : 0;
    if (span >= 10 * 60000 && span > (best.length ? best[best.length - 1].ms - best[0].ms : 0)) best = run;
  };
  samples.forEach((s, i) => {
    if (i > 0 && s.ms - samples[i - 1].ms <= 60000) run.push(s);
    else { close(); run = [s]; }
  });
  close();
  return best;
};
export const weightFor = (weights, date) => {
  const w = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const past = w.filter((x) => x.date <= date);
  return (past[past.length - 1] || w[0])?.kg || null;
};
export const kcalTapis = (t, kg) => {
  if (!(t.min > 0 && t.km > 0)) return 0;
  const S = (t.km * 1000) / t.min, g = (t.slope || 0) / 100;
  const vo2 = S >= 134 ? 3.5 + 0.2 * S + 0.9 * S * g : 3.5 + 0.1 * S + 1.8 * S * g;
  return (vo2 * kg / 200) * t.min;
};
export const kcalSeance = (data, date) => {
  const kg = weightFor(data.weights, date);
  if (!kg) return null;
  const tread = data.treadmill.filter((t) => t.date === date);
  const tKcal = tread.reduce((a, t) => a + kcalTapis(t, kg), 0);
  const tMin = tread.reduce((a, t) => a + (t.min || 0), 0);
  const entries = data.sessions.filter((s) => s.date === date);
  const nSets = entries.reduce((a, s) => a + s.sets.length, 0);
  const meta = data.durations.find((x) => x.date === date) || {};
  const ts = entries.map((s) => s.at).filter(Boolean).sort((a, b) => a - b);
  const span = ts.length >= 2 ? (ts[ts.length - 1] - ts[0]) / 60000 : 0;
  let mMin, mode;
  if (span >= 10) {
    mMin = MIN_PAR_SERIE; // amorce : la première série précède son enregistrement
    for (let i = 1; i < ts.length; i++) mMin += Math.min((ts[i] - ts[i - 1]) / 60000, PAUSE_MAX);
    // Le trajet vers le tapis, ou le retour, sépare deux chronos et ne tombait
    // dans aucun des deux. Plafonné comme une pause entre séries : un tapis fait
    // le soir ne doit pas gonfler la séance du matin. Un tapis intercalé au
    // milieu de la muscu est déjà couvert par la boucle ci-dessus.
    const debut = ts[0] - MIN_PAR_SERIE * 60000, fin = ts[ts.length - 1];
    tread.forEach((t) => {
      if (!(t.at0 > 0 && t.min > 0)) return;
      if (t.at0 >= fin) mMin += Math.min((t.at0 - fin) / 60000, PAUSE_MAX);
      else if (t.at0 + t.min * 60000 <= debut) mMin += Math.min((debut - t.at0 - t.min * 60000) / 60000, PAUSE_MAX);
    });
    mode = "chrono";
  } else if (meta.min > 0) { mMin = Math.max(0, meta.min - tMin); mode = "saisies"; }
  else { mMin = nSets * MIN_PAR_SERIE; mode = "estimées"; }
  const workMin = Math.min((nSets * SEC_PAR_SERIE) / 60, mMin);
  const mKcal = nSets > 0 ? (3.5 * kg / 200) * (MET_TRAVAIL * workMin + MET_REPOS * (mMin - workMin)) : 0;
  if (mKcal + tKcal === 0) return null;
  return { total: Math.round(mKcal + tKcal), muscu: Math.round(mKcal), tapis: Math.round(tKcal),
    mMin: Math.round(mMin), mode, kg, hr: meta.hr || null, hrMax: meta.hrMax || null, watch: meta.watch || null };
};
export const num = (v) => (v === "" || v === null || isNaN(Number(v)) ? 0 : Number(v));
export const isoWeek = (iso) => {
  const d = new Date(iso + "T12:00:00"); const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3); const firstThu = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-S${pad(week)}`;
};

// ---- Décisions de séance --------------------------------------------------
// Règle du coach : toutes les séries de travail d'un exercice à RPE ≤ 7, on
// monte la charge d'un cran ; toutes à RPE ≥ 9, on la redescend ; sinon on
// reste. Le verdict porte sur la dernière séance de l'exercice antérieure à la
// date visée, et sur ses séries à la charge de travail — le poids le plus
// utilisé, le plus lourd à égalité, ce qui écarte un échauffement plus léger.
// Il faut au moins deux séries notées : une seule ne dit rien de la fatigue.
export const PAS_DEFAUT = 5;
const chargeTravail = (sets) => {
  const c = new Map();
  sets.forEach((x) => c.set(x.kg, (c.get(x.kg) || 0) + 1));
  return [...c].sort((u, v) => v[1] - u[1] || v[0] - u[0])[0][0];
};
export const verdictProgression = (sessions, exercise, avant, pas = PAS_DEFAUT) => {
  const prev = sessions.filter((s) => s.exercise === exercise && s.date < avant);
  if (prev.length === 0) return null;
  const date = prev.map((s) => s.date).sort().pop();
  const sets = prev.filter((s) => s.date === date).flatMap((s) => s.sets.map((x) => ({ ...x, rpe: s.rpe })));
  const kg = chargeTravail(sets);
  const rpes = sets.filter((x) => x.kg === kg && x.rpe > 0).map((x) => x.rpe);
  const base = { exercise, date, kg, rpes, pas };
  if (rpes.length < 2) return { ...base, verdict: "?", cible: kg, motif: rpes.length ? "une seule série notée" : "RPE non saisi" };
  if (rpes.every((r) => r <= 7)) return { ...base, verdict: "monte", cible: kg + pas };
  if (rpes.every((r) => r >= 9)) return { ...base, verdict: "descend", cible: Math.max(0, kg - pas) };
  return { ...base, verdict: "reste", cible: kg };
};

// Plafond du coach : douze séries par groupe musculaire et par séance.
export const SERIES_MAX = 12;
export const seriesParGroupe = (sessions, date) => {
  const m = {};
  sessions.filter((s) => s.date === date).forEach((s) => { m[s.group] = (m[s.group] || 0) + s.sets.length; });
  return m;
};

// Meilleur e1RM jamais atteint sur l'exercice (jusqu'à une date incluse si donnée).
export const recordE1rm = (sessions, exercise, jusqua) =>
  Math.max(0, ...sessions.filter((s) => s.exercise === exercise && (!jusqua || s.date <= jusqua)).flatMap((s) => s.sets.map((x) => e1rm(x.kg, x.reps))));

// ---- Export dérivé : une ligne par jour ----------------------------------
// Le tableau que lit le coach : tonnage et séries par groupe, RPE, FC de séance,
// kcal, tapis, nuit, poids, notes. Mêmes fonctions que l'app, donc mêmes chiffres.
export const ligneJour = (data, date) => {
  const ss = data.sessions.filter((s) => s.date === date);
  const l = { date, groupes: [...new Set(ss.map((s) => s.group))].join("+"), series: 0, tonnage: 0 };
  GROUPS.forEach((g) => {
    const sg = ss.filter((s) => s.group === g);
    l[`series_${g}`] = sg.reduce((a, s) => a + s.sets.length, 0);
    l[`tonnage_${g}`] = Math.round(sg.reduce((a, s) => a + s.sets.reduce((b, x) => b + x.kg * x.reps, 0), 0));
    l.series += l[`series_${g}`]; l.tonnage += l[`tonnage_${g}`];
  });
  const rpes = ss.filter((s) => s.rpe > 0).flatMap((s) => s.sets.map(() => s.rpe));
  l.rpe_moy = rpes.length ? +(rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1) : "";
  l.rpe_max = rpes.length ? Math.max(...rpes) : "";
  const meta = data.durations.find((x) => x.date === date) || {};
  l.fc_seance = meta.hr || ""; l.fc_max = meta.hrMax || "";
  const kcal = kcalSeance(data, date);
  l.kcal = kcal ? kcal.total : ""; l.kcal_montre = meta.watch || "";
  const tap = data.treadmill.filter((t) => t.date === date);
  l.tapis_min = tap.reduce((a, t) => a + (t.min || 0), 0) || "";
  l.tapis_km = +tap.reduce((a, t) => a + (t.km || 0), 0).toFixed(2) || "";
  const nuit = (data.daily || []).find((d) => d.date === date) || {};
  l.nuit_fc_min = nuit.min ?? ""; l.nuit_fc_moy = nuit.moy ?? ""; l.nuit_n = nuit.n ?? ""; l.vfc = nuit.vfc ?? ""; l.sommeil_min = nuit.dodo ?? "";
  l.poids = data.weights.find((w) => w.date === date)?.kg ?? "";
  l.notes = ss.map((s) => s.note).filter(Boolean).join(" / ");
  return l;
};
export const exportDerive = (data) => {
  const dates = [...new Set([...data.sessions, ...data.treadmill, ...data.weights, ...(data.daily || [])].map((x) => x.date))].sort();
  const rows = dates.map((d) => ligneJour(data, d));
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v) => { const t = String(v ?? ""); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [cols.join(";"), ...rows.map((r) => cols.map((c) => cell(r[c])).join(";"))].join("\n");
};
