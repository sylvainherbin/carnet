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
// Version de la méthode de résumé. Un relevé déjà résumé avec une version plus
// ancienne est repassé à l'ouverture pour gagner les champs ajoutés depuis
// (v2 : hMin ; v3 : nuit restreinte au dernier bloc de sommeil ; v4 : VFC
// limitée au sommeil quand vfc_t existe, respiration, SpO2 et température du
// poignet). Les champs saisis à la main (repas, decision) sont conservés.
export const NUIT_VERSION = 4;
// Deux segments de sommeil séparés de plus de NUIT_TROU heures appartiennent à
// deux nuits différentes.
export const NUIT_TROU = 4;
export const splitNum = (s) => String(s ?? "").split("|").map((x) => Number(String(x).replace(",", ".").replace(/[^0-9.]/g, ""))).filter((x) => x > 0);
export const mediane = (v) => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const lendemain = (iso) => { const [y, m, d] = iso.split("-").map(Number); const x = new Date(y, m - 1, d + 1); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
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
// Le raccourci peut remonter plus d'une nuit de segments : on ne garde que le
// dernier bloc contigu — segments triés par début, coupure là où le trou entre
// la fin d'un segment et le début du suivant dépasse NUIT_TROU heures.
export const derniereNuit = (som) => {
  const tri = [...som].sort((a, b) => a.from - b.from);
  let bloc = [];
  tri.forEach((p) => { if (bloc.length && p.from - bloc[bloc.length - 1].to > NUIT_TROU * 3600000) bloc = []; bloc.push(p); });
  return bloc;
};
// Série horodatée du relevé (deux chaînes « | » parallèles), restreinte aux
// plages données ; les valeurs non numériques ou nulles sont écartées.
const paires = (ts, vs, plages) => {
  if (!ts || !vs) return [];
  const t = String(ts).split("|"), v = String(vs).split("|");
  return t.map((x, i) => ({ ms: parseMs(x), v: Number(String(v[i] ?? "").replace(",", ".").replace(/[^0-9.]/g, "")) }))
    .filter((p) => p.ms > 0 && p.v > 0 && plages.some(([a, b]) => p.ms >= a && p.ms <= b));
};
export const resumeNuit = (raw, date) => {
  const fc = parseFcFile({ t: raw?.fc_t ?? "", b: raw?.fc ?? "" }).filter((s) => s.ms > 0 && s.bpm > 20 && s.bpm < 250);
  const som = derniereNuit(parseSommeil(raw));
  const dort = som.filter((p) => p.dort);
  const plages = dort.length ? dort.map((p) => [p.from, p.to]) : [[localMs(date), localMs(date, NUIT_FIN)]];
  const nuit = fc.filter((s) => plages.some(([a, b]) => s.ms >= a && s.ms <= b));
  const rec = { date, v: NUIT_VERSION, n: nuit.length };
  if (nuit.length) {
    const bpm = nuit.map((s) => s.bpm);
    rec.min = Math.round(Math.min(...bpm));
    rec.moy = Math.round(bpm.reduce((a, b) => a + b, 0) / bpm.length);
    // Heure à laquelle le plancher est atteint pour la première fois. Santé rend
    // parfois des valeurs fractionnaires (51,6) : on compare les valeurs arrondies,
    // pour que l'heure corresponde au minimum tel qu'il est affiché.
    const premier = nuit.find((s) => Math.round(s.bpm) === rec.min);
    const d = new Date(premier.ms);
    rec.hMin = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  // VFC : Santé mesure aussi le jour, et la valeur de jour vaut la moitié de
  // celle de nuit. Avec les horodatages (vfc_t, raccourci v2), on ne garde que
  // les mesures faites pendant le sommeil ; sans, on prend tout le relevé.
  const vfcNuit = paires(raw?.vfc_t, raw?.vfc, plages).map((p) => p.v);
  const vfc = vfcNuit.length ? vfcNuit : splitNum(raw?.vfc);
  if (vfc.length) { rec.vfc = Math.round(mediane(vfc) * 10) / 10; rec.vfcN = vfc.length; }
  // Fréquence respiratoire et SpO2 pendant le sommeil (raccourci v2).
  const resp = paires(raw?.resp_t, raw?.resp, plages).map((p) => p.v);
  if (resp.length) { rec.resp = Math.round(mediane(resp) * 10) / 10; rec.respN = resp.length; }
  const spo2 = paires(raw?.spo2_t, raw?.spo2, plages).map((p) => p.v);
  if (spo2.length) { rec.spo2 = Math.round(mediane(spo2)); rec.spo2Min = Math.round(Math.min(...spo2)); }
  // Température du poignet : une mesure absolue par nuit (°C), horodatée au
  // début du suivi de sommeil, parfois avant le premier segment. On prend la
  // dernière tombée entre six heures avant le coucher et le lever ; l'écart à
  // la référence personnelle se calcule ensuite sur l'historique (ecartTemp).
  const debut = Math.min(...plages.map((p) => p[0])), fin = Math.max(...plages.map((p) => p[1]));
  const temp = paires(raw?.temp_t, raw?.temp, [[debut - 6 * 3600000, fin]]).sort((a, b) => a.ms - b.ms);
  if (temp.length) rec.temp = Math.round(temp[temp.length - 1].v * 100) / 100;
  const repos = Number(raw?.repos);
  if (repos > 0) rec.repos = Math.round(repos);
  if (dort.length) {
    rec.dodo = Math.round(dort.reduce((a, p) => a + (p.to - p.from), 0) / 60000);
    rec.coucher = som[0].from;
    rec.lever = som[som.length - 1].to;
  }
  return rec;
};
// Rapproche un résumé frais d'une entrée déjà en place : les champs calculés
// viennent tous du résumé frais (une nouvelle version peut changer la fenêtre
// de nuit, donc tout ce qui en découle), les champs saisis à la main sont
// repris de l'entrée existante. Une entrée sans relevé (n absent : créée par
// une saisie manuelle, comme l'heure du dernier repas) est complétée de même.
// repas : heure de fin du dernier repas ; decision : { d, regle, motif }, la
// décision du matin telle que le coach l'a prise — l'app n'applique aucune règle.
export const CHAMPS_MANUELS = ["repas", "decision"];
export const fusionNuit = (existant, frais) => {
  const x = { ...frais };
  CHAMPS_MANUELS.forEach((k) => { if (existant[k] !== undefined) x[k] = existant[k]; });
  return x;
};
export const nuitAJour = (existant) => existant.n !== undefined && (existant.v || 1) >= NUIT_VERSION;
// Écart de la température du poignet à la référence personnelle : la médiane
// des TEMP_REF_NUITS nuits précédentes qui en ont une, à partir de
// TEMP_REF_MIN valeurs. Santé affiche le même genre d'écart, mais sur une
// référence qu'il ne montre pas ; ici elle est recalculable.
export const TEMP_REF_NUITS = 28, TEMP_REF_MIN = 5;
export const ecartTemp = (daily, date) => {
  const x = daily.find((d) => d.date === date);
  if (!(x?.temp > 0)) return null;
  const ref = daily.filter((d) => d.date < date && d.temp > 0).slice(-TEMP_REF_NUITS).map((d) => d.temp);
  if (ref.length < TEMP_REF_MIN) return null;
  return Math.round((x.temp - mediane(ref)) * 100) / 100;
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
// ---- Séance : fenêtre et résumé FC -------------------------------------
// Le raccourci dépose tous les échantillons de la journée ; c'est ici qu'on ne
// retient que ceux de la séance, déduite des horodatages de saisie. Chaque saisie
// couvre la période qui la sépare de la précédente : ses séries et la récupération
// entre elles. Découper ainsi plutôt que par exercice laisse un mouvement repris
// plus tard agréger ses tranches sans absorber l'intervalle. Le tapis, souvent
// avant ou après la muscu, étend la fenêtre quand son départ est connu. Moins de
// deux saisies horodatées : fenêtre inconnue (null), l'appelant se rabat sur la
// détection par densité.
export const fenetreSeance = (sessions, treadmill, date) => {
  const ss = sessions.filter((s) => s.date === date && s.at).sort((a, b) => a.at - b.at);
  if (ss.length < 2) return null;
  const blocs = ss.map((x, i) => ({ ex: x.exercise, id: x.id, solo: x.sets.length === 1, from: i ? ss[i - 1].at : x.at - MIN_PAR_SERIE * 60000, to: x.at }));
  const taps = treadmill.filter((t) => t.date === date && t.at0 > 0 && t.min > 0);
  const win = [blocs[0].from, ss[ss.length - 1].at + 120000];
  taps.forEach((t) => {
    win[0] = Math.min(win[0], t.at0);
    win[1] = Math.max(win[1], t.at0 + t.min * 60000);
  });
  return { win, blocs, taps };
};
const moyenne = (v) => Math.round(v.reduce((a, x) => a + x, 0) / v.length);
// Résumé FC d'une séance à partir des échantillons triés et de sa fenêtre (ou
// null : densité). hr/hrMax sur toute la fenêtre, courbe par 30 s, puis par
// exercice, par série et par tapis. Le pic par série est le sommet du bloc de la
// saisie : chaque série enregistrée dès qu'elle est finie a donc le sien ; une
// saisie groupant plusieurs séries n'en a pas, rien ne permet de les départager.
export const resumeSeance = (samples, w, date) => {
  const dans = w ? samples.filter((s) => s.ms >= w.win[0] && s.ms <= w.win[1]) : denseRun(samples.filter((s) => s.day === date));
  if (dans.length === 0) return null;
  const bpm = dans.map((s) => s.bpm);
  const rec = { date, n: bpm.length, hr: moyenne(bpm), hrMax: Math.round(Math.max(...bpm)), fc: courbeFc(dans) };
  if (!w) return rec;
  const parEx = new Map();
  w.blocs.forEach((b) => {
    const v = samples.filter((s) => s.ms >= b.from && s.ms <= b.to).map((s) => s.bpm);
    if (v.length === 0) return;
    if (!parEx.has(b.ex)) parEx.set(b.ex, []);
    parEx.get(b.ex).push(...v);
  });
  if (parEx.size > 0) rec.ex = [...parEx].map(([n, v]) => ({ n, c: v.length, hr: moyenne(v), hrMax: Math.round(Math.max(...v)) }));
  rec.pics = w.blocs.filter((b) => b.solo).map((b) => {
    const v = samples.filter((x) => x.ms >= b.from && x.ms <= b.to).map((x) => x.bpm);
    return v.length ? { id: b.id, pic: Math.round(Math.max(...v)) } : null;
  }).filter(Boolean);
  rec.tap = w.taps.map((t) => {
    const v = samples.filter((s) => s.ms >= t.at0 && s.ms <= t.at0 + t.min * 60000).map((s) => s.bpm);
    return v.length ? { id: t.id, hr: moyenne(v) } : null;
  }).filter(Boolean);
  return rec;
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

// ---- Décision du matin ----------------------------------------------------
// Enregistre la décision ({ d, regle, motif }) sur l'entrée daily de la date
// donnée — le jour courant au moment du clic, jamais la date du formulaire de
// séance, qui peut dater de la veille dans une app restée ouverte. Les trois
// champs sont écrits d'un coup, au bouton, comme une saisie de série. Si la
// nuit n'a pas encore été importée, l'entrée est créée vide (souche complétée
// ensuite par fusionNuit). Une décision entièrement vide retire le champ, et la
// souche avec lui. Ne modifie pas le tableau reçu.
export const poserDecision = (daily, date, dec) => {
  const out = daily.map((x) => ({ ...x }));
  let x = out.find((y) => y.date === date);
  if (!x) { x = { date }; out.push(x); out.sort((a, b) => a.date.localeCompare(b.date)); }
  const propre = { d: dec?.d || "", regle: (dec?.regle || "").trim(), motif: (dec?.motif || "").trim() };
  if (!propre.d && !propre.regle && !propre.motif) {
    delete x.decision;
    return Object.keys(x).length === 1 ? out.filter((y) => y !== x) : out;
  }
  x.decision = propre;
  return out;
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
  const dec = (data.daily || []).find((d) => d.date === date)?.decision || {};
  const l = { date, decision: dec.d ?? "", regle: dec.regle ?? "", motif: dec.motif ?? "", groupes: [...new Set(ss.map((s) => s.group))].join("+"), series: 0, tonnage: 0 };
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
  l.repas = nuit.repas ?? "";
  l.nuit_fc_min = nuit.min ?? ""; l.nuit_fc_moy = nuit.moy ?? ""; l.nuit_fc_hmin = nuit.hMin ?? ""; l.nuit_n = nuit.n ?? ""; l.vfc = nuit.vfc ?? "";
  l.nuit_resp = nuit.resp ?? ""; l.nuit_spo2 = nuit.spo2 ?? ""; l.nuit_spo2_min = nuit.spo2Min ?? ""; l.nuit_temp = nuit.temp ?? ""; l.nuit_temp_ecart = ecartTemp(data.daily || [], date) ?? "";
  l.sommeil_min = nuit.dodo ?? "";
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
