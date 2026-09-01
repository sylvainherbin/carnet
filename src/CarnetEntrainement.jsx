import { useState, useEffect, useMemo, useRef } from "react";
import { pullRemote, pushRemote, listFcFiles, pullFcFile } from "./githubSync.js";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart,
} from "recharts";

// ================= données / helpers (inchangés) =================
const STORAGE_KEY = "carnet-entrainement-v1";
const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtDate = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y.slice(2)}`; };
const e1rm = (kg, reps) => (reps === 1 ? kg : kg * (1 + reps / 30));

// ---- Estimation des calories (nécessite le poids corporel, onglet Poids) ----
// Tapis : équations ACSM marche (<8 km/h) / course, VO2 en ml/kg/min, 5 kcal par litre d'O2.
// Muscu : modèle travail/repos — ~6 MET pendant les séries (~40 s chacune), ~2 MET entre.
// Le temps de muscu vient, par ordre de préférence : des horodatages de saisie en direct
// (mode formulaire ; pauses plafonnées à 10 min pour absorber un tapis ou une interruption
// au milieu), de la durée saisie moins le tapis, ou à défaut de 3 min par série.
const MET_TRAVAIL = 6, MET_REPOS = 2, SEC_PAR_SERIE = 40, PAUSE_MAX = 10, MIN_PAR_SERIE = 3;

// Pendant un entraînement, la montre mesure la FC en continu (~5 s) ; au repos,
// seulement toutes les quelques minutes, avec de brèves rafales opportunistes.
// La plus longue plage à cadence serrée est donc la séance. Le seuil de 10 min
// écarte ces rafales : faute de plage assez longue, on préfère ne rien conclure.
const denseRun = (samples) => {
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
const weightFor = (weights, date) => {
  const w = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const past = w.filter((x) => x.date <= date);
  return (past[past.length - 1] || w[0])?.kg || null;
};
const kcalTapis = (t, kg) => {
  if (!(t.min > 0 && t.km > 0)) return 0;
  const S = (t.km * 1000) / t.min, g = (t.slope || 0) / 100;
  const vo2 = S >= 134 ? 3.5 + 0.2 * S + 0.9 * S * g : 3.5 + 0.1 * S + 1.8 * S * g;
  return (vo2 * kg / 200) * t.min;
};
const kcalSeance = (data, date) => {
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
    mode = "chrono";
  } else if (meta.min > 0) { mMin = Math.max(0, meta.min - tMin); mode = "saisies"; }
  else { mMin = nSets * MIN_PAR_SERIE; mode = "estimées"; }
  const workMin = Math.min((nSets * SEC_PAR_SERIE) / 60, mMin);
  const mKcal = nSets > 0 ? (3.5 * kg / 200) * (MET_TRAVAIL * workMin + MET_REPOS * (mMin - workMin)) : 0;
  if (mKcal + tKcal === 0) return null;
  return { total: Math.round(mKcal + tKcal), muscu: Math.round(mKcal), tapis: Math.round(tKcal),
    mMin: Math.round(mMin), mode, kg, hr: meta.hr || null, hrMax: meta.hrMax || null, watch: meta.watch || null };
};
const num = (v) => (v === "" || v === null || isNaN(Number(v)) ? 0 : Number(v));
const isoWeek = (iso) => {
  const d = new Date(iso + "T12:00:00"); const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3); const firstThu = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-S${pad(week)}`;
};
const GROUPS = ["Pecs", "Dos", "Jambes", "Épaules", "Bras", "Autre"];
const parseLine = (line) => {
  if (!line.includes(":")) return { error: "pas de valeurs", raw: line };
  const idx = line.indexOf(":"); const name = line.slice(0, idx).trim();
  let vals = line.slice(idx + 1).trim(); let note = "";
  const mn = vals.match(/\(([^)]*)\)/);
  if (mn) { note = mn[1].trim(); vals = vals.slice(0, mn.index).trim(); }
  const sets = []; const bad = [];
  vals.split(/\s*-\s*/).forEach((p) => {
    const part = p.trim().replace(",", "."); if (!part) return;
    const m = part.match(/^([\d.]+)\s*[x×]\s*([\d.]+)$/i);
    if (m) sets.push({ kg: Number(m[1]), reps: Number(m[2]) }); else bad.push(part);
  });
  if (!name || sets.length === 0) return { error: "aucune série lisible", raw: line };
  return { name, sets, note, bad };
};
const DEFAULT_EXERCISES = ["Dev incliné", "Dev couché", "Chest press", "Dips", "PullDown", "Row", "Leg extension", "Leg Curl", "Leg press", "Shoulder press"];
const EMPTY = { exercises: DEFAULT_EXERCISES, sessions: [], treadmill: [], weights: [], durations: [] };

// ================= thème =================
const T = {
  bg: "#06080E", panel: "rgba(11,16,26,0.92)", panel2: "#0A0E17",
  cyan: "#00E5FF", magenta: "#FF2D95", amber: "#FFB000", danger: "#FF3B5C", violet: "#7A5CFF",
  text: "#D8E6F2", mute: "#6C7F97", line: "rgba(0,229,255,0.18)", lineStrong: "rgba(0,229,255,0.45)",
};
const mono = "'SF Mono', ui-monospace, Menlo, Consolas, monospace";
const display = "'Orbitron', 'SF Mono', ui-monospace, monospace";
const sans = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const CSS = `
@keyframes boot { from { opacity:0; transform: translateY(6px);} to { opacity:1; transform:none;} }
@keyframes rise { from { opacity:0; transform: translateX(-8px);} to { opacity:1; transform:none;} }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(0,229,255,.55);} 100% { box-shadow: 0 0 0 18px rgba(0,229,255,0);} }
@keyframes scan { 0% { transform: translateY(-100%);} 100% { transform: translateY(400%);} }
@keyframes blink { 0%,49% { opacity:1;} 50%,100% { opacity:0;} }
@keyframes toastin { from { opacity:0; transform: translate(-50%, 8px);} to { opacity:1; transform: translate(-50%, 0);} }
.boot { animation: boot .45s cubic-bezier(.2,.8,.2,1) both; }
.boot-2 { animation-delay: .08s; } .boot-3 { animation-delay: .16s; } .boot-4 { animation-delay: .24s; }
.rise { animation: rise .3s ease-out both; }
.pulse { animation: pulse .7s ease-out; }
.scanline { position:absolute; left:0; right:0; height:36px; pointer-events:none;
  background: linear-gradient(180deg, rgba(0,229,255,0) 0%, rgba(0,229,255,.10) 50%, rgba(0,229,255,0) 100%);
  animation: scan 7s linear infinite; }
.cursor::after { content:"_"; animation: blink 1s steps(1) infinite; color:${T.cyan}; }
.toast { animation: toastin .25s ease-out; }
.grid-bg { background-image:
  linear-gradient(rgba(0,229,255,.035) 1px, transparent 1px),
  linear-gradient(90deg, rgba(0,229,255,.035) 1px, transparent 1px);
  background-size: 28px 28px; }
.inp { width:100%; background:${T.panel2}; color:${T.text}; border:1px solid ${T.line}; border-radius:6px;
  padding:10px 12px; font-size:16px; font-family:${mono}; transition: border-color .15s, box-shadow .15s; }
.inp:focus { outline:none; border-color:${T.cyan}; box-shadow: 0 0 0 1px ${T.cyan}, 0 0 16px rgba(0,229,255,.25); }
.inp::placeholder { color:${T.mute}; font-family:${sans}; }
select.inp { appearance:none; background-image: linear-gradient(45deg, transparent 50%, ${T.cyan} 50%), linear-gradient(135deg, ${T.cyan} 50%, transparent 50%);
  background-position: calc(100% - 18px) 55%, calc(100% - 13px) 55%; background-size: 5px 5px; background-repeat:no-repeat; }
.btn { border-radius:6px; font-weight:600; letter-spacing:.02em; transition: transform .08s, filter .15s, box-shadow .15s; cursor:pointer; }
.btn:active { transform: scale(.98); }
.btn-primary { background:${T.cyan}; color:#03141A; box-shadow: 0 0 18px rgba(0,229,255,.35); }
.btn-primary:hover { filter: brightness(1.08); }
.btn-ghost { background:transparent; color:${T.cyan}; border:1px solid ${T.lineStrong}; }
.btn-quiet { background:rgba(0,229,255,.08); color:${T.cyan}; border:1px solid transparent; }
.btn-danger { background:transparent; color:${T.danger}; border:1px solid rgba(255,59,92,.5); }
.tab { transition: color .15s; position:relative; }
.tab-active::before { content:""; position:absolute; top:-1px; left:20%; right:20%; height:2px; background:${T.cyan};
  box-shadow: 0 0 10px ${T.cyan}, 0 0 20px ${T.cyan}; }
.panel { position:relative; overflow:hidden; background:${T.panel}; border:1px solid ${T.line}; border-radius:10px; backdrop-filter: blur(6px); }
.panel::before { content:""; position:absolute; top:0; left:0; width:22px; height:22px;
  border-top:2px solid ${T.cyan}; border-left:2px solid ${T.cyan}; border-top-left-radius:10px; opacity:.8; }
.panel::after { content:""; position:absolute; bottom:0; right:0; width:22px; height:22px;
  border-bottom:2px solid ${T.cyan}; border-right:2px solid ${T.cyan}; border-bottom-right-radius:10px; opacity:.8; }
.glow-cyan { filter: drop-shadow(0 0 6px rgba(0,229,255,.55)); }
.glow-magenta { filter: drop-shadow(0 0 6px rgba(255,45,149,.55)); }
.glow-violet { filter: drop-shadow(0 0 6px rgba(122,92,255,.55)); }
.row { border-bottom:1px solid rgba(0,229,255,.10); }
.row:last-child { border-bottom:none; }
.pr-overlay { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center;
  background: radial-gradient(ellipse at center, rgba(22,15,2,.93) 0%, rgba(3,5,10,.97) 72%);
  backdrop-filter: blur(10px); animation: prfade .35s ease-out; }
@keyframes prfade { from { opacity:0; } }
.pr-box { position:relative; text-align:center; }
.pr-ring { position:absolute; left:50%; top:50%; width:190px; height:190px; margin:-95px 0 0 -95px;
  border:1.5px solid rgba(255,176,0,.85); border-radius:50%; pointer-events:none;
  animation: prring 1.8s cubic-bezier(.2,.7,.3,1) infinite; }
.pr-ring2 { animation-delay:.6s; border-color: rgba(0,229,255,.45); }
.pr-ring3 { animation-delay:1.2s; }
@keyframes prring { 0% { transform: scale(.35); opacity:.9; } 100% { transform: scale(2.4); opacity:0; } }
.pr-spark { position:absolute; left:50%; top:50%; width:5px; height:5px; border-radius:1px; background:#FFB000;
  box-shadow:0 0 8px #FFB000; pointer-events:none; animation: prspark 1.1s cubic-bezier(.1,.8,.3,1) forwards; }
@keyframes prspark { 0% { transform: translate(0,0) scale(1); opacity:1; } 100% { transform: translate(var(--dx), var(--dy)) scale(.3); opacity:0; } }
.pr-line { opacity:0; animation: rise .35s ease-out forwards; }
@media (prefers-reduced-motion: reduce) {
  .boot,.rise,.pulse,.scanline,.toast,.cursor::after,.pr-ring,.pr-spark,.pr-overlay { animation:none !important; }
  .pr-line { opacity:1 !important; animation:none !important; }
}
`;

// ================= UI =================
function Panel({ children, className = "", boot }) {
  return <section className={`panel p-4 ${boot ? "boot " + boot : ""} ${className}`}>{children}</section>;
}
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs tracking-wide" style={{ color: T.mute, fontFamily: mono }}>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
function Btn({ children, onClick, kind = "primary", full, small, pulse }) {
  return (
    <button type="button" onClick={onClick}
      className={`btn btn-${kind} ${small ? "px-3 py-1.5 text-sm" : "px-4 py-3 text-base"} ${full ? "w-full" : ""} ${pulse ? "pulse" : ""}`}
      style={{ fontFamily: sans }}>
      {children}
    </button>
  );
}
function H({ children, right }) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <h2 className="font-semibold text-base" style={{ color: T.text }}>{children}</h2>
      {right && <span className="text-xs" style={{ color: T.mute, fontFamily: mono }}>{right}</span>}
    </div>
  );
}
function Empty({ text }) {
  return <p className="text-sm py-6 text-center" style={{ color: T.mute }}>{text}</p>;
}
function Del({ onClick }) {
  return <button type="button" onClick={onClick} className="text-xs px-2 py-1 rounded" style={{ color: T.danger, fontFamily: mono }}>×</button>;
}
const tip = { contentStyle: { background: "#0A0E17", border: `1px solid ${T.lineStrong}`, borderRadius: 6, fontFamily: mono, fontSize: 12, color: T.text }, labelStyle: { color: T.mute }, cursor: { stroke: T.lineStrong } };
const axis = { fontSize: 10, fill: T.mute, fontFamily: mono };

// ================= APP =================
export default function CarnetEntrainement() {
  const [data, setData] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("seance");
  const [toast, setToast] = useState("");
  const [pr, setPr] = useState(null);
  const saveTimer = useRef(null);

  // --- synchronisation GitHub ---
  const GH_TOKEN = "carnet-gh-token", GH_SHA = "carnet-gh-sha", GH_DIRTY = "carnet-gh-dirty", GH_AT = "carnet-gh-at";
  const dataRef = useRef(data);
  const adopting = useRef(false);   // vrai quand setData vient du chargement ou de GitHub : ne pas marquer "modifié"
  const pulledOnce = useRef(false);
  const pushTimer = useRef(null);
  const [ghSync, setGhSync] = useState(() => {
    try { return { hasToken: !!localStorage.getItem(GH_TOKEN), status: "", at: localStorage.getItem(GH_AT) || "" }; }
    catch { return { hasToken: false, status: "", at: "" }; }
  });
  const stamp = (status) => {
    const at = new Date().toTimeString().slice(0, 5);
    try { localStorage.setItem(GH_AT, at); } catch (e) { /* privé */ }
    setGhSync((g) => ({ ...g, status, at }));
  };
  const adopt = (rem) => {
    adopting.current = true;
    setData({ ...EMPTY, ...rem.data });
    try { localStorage.setItem(GH_SHA, rem.sha); localStorage.removeItem(GH_DIRTY); } catch (e) { /* privé */ }
    stamp("données GitHub chargées");
  };
  const doPush = async () => {
    const token = localStorage.getItem(GH_TOKEN); if (!token) return;
    try {
      const res = await pushRemote(dataRef.current, localStorage.getItem(GH_SHA) || undefined, token);
      if (res.conflict) { doPull(); return; } // modifié ailleurs : repasser par la lecture, qui arbitre
      localStorage.setItem(GH_SHA, res.sha); localStorage.removeItem(GH_DIRTY);
      stamp("synchronisé");
    } catch (e) {
      setGhSync((g) => ({ ...g, status: /40[13]/.test(e.message) ? "jeton invalide ou expiré" : "hors ligne — en attente" }));
    }
  };
  const schedulePush = () => {
    if (!localStorage.getItem(GH_TOKEN)) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(doPush, 2000);
  };
  const doPull = async () => {
    try {
      const rem = await pullRemote();
      if (!rem) { if (localStorage.getItem(GH_DIRTY)) schedulePush(); return; }
      const sha = localStorage.getItem(GH_SHA);
      const dirty = localStorage.getItem(GH_DIRTY) === "1";
      if (rem.sha === sha) { if (dirty) schedulePush(); else setGhSync((g) => ({ ...g, status: "à jour" })); return; }
      const d = dataRef.current;
      const localEmpty = d.sessions.length === 0 && d.treadmill.length === 0 && d.weights.length === 0;
      if (localEmpty || (sha && !dirty)) { adopt(rem); return; }
      // données locales ET distantes divergentes : c'est à l'utilisateur d'arbitrer
      if (window.confirm("Des données différentes existent sur GitHub (autre appareil ?).\n\nOK — charger celles de GitHub sur cet appareil.\nAnnuler — garder celles de cet appareil (elles écraseront GitHub à la prochaine synchro).")) {
        adopt(rem);
      } else {
        try { localStorage.setItem(GH_SHA, rem.sha); localStorage.setItem(GH_DIRTY, "1"); } catch (e) { /* privé */ }
        schedulePush();
      }
    } catch (e) { setGhSync((g) => ({ ...g, status: "hors ligne" })); }
  };

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(""), 1800); };
  const update = (fn) => setData((d) => fn(structuredClone(d)));

  // --- FC Apple Watch ---------------------------------------------------
  // Le raccourci iOS déverse dans fc/ tous les échantillons que Santé lui rend,
  // sans filtrage : plusieurs heures de FC de fond entourent la séance. C'est
  // donc ici qu'on trie, en ne retenant que les battements tombant dans la
  // fenêtre réelle de la séance, déduite des horodatages de saisie. Le nom du
  // fichier n'est jamais utilisé comme date : il porte l'heure d'envoi, qui
  // bascule au lendemain pour une séance de fin de soirée.
  const importFc = async () => {
    try {
      const d = dataRef.current;
      const limit = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
      const windows = new Map();
      [...new Set(d.sessions.map((s) => s.date))].forEach((dt) => {
        if (dt < limit) return;
        if ((d.durations.find((x) => x.date === dt) || {}).hr > 0) return;
        const ts = d.sessions.filter((s) => s.date === dt).map((s) => s.at).filter(Boolean).sort((a, b) => a - b);
        // Sans horodatage de saisie (mode texte), la fenêtre reste inconnue :
        // null déclenche la détection par densité sur les échantillons du jour.
        windows.set(dt, ts.length >= 2 ? [ts[0] - MIN_PAR_SERIE * 60000, ts[ts.length - 1] + 120000] : null);
      });
      if (windows.size === 0) return;
      const nextDay = (iso) => new Date(new Date(`${iso}T12:00:00`).getTime() + 864e5).toISOString().slice(0, 10);
      const days = new Set([...windows.keys()].flatMap((dt) => [dt, nextDay(dt)]));
      const names = (await listFcFiles()).filter((n) => days.has(n.slice(0, 10)));
      if (names.length === 0) return;
      const samples = (await Promise.all(names.map(pullFcFile))).flat()
        .map((s) => ({ ms: Date.parse(s.t), day: String(s.t).slice(0, 10), bpm: Number(String(s.bpm).replace(",", ".").replace(/[^0-9.]/g, "")) }))
        .filter((s) => s.ms > 0 && s.bpm > 20 && s.bpm < 250)
        .sort((a, b) => a.ms - b.ms);
      const found = [];
      windows.forEach((win, date) => {
        const bpm = (win ? samples.filter((s) => s.ms >= win[0] && s.ms <= win[1]) : denseRun(samples.filter((s) => s.day === date))).map((s) => s.bpm);
        if (bpm.length === 0) return;
        found.push({ date, n: bpm.length, hr: Math.round(bpm.reduce((a, v) => a + v, 0) / bpm.length), hrMax: Math.round(Math.max(...bpm)) });
      });
      if (found.length === 0) return;
      update((dd) => {
        found.forEach(({ date, hr, hrMax }) => {
          let m = dd.durations.find((x) => x.date === date);
          if (!m) { m = { date }; dd.durations.push(m); }
          if (!(m.hr > 0)) m.hr = hr;
          if (!(m.hrMax > 0)) m.hrMax = hrMax;
        });
        return dd;
      });
      const f = found[found.length - 1];
      notify(`FC importée : ${f.hr} bpm moy · ${f.hrMax} max (${f.n} mesures)`);
    } catch (e) { console.error("import FC", e); }
  };

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => {
    try { const r = localStorage.getItem(STORAGE_KEY); if (r) { adopting.current = true; setData({ ...EMPTY, ...JSON.parse(r) }); } }
    catch (e) { /* première utilisation */ }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => {
    if (!loaded || pulledOnce.current) return;
    pulledOnce.current = true;
    doPull().finally(() => setTimeout(importFc, 1200)); // après l'éventuel adopt(), une fois dataRef à jour
  }, [loaded]);
  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    const adopted = adopting.current; adopting.current = false;
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        if (!adopted) { localStorage.setItem(GH_DIRTY, "1"); schedulePush(); }
      } catch (e) { console.error(e); }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [data, loaded]);

  // HUD
  const hud = useMemo(() => {
    const dates = [...new Set(data.sessions.map((s) => s.date))].sort();
    const lastDate = dates[dates.length - 1];
    const lastGroup = lastDate ? data.sessions.find((s) => s.date === lastDate)?.group : null;
    const thisWeek = isoWeek(todayISO());
    const weekSessions = dates.filter((d) => isoWeek(d) === thisWeek).length;
    const w = [...data.weights].sort((a, b) => a.date.localeCompare(b.date));
    const lastW = w[w.length - 1];
    const ref = w.length >= 8 ? w[w.length - 8] : w[0];
    const delta = lastW && ref && lastW !== ref ? lastW.kg - ref.kg : null;
    return { lastDate, lastGroup, weekSessions, lastW, delta };
  }, [data]);

  const tabs = [["seance", "Séance"], ["tapis", "Tapis"], ["poids", "Poids"], ["courbes", "Courbes"], ["records", "Records"], ["donnees", "Données"]];

  return (
    <div className="min-h-screen grid-bg" style={{ background: T.bg, color: T.text, fontFamily: sans }}>
      <style>{CSS}</style>
      <div className="max-w-md mx-auto pb-24">
        <header className="relative px-4 pt-5 pb-4 overflow-hidden boot">
          <div className="scanline" />
          <div className="flex items-baseline justify-between">
            <h1 className="text-2xl font-bold tracking-tight cursor" style={{ color: T.cyan, textShadow: `0 0 14px rgba(0,229,255,.6)`, fontFamily: display, letterSpacing: '.08em' }}>CARNET</h1>
            <span className="text-xs" style={{ color: T.mute, fontFamily: mono }}>{fmtDate(todayISO())}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs" style={{ fontFamily: mono }}>
            <Hud label="dernière" value={hud.lastDate ? fmtDate(hud.lastDate) : "—"} sub={hud.lastGroup || ""} />
            <Hud label="semaine" value={`${hud.weekSessions} séance${hud.weekSessions > 1 ? "s" : ""}`} sub="" />
            <Hud label="poids" value={hud.lastW ? `${hud.lastW.kg.toFixed(1)} kg` : "—"} sub={hud.delta !== null ? `${hud.delta > 0 ? "+" : ""}${hud.delta.toFixed(1)} / 7 j` : ""} color={T.magenta} />
          </div>
        </header>

        <main className="px-4 space-y-4" key={tab}>
          {!loaded && <Empty text="Initialisation…" />}
          {loaded && tab === "seance" && <Seance data={data} update={update} notify={notify} celebrate={setPr} />}
          {loaded && tab === "tapis" && <Tapis data={data} update={update} notify={notify} />}
          {loaded && tab === "poids" && <Poids data={data} update={update} notify={notify} />}
          {loaded && tab === "courbes" && <Courbes data={data} />}
          {loaded && tab === "records" && <Records data={data} />}
          {loaded && tab === "donnees" && <Donnees data={data} setData={setData} notify={notify} sync={ghSync}
            onToken={(t) => { const v = t.trim(); if (!v) return; try { localStorage.setItem(GH_TOKEN, v); localStorage.setItem(GH_DIRTY, "1"); } catch (e) { /* privé */ } setGhSync((g) => ({ ...g, hasToken: true, status: "activation…" })); doPull(); }}
            onTokenOff={() => { try { localStorage.removeItem(GH_TOKEN); } catch (e) { /* privé */ } setGhSync((g) => ({ ...g, hasToken: false, status: "" })); notify("Synchro désactivée sur cet appareil"); }}
            onSync={doPull} />}
        </main>

        {pr && <PROverlay pr={pr} onClose={() => setPr(null)} />}

        {toast && (
          <div className="toast fixed left-1/2 bottom-20 px-4 py-2 rounded-md text-sm"
            style={{ background: "#0A0E17", border: `1px solid ${T.cyan}`, color: T.cyan, fontFamily: mono, boxShadow: "0 0 20px rgba(0,229,255,.35)", transform: "translateX(-50%)" }}>
            {toast}
          </div>
        )}

        <nav className="fixed bottom-0 left-0 right-0" style={{ background: "rgba(6,8,14,.92)", borderTop: `1px solid ${T.line}`, backdropFilter: "blur(10px)" }}>
          <div className="max-w-md mx-auto grid grid-cols-6">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`tab py-3 text-xs ${tab === k ? "tab-active" : ""}`}
                style={{ color: tab === k ? T.cyan : T.mute, fontFamily: mono, fontWeight: tab === k ? 700 : 400 }}>
                {label}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

function Hud({ label, value, sub, color = T.cyan }) {
  return (
    <div className="rounded px-2 py-1.5" style={{ background: "rgba(0,229,255,.05)", border: `1px solid ${T.line}` }}>
      <div style={{ color: T.mute }}>{label}</div>
      <div className="font-bold text-sm" style={{ color, textShadow: `0 0 8px ${color}55`, fontFamily: display }}>{value}</div>
      <div style={{ color: T.mute, minHeight: 14 }}>{sub}</div>
    </div>
  );
}

// ================= Séance =================
function Seance({ data, update, notify, celebrate }) {
  const [date, setDate] = useState(todayISO());
  const [group, setGroup] = useState(GROUPS[0]);
  const [mode, setMode] = useState("texte");
  const [text, setText] = useState("");
  const [exercise, setExercise] = useState(data.exercises[0] || "");
  const [newEx, setNewEx] = useState("");
  const [sets, setSets] = useState([{ reps: "", kg: "" }]);
  const [rpe, setRpe] = useState("");
  const [note, setNote] = useState("");
  const [pulse, setPulse] = useState(false);
  const fire = () => { setPulse(true); setTimeout(() => setPulse(false), 700); };

  const parsed = useMemo(() => text.split("\n").map((l) => l.trim()).filter(Boolean).map(parseLine), [text]);

  const lastFor = (name) => data.sessions.filter((x) => x.exercise === name).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  const last = useMemo(() => lastFor(exercise), [data.sessions, exercise]);

  const bestFor = (name) => Math.max(0, ...data.sessions.filter((x) => x.exercise === name).flatMap((x) => x.sets.map((y) => e1rm(y.kg, y.reps))));
  const firePR = (candidates) => {
    const prs = candidates.filter((c) => c.oldBest > 0 && c.newBest > c.oldBest + 0.05);
    if (prs.length) celebrate(prs.sort((a, b) => b.newBest / b.oldBest - a.newBest / a.oldBest)[0]);
  };
  const saveText = () => {
    const ok = parsed.filter((p) => !p.error);
    if (ok.length === 0) { notify("Rien à enregistrer"); return; }
    const candidates = ok.map((p) => ({ exercise: p.name, oldBest: bestFor(p.name), newBest: Math.max(...p.sets.map((x) => e1rm(x.kg, x.reps))) }));
    update((d) => {
      ok.forEach((p) => {
        if (!d.exercises.includes(p.name)) d.exercises.push(p.name);
        d.sessions.push({ id: uid(), date, group, exercise: p.name, sets: p.sets, rpe: null, note: p.note });
      });
      return d;
    });
    setText(""); fire(); notify(`${ok.length} exercice(s) enregistré(s)`); firePR(candidates);
  };
  const addExercise = () => {
    const n = newEx.trim(); if (!n) return;
    update((d) => { if (!d.exercises.includes(n)) d.exercises.push(n); return d; });
    setExercise(n); setNewEx("");
  };
  const save = () => {
    const clean = sets.filter((s) => num(s.reps) > 0).map((s) => ({ reps: num(s.reps), kg: num(s.kg) }));
    if (!exercise || clean.length === 0) { notify("Ajoute au moins une série valide"); return; }
    const candidate = { exercise, oldBest: bestFor(exercise), newBest: Math.max(...clean.map((x) => e1rm(x.kg, x.reps))) };
    update((d) => { d.sessions.push({ id: uid(), date, group, exercise, sets: clean, rpe: rpe === "" ? null : num(rpe), note: note.trim(), at: Date.now() }); return d; });
    setSets([{ reps: "", kg: "" }]); setRpe(""); setNote(""); fire(); notify("Exercice enregistré"); firePR([candidate]);
  };

  const todays = data.sessions.filter((s) => s.date === date);
  const meta = data.durations.find((x) => x.date === date) || {};
  const setMeta = (field, v) => update((d) => {
    let m = d.durations.find((x) => x.date === date);
    if (!m) { m = { date }; d.durations.push(m); }
    if (num(v) > 0) m[field] = num(v); else delete m[field];
    if (!(m.min > 0 || m.hr > 0 || m.watch > 0 || m.hrMax > 0)) d.durations = d.durations.filter((x) => x !== m);
    return d;
  });
  const kcal = kcalSeance(data, date);
  // Regroupe les entrées du jour par exercice (ordre d'apparition) ; chaque série
  // est numérotée selon l'ordre d'exécution, quelle que soit la méthode de saisie.
  const grouped = (() => {
    const map = new Map();
    todays.forEach((s) => {
      if (!map.has(s.exercise)) map.set(s.exercise, []);
      s.sets.forEach((x, setIdx) => map.get(s.exercise).push({ id: s.id, setIdx, kg: x.kg, reps: x.reps, rpe: s.rpe, note: setIdx === 0 ? s.note : "" }));
    });
    return [...map.entries()].map(([exercise, rows]) => ({
      exercise, rows,
      vol: rows.reduce((a, r) => a + r.reps * r.kg, 0),
      best: Math.max(...rows.map((r) => e1rm(r.kg, r.reps))),
    }));
  })();
  // Séance de référence : la dernière fois que ce groupe musculaire a été
  // travaillé, avec le repère de ce qui a déjà été refait aujourd'hui — de quoi
  // servir à la fois de liste d'exercices et d'objectif, sans quitter l'onglet.
  const previous = useMemo(() => {
    const dates = [...new Set(data.sessions.filter((s) => s.group === group && s.date < date).map((s) => s.date))].sort();
    const prevDate = dates[dates.length - 1];
    if (!prevDate) return null;
    const map = new Map();
    data.sessions.filter((s) => s.date === prevDate && s.group === group).forEach((s) => {
      if (!map.has(s.exercise)) map.set(s.exercise, []);
      s.sets.forEach((x) => map.get(s.exercise).push(x));
    });
    const bestToday = new Map();
    todays.forEach((s) => bestToday.set(s.exercise, Math.max(bestToday.get(s.exercise) || 0, ...s.sets.map((x) => e1rm(x.kg, x.reps)))));
    const items = [...map.entries()].map(([exercise, sets]) => {
      const best = Math.max(...sets.map((x) => e1rm(x.kg, x.reps)));
      return { exercise, sets, best, vol: sets.reduce((a, x) => a + x.kg * x.reps, 0),
        done: bestToday.has(exercise), delta: bestToday.has(exercise) ? bestToday.get(exercise) - best : null };
    });
    return { date: prevDate, items, vol: items.reduce((a, x) => a + x.vol, 0), reste: items.filter((x) => !x.done).length };
  }, [data.sessions, group, date, todays]);

  const delSet = (id, setIdx) => update((d) => {
    d.sessions = d.sessions.map((s) => s.id === id ? { ...s, sets: s.sets.filter((_, j) => j !== setIdx) } : s).filter((s) => s.sets.length > 0);
    return d;
  });

  return (
    <>
      <Panel boot="boot-1" className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="inp" /></Field>
          <Field label="groupe"><select value={group} onChange={(e) => setGroup(e.target.value)} className="inp">{GROUPS.map((g) => <option key={g}>{g}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="durée (min)"><input type="number" inputMode="numeric" min="0" value={meta.min ?? ""} onChange={(e) => setMeta("min", e.target.value)} className="inp" placeholder="auto en direct" /></Field>
          <Field label="fc moy"><input type="number" inputMode="numeric" min="0" value={meta.hr ?? ""} onChange={(e) => setMeta("hr", e.target.value)} className="inp" /></Field>
          <Field label="kcal montre"><input type="number" inputMode="decimal" min="0" value={meta.watch ?? ""} onChange={(e) => setMeta("watch", e.target.value)} className="inp" /></Field>
        </div>
        <div className="flex gap-2">
          <Btn small kind={mode === "texte" ? "primary" : "quiet"} onClick={() => setMode("texte")}>Saisie texte</Btn>
          <Btn small kind={mode === "form" ? "primary" : "quiet"} onClick={() => setMode("form")}>Formulaire</Btn>
        </div>
      </Panel>

      {mode === "texte" && (
        <Panel boot="boot-2" className="space-y-3">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} className="inp"
            placeholder={"Une ligne par exercice, kg x reps, séries séparées par un tiret :\nDev incliné : 90x6 - 100x1,5\nPoulie haut du pec : 15x10 (moins mal au coude)"} />
          {parsed.length > 0 && (
            <ul className="text-sm space-y-1.5" style={{ fontFamily: mono }}>
              {parsed.map((p, i) => {
                const prev = p.error ? null : lastFor(p.name);
                const bestNow = p.error ? 0 : Math.max(...p.sets.map((s) => e1rm(s.kg, s.reps)));
                const bestPrev = prev ? Math.max(...prev.sets.map((s) => e1rm(s.kg, s.reps))) : null;
                const up = bestPrev !== null && bestNow > bestPrev + 0.05;
                return (
                  <li key={i} className="rise" style={{ animationDelay: `${i * 40}ms`, color: p.error ? T.danger : T.text }}>
                    {p.error ? `⚠ ${p.raw} — ${p.error}` : (
                      <>
                        <span style={{ color: T.cyan }}>{p.name}</span> {p.sets.map((s) => `${s.kg}×${s.reps}`).join("  ")}
                        {up && <span style={{ color: T.amber }}> ▲ e1RM {bestNow.toFixed(1)}</span>}
                        {p.note ? <span style={{ color: T.mute }}> ({p.note})</span> : ""}
                        {p.bad.length > 0 && <span style={{ color: T.danger }}> — ignoré : {p.bad.join(", ")}</span>}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Btn full onClick={saveText} pulse={pulse}>Enregistrer la séance</Btn>
        </Panel>
      )}

      {mode === "form" && (
        <Panel boot="boot-2" className="space-y-3">
          <Field label="exercice"><select value={exercise} onChange={(e) => setExercise(e.target.value)} className="inp">{data.exercises.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <div className="flex gap-2">
            <input placeholder="Nouvel exercice" value={newEx} onChange={(e) => setNewEx(e.target.value)} className="inp" />
            <Btn kind="quiet" onClick={addExercise}>Ajouter</Btn>
          </div>
          {last && <p className="text-xs" style={{ color: T.mute, fontFamily: mono }}>dernière fois {fmtDate(last.date)} : {last.sets.map((s) => `${s.kg}×${s.reps}`).join("  ")}</p>}
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs" style={{ color: T.mute, fontFamily: mono }}><span className="col-span-2">#</span><span className="col-span-4">kg</span><span className="col-span-4">reps</span></div>
            {sets.map((s, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center rise">
                <span className="col-span-2 text-sm" style={{ fontFamily: mono, color: T.cyan }}>{pad(i + 1)}</span>
                <input type="number" inputMode="decimal" step="0.5" value={s.kg} onChange={(e) => setSets(sets.map((x, j) => j === i ? { ...x, kg: e.target.value } : x))} className="col-span-4 inp" />
                <input type="number" inputMode="decimal" step="0.5" value={s.reps} onChange={(e) => setSets(sets.map((x, j) => j === i ? { ...x, reps: e.target.value } : x))} className="col-span-4 inp" />
                <div className="col-span-2 text-right"><Del onClick={() => setSets(sets.length > 1 ? sets.filter((_, j) => j !== i) : sets)} /></div>
              </div>
            ))}
            <div className="flex gap-2">
              <Btn kind="quiet" small onClick={() => setSets([...sets, { ...sets[sets.length - 1] }])}>+ série (copie)</Btn>
              <Btn kind="quiet" small onClick={() => setSets([...sets, { reps: "", kg: "" }])}>+ série vide</Btn>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="rpe"><input type="number" inputMode="decimal" min="1" max="10" step="0.5" value={rpe} onChange={(e) => setRpe(e.target.value)} className="inp" /></Field>
            <Field label="note"><input value={note} onChange={(e) => setNote(e.target.value)} className="inp" /></Field>
          </div>
          <Btn full onClick={save} pulse={pulse}>Enregistrer l'exercice</Btn>
        </Panel>
      )}

      {previous && (
        <Panel boot="boot-3">
          <H right={`${group} · ${fmtDate(previous.date)}`}>Séance précédente</H>
          <p className="text-xs mb-2" style={{ color: T.mute, fontFamily: mono }}>
            volume {Math.round(previous.vol)} kg · {previous.items.length} exercice{previous.items.length > 1 ? "s" : ""}
            {previous.reste > 0 && todays.length > 0 && <span style={{ color: T.amber }}>  ▸ {previous.reste} à refaire</span>}
          </p>
          <ul>
            {previous.items.map((it, i) => (
              <li key={it.exercise} className="row py-2 rise" style={{ animationDelay: `${i * 40}ms`, opacity: it.done ? 0.55 : 1 }}>
                <div className="flex justify-between items-baseline gap-2">
                  <div className="text-sm font-medium">
                    <span style={{ color: it.done ? T.cyan : T.mute, fontFamily: mono }}>{it.done ? "✓" : "○"}</span> {it.exercise}
                  </div>
                  <div className="text-xs whitespace-nowrap" style={{ color: T.mute, fontFamily: mono }}>
                    e1RM {it.best.toFixed(1)}
                    {it.delta !== null && Math.abs(it.delta) >= 0.05 && (
                      <span style={{ color: it.delta > 0 ? T.amber : T.danger }}>  {it.delta > 0 ? "+" : ""}{it.delta.toFixed(1)}</span>
                    )}
                  </div>
                </div>
                <div className="text-xs mt-1" style={{ color: T.text, fontFamily: mono }}>
                  {it.sets.map((s) => `${s.kg}×${s.reps}`).join("   ")}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel boot="boot-4">
        <H right={todays[0]?.group || ""}>Séance du {fmtDate(date)}</H>
        {kcal && (
          <p className="text-xs mb-2" style={{ color: T.mute, fontFamily: mono }}>
            ≈ <span style={{ color: T.amber }}>{kcal.total} kcal</span> · muscu {kcal.muscu} ({kcal.mMin} min {kcal.mode}) + tapis {kcal.tapis} · base {kcal.kg} kg{kcal.hr ? ` · FC ${kcal.hr}${kcal.hrMax ? ` max ${kcal.hrMax}` : ""}` : ""}{kcal.watch ? ` · montre ${kcal.watch} kcal` : ""}
          </p>
        )}
        {todays.length > 0 && !kcal && <p className="text-xs mb-2 italic" style={{ color: T.mute }}>Renseigne ton poids (onglet Poids) pour l'estimation des calories.</p>}
        {todays.length === 0 ? <Empty text="Rien d'enregistré pour cette date." /> : (
          <ul>
            {grouped.map((g, i) => (
              <li key={g.exercise} className="row py-2.5 rise" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="flex justify-between items-baseline gap-2">
                  <div className="font-medium">{g.exercise}</div>
                  <div className="text-xs" style={{ color: T.mute, fontFamily: mono }}>vol {g.vol} · e1RM <span style={{ color: T.cyan }}>{g.best.toFixed(1)}</span></div>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {g.rows.map((r, j) => (
                    <li key={`${r.id}-${r.setIdx}`} className="flex justify-between items-center gap-2">
                      <div className="text-xs" style={{ color: T.text, fontFamily: mono }}>
                        <span style={{ color: T.cyan }}>{pad(j + 1)}</span>  {r.kg}×{r.reps}{r.rpe ? <span style={{ color: T.mute }}> · RPE {r.rpe}</span> : ""}
                        {r.note && <span className="italic" style={{ color: T.amber }}>  {r.note}</span>}
                      </div>
                      <Del onClick={() => delSet(r.id, r.setIdx)} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

// ================= Tapis =================
function Tapis({ data, update, notify }) {
  const [f, setF] = useState({ date: todayISO(), min: "", km: "", slope: "", hr: "", note: "" });
  const [pulse, setPulse] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const speed = num(f.min) > 0 && num(f.km) > 0 ? num(f.km) / (num(f.min) / 60) : 0;
  const save = () => {
    if (num(f.min) <= 0) { notify("Durée obligatoire"); return; }
    update((d) => { d.treadmill.push({ id: uid(), date: f.date, min: num(f.min), km: num(f.km), slope: num(f.slope), hr: f.hr === "" ? null : num(f.hr), note: f.note.trim() }); return d; });
    setF({ ...f, min: "", km: "", slope: "", hr: "", note: "" }); setPulse(true); setTimeout(() => setPulse(false), 700); notify("Marche enregistrée");
  };
  const list = [...data.treadmill].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  return (
    <>
      <Panel boot="boot-1" className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="date"><input type="date" value={f.date} onChange={set("date")} className="inp" /></Field>
          <Field label="durée (min)"><input type="number" inputMode="numeric" value={f.min} onChange={set("min")} className="inp" /></Field>
          <Field label="distance (km)"><input type="number" inputMode="decimal" step="0.01" value={f.km} onChange={set("km")} className="inp" /></Field>
          <Field label="pente (%)"><input type="number" inputMode="decimal" step="0.5" value={f.slope} onChange={set("slope")} className="inp" /></Field>
          <Field label="fc moyenne"><input type="number" inputMode="numeric" value={f.hr} onChange={set("hr")} className="inp" /></Field>
          <Field label="vitesse">
            <div className="py-2 text-xl font-bold" style={{ fontFamily: mono, color: T.violet, textShadow: speed ? `0 0 10px ${T.violet}88` : "none" }}>{speed ? speed.toFixed(1) + " km/h" : "—"}</div>
          </Field>
        </div>
        <Field label="note"><input value={f.note} onChange={set("note")} className="inp" /></Field>
        <Btn full onClick={save} pulse={pulse}>Enregistrer la marche</Btn>
      </Panel>
      <Panel boot="boot-2">
        <H>Dernières marches</H>
        {list.length === 0 ? <Empty text="Aucune marche enregistrée." /> : (
          <ul>
            {list.map((t, i) => (
              <li key={t.id} className="row py-2 flex justify-between items-center gap-2 text-sm rise" style={{ animationDelay: `${i * 30}ms` }}>
                <span style={{ fontFamily: mono }}>
                  <span style={{ color: T.violet }}>{fmtDate(t.date)}</span> {t.min} min · {t.km} km
                  {t.min > 0 && t.km > 0 ? ` · ${(t.km / (t.min / 60)).toFixed(1)} km/h` : ""}{t.slope ? ` · ${t.slope} %` : ""}{t.hr ? ` · ${t.hr} bpm` : ""}
                </span>
                <Del onClick={() => update((d) => { d.treadmill = d.treadmill.filter((x) => x.id !== t.id); return d; })} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

// ================= Poids =================
function Poids({ data, update, notify }) {
  const [date, setDate] = useState(todayISO());
  const [kg, setKg] = useState("");
  const [pulse, setPulse] = useState(false);
  const save = () => {
    if (num(kg) <= 0) { notify("Poids invalide"); return; }
    update((d) => { d.weights = d.weights.filter((w) => w.date !== date); d.weights.push({ id: uid(), date, kg: num(kg) }); return d; });
    setKg(""); setPulse(true); setTimeout(() => setPulse(false), 700); notify("Poids enregistré");
  };
  const list = [...data.weights].sort((a, b) => b.date.localeCompare(a.date));
  const first = list[list.length - 1]; const lastW = list[0];
  return (
    <>
      <Panel boot="boot-1" className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="inp" /></Field>
          <Field label="poids (kg)"><input type="number" inputMode="decimal" step="0.1" value={kg} onChange={(e) => setKg(e.target.value)} className="inp" /></Field>
        </div>
        <Btn full onClick={save} pulse={pulse}>Enregistrer le poids</Btn>
        {first && lastW && first.id !== lastW.id && (
          <p className="text-xs" style={{ color: T.mute, fontFamily: mono }}>
            depuis le {fmtDate(first.date)} : <span style={{ color: T.magenta }}>{(lastW.kg - first.kg > 0 ? "+" : "") + (lastW.kg - first.kg).toFixed(1)} kg</span>
          </p>
        )}
      </Panel>
      <Panel boot="boot-2">
        <H>Relevés</H>
        {list.length === 0 ? <Empty text="Aucun relevé. Une pesée par jour, la dernière saisie remplace la précédente." /> : (
          <ul>
            {list.slice(0, 30).map((w, i) => (
              <li key={w.id} className="row py-2 flex justify-between text-sm rise" style={{ animationDelay: `${i * 25}ms`, fontFamily: mono }}>
                <span style={{ color: T.mute }}>{fmtDate(w.date)}</span>
                <span className="flex gap-3 items-center"><span style={{ color: T.magenta }}>{w.kg.toFixed(1)} kg</span>
                  <Del onClick={() => update((d) => { d.weights = d.weights.filter((x) => x.id !== w.id); return d; })} /></span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

// ================= Courbes =================
function Courbes({ data }) {
  const used = useMemo(() => [...new Set(data.sessions.map((s) => s.exercise))], [data.sessions]);
  const [ex, setEx] = useState(used[0] || "");
  useEffect(() => { if (!used.includes(ex) && used[0]) setEx(used[0]); }, [used]);

  const strength = useMemo(() => {
    const byDate = {};
    data.sessions.filter((s) => s.exercise === ex).forEach((s) => {
      const b = byDate[s.date] || { date: s.date, e1rm: 0, vol: 0 };
      b.e1rm = Math.max(b.e1rm, ...s.sets.map((x) => e1rm(x.kg, x.reps)));
      b.vol += s.sets.reduce((a, x) => a + x.reps * x.kg, 0); byDate[s.date] = b;
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ ...r, e1rm: +r.e1rm.toFixed(1), label: fmtDate(r.date) }));
  }, [data.sessions, ex]);
  const weight = useMemo(() => {
    const w = [...data.weights].sort((a, b) => a.date.localeCompare(b.date));
    return w.map((x, i) => { const win = w.slice(Math.max(0, i - 6), i + 1); return { label: fmtDate(x.date), kg: x.kg, moy7: +(win.reduce((a, y) => a + y.kg, 0) / win.length).toFixed(2) }; });
  }, [data.weights]);
  const weeklyVol = useMemo(() => {
    const m = {}; data.sessions.forEach((s) => { const k = isoWeek(s.date); m[k] = (m[k] || 0) + s.sets.reduce((a, x) => a + x.reps * x.kg, 0); });
    return Object.entries(m).sort().slice(-12).map(([k, v]) => ({ label: k.slice(5), vol: Math.round(v) }));
  }, [data.sessions]);
  const weeklyKm = useMemo(() => {
    const m = {}; data.treadmill.forEach((t) => { const k = isoWeek(t.date); m[k] = m[k] || { km: 0 }; m[k].km += t.km; });
    return Object.entries(m).sort().slice(-12).map(([k, v]) => ({ label: k.slice(5), km: +v.km.toFixed(1) }));
  }, [data.treadmill]);
  const yDomain = (vals) => { if (!vals.length) return [0, 1]; const mn = Math.min(...vals), mx = Math.max(...vals); const p = Math.max(1, (mx - mn) * 0.15); return [Math.floor(mn - p), Math.ceil(mx + p)]; };
  const trend = useMemo(() => {
    if (strength.length === 0) return null;
    const prVal = Math.max(...strength.map((r) => r.e1rm));
    let prIdx = 0; strength.forEach((r, i) => { if (r.e1rm === prVal) prIdx = i; });
    const since = strength.length - 1 - prIdx; // séances depuis le dernier record
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const win = strength.filter((r) => r.date >= cutoff);
    const d90 = win.length >= 2 && win[0].e1rm > 0 ? ((win[win.length - 1].e1rm - win[0].e1rm) / win[0].e1rm) * 100 : null;
    return { prVal, prDate: strength[prIdx].date, since, d90 };
  }, [strength]);

  return (
    <>
      <Panel boot="boot-1">
        <H>Force — 1RM estimé</H>
        {used.length === 0 ? <Empty text="Enregistre une séance pour voir la progression." /> : (
          <>
            <select value={ex} onChange={(e) => setEx(e.target.value)} className="inp mb-2">{used.map((x) => <option key={x}>{x}</option>)}</select>
            {trend && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-3" style={{ fontFamily: mono }}>
                <span style={{ color: T.amber }}>▸ record {trend.prVal.toFixed(1)} · {fmtDate(trend.prDate)}</span>
                {trend.d90 !== null && (
                  <span style={{ color: trend.d90 >= 0 ? T.cyan : T.danger }}>
                    {trend.d90 >= 0 ? "▲" : "▼"} {trend.d90 >= 0 ? "+" : ""}{trend.d90.toFixed(1)} % / 90 j
                  </span>
                )}
                {trend.since >= 5 && <span style={{ color: T.magenta }}>◆ plateau : {trend.since} séances sans record</span>}
              </div>
            )}
            <div style={{ height: 220 }} className="glow-cyan">
              <ResponsiveContainer>
                <AreaChart data={strength} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs><linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.cyan} stopOpacity={0.35} /><stop offset="100%" stopColor={T.cyan} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="rgba(0,229,255,.08)" strokeDasharray="2 4" />
                  <XAxis dataKey="label" tick={axis} axisLine={{ stroke: T.line }} tickLine={false} />
                  <YAxis domain={yDomain(strength.map((r) => r.e1rm))} tick={axis} axisLine={false} tickLine={false} />
                  <Tooltip {...tip} />
                  <Area type="monotone" dataKey="e1rm" name="e1RM (kg)" stroke={T.cyan} strokeWidth={2} fill="url(#gc)" dot={{ r: 3, fill: T.bg, stroke: T.cyan, strokeWidth: 2 }} activeDot={{ r: 5, fill: T.cyan }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="text-xs mt-3 mb-1" style={{ color: T.mute, fontFamily: mono }}>volume par séance (kg)</div>
            <div style={{ height: 140 }}>
              <ResponsiveContainer>
                <BarChart data={strength} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(0,229,255,.08)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="label" tick={axis} axisLine={{ stroke: T.line }} tickLine={false} />
                  <YAxis tick={axis} axisLine={false} tickLine={false} />
                  <Tooltip {...tip} />
                  <Bar dataKey="vol" name="Volume" fill="rgba(0,229,255,.25)" stroke={T.cyan} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Panel>

      <Panel boot="boot-2">
        <H right={weight.length ? `moy. 7 j ${weight[weight.length - 1].moy7}` : ""}>Poids corporel</H>
        {weight.length < 2 ? <Empty text="Au moins deux pesées pour tracer une courbe." /> : (
          <div style={{ height: 220 }} className="glow-magenta">
            <ResponsiveContainer>
              <LineChart data={weight} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,45,149,.08)" strokeDasharray="2 4" />
                <XAxis dataKey="label" tick={axis} axisLine={{ stroke: T.line }} tickLine={false} />
                <YAxis domain={yDomain(weight.map((r) => r.kg))} tick={axis} axisLine={false} tickLine={false} />
                <Tooltip {...tip} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: mono, color: T.mute }} />
                <Line type="monotone" dataKey="kg" name="pesée" stroke="rgba(255,45,149,.35)" strokeWidth={1} dot={{ r: 2, fill: T.magenta, strokeWidth: 0 }} />
                <Line type="monotone" dataKey="moy7" name="moyenne 7 j" stroke={T.magenta} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel boot="boot-3">
        <H>Charge hebdomadaire</H>
        {weeklyVol.length === 0 && weeklyKm.length === 0 ? <Empty text="Rien à afficher." /> : (
          <>
            {weeklyVol.length > 0 && (
              <>
                <div className="text-xs mb-1" style={{ color: T.mute, fontFamily: mono }}>volume musculation (kg / semaine)</div>
                <div style={{ height: 140 }} className="glow-cyan">
                  <ResponsiveContainer>
                    <BarChart data={weeklyVol} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(0,229,255,.08)" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="label" tick={axis} axisLine={{ stroke: T.line }} tickLine={false} />
                      <YAxis tick={axis} axisLine={false} tickLine={false} />
                      <Tooltip {...tip} />
                      <Bar dataKey="vol" name="Volume" fill={T.cyan} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
            {weeklyKm.length > 0 && (
              <>
                <div className="text-xs mt-3 mb-1" style={{ color: T.mute, fontFamily: mono }}>tapis (km / semaine)</div>
                <div style={{ height: 140 }} className="glow-violet">
                  <ResponsiveContainer>
                    <BarChart data={weeklyKm} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(122,92,255,.1)" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="label" tick={axis} axisLine={{ stroke: T.line }} tickLine={false} />
                      <YAxis tick={axis} axisLine={false} tickLine={false} />
                      <Tooltip {...tip} />
                      <Bar dataKey="km" name="km" fill={T.violet} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

// ================= Records =================
function Records({ data }) {
  const recs = useMemo(() => {
    const m = {};
    data.sessions.forEach((sess) => {
      const r = m[sess.exercise] || (m[sess.exercise] = { e1rm: 0, e1rmDate: "", e1rmSet: null, kg: 0, kgReps: 0, kgDate: "", volByDate: {}, count: 0 });
      r.count += 1;
      sess.sets.forEach((x) => {
        const v = e1rm(x.kg, x.reps);
        if (v > r.e1rm) { r.e1rm = v; r.e1rmDate = sess.date; r.e1rmSet = x; }
        if (x.kg > r.kg || (x.kg === r.kg && x.reps > r.kgReps)) { r.kg = x.kg; r.kgReps = x.reps; r.kgDate = sess.date; }
      });
      r.volByDate[sess.date] = (r.volByDate[sess.date] || 0) + sess.sets.reduce((a, x) => a + x.reps * x.kg, 0);
    });
    return Object.entries(m).map(([name, r]) => {
      const [volDate, vol] = Object.entries(r.volByDate).sort((a, b) => b[1] - a[1])[0];
      return { name, ...r, vol: Math.round(vol), volDate };
    }).sort((a, b) => b.e1rm - a.e1rm);
  }, [data.sessions]);
  const lastPR = recs.length ? recs.map((r) => r.e1rmDate).sort().pop() : null;
  return (
    <Panel boot="boot-1">
      <H right={lastPR ? `dernier record ${fmtDate(lastPR)}` : ""}>Records personnels</H>
      {recs.length === 0 ? <Empty text="Enregistre une séance pour ouvrir le palmarès." /> : (
        <ul>
          {recs.map((r, i) => (
            <li key={r.name} className="row py-3 rise" style={{ animationDelay: `${i * 35}ms` }}>
              <div className="flex items-baseline gap-2">
                <span className="text-xs" style={{ fontFamily: mono, color: i < 3 ? T.amber : T.mute }}>{pad(i + 1)}</span>
                <span className="font-medium flex-1">{r.name}</span>
                <span className="text-xs" style={{ fontFamily: mono, color: T.mute }}>{r.count} séance{r.count > 1 ? "s" : ""}</span>
              </div>
              <div className="text-xs mt-1 pl-6" style={{ fontFamily: mono }}>
                <span style={{ color: T.amber, textShadow: `0 0 8px ${T.amber}44` }} className="font-bold text-sm">{r.e1rm.toFixed(1)}</span>
                <span style={{ color: T.mute }}> e1RM · {r.e1rmSet.kg}×{r.e1rmSet.reps} · {fmtDate(r.e1rmDate)}</span>
              </div>
              <div className="text-xs mt-0.5 pl-6" style={{ fontFamily: mono, color: T.mute }}>
                charge <span style={{ color: T.cyan }}>{r.kg} kg</span> ×{r.kgReps} ({fmtDate(r.kgDate)}) · volume <span style={{ color: T.violet }}>{r.vol}</span> ({fmtDate(r.volDate)})
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ================= Célébration de record =================
function PROverlay({ pr, onClose }) {
  const [val, setVal] = useState(pr.oldBest);
  useEffect(() => {
    const t0 = performance.now(); const dur = 1400; let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3); // décélération : le chiffre "atterrit" sur le record
      setVal(pr.oldBest + (pr.newBest - pr.oldBest) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const auto = setTimeout(onClose, 5200);
    return () => { cancelAnimationFrame(raf); clearTimeout(auto); };
  }, []);
  const sparks = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * 2 * Math.PI + Math.random() * 0.4;
    const d = 90 + Math.random() * 70;
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, delay: 0.9 + Math.random() * 0.4 };
  }), []);
  return (
    <div className="pr-overlay" onClick={onClose}>
      <div className="pr-box px-8 py-10">
        <div className="pr-ring" /><div className="pr-ring pr-ring2" /><div className="pr-ring pr-ring3" />
        {sparks.map((s, i) => <span key={i} className="pr-spark" style={{ "--dx": s.dx + "px", "--dy": s.dy + "px", animationDelay: s.delay + "s" }} />)}
        <div className="pr-line text-xs" style={{ color: T.mute, fontFamily: mono, animationDelay: ".1s" }}>// analyse des séries…</div>
        <div className="pr-line text-xs mb-3" style={{ color: T.mute, fontFamily: mono, animationDelay: ".45s" }}>// record détecté</div>
        <div className="pr-line font-bold mb-1" style={{ color: T.amber, fontFamily: display, fontSize: 20, letterSpacing: ".3em", textShadow: "0 0 18px rgba(255,176,0,.8)", animationDelay: ".75s" }}>RECORD BATTU</div>
        <div className="pr-line text-sm mb-4" style={{ color: T.cyan, fontFamily: mono, animationDelay: ".9s" }}>{pr.exercise}</div>
        <div className="pr-line" style={{ animationDelay: "1s" }}>
          <span style={{ fontFamily: display, fontSize: 58, fontWeight: 700, color: T.amber, textShadow: "0 0 30px rgba(255,176,0,.65), 0 0 60px rgba(255,176,0,.3)" }}>{val.toFixed(1)}</span>
          <span className="text-base ml-2" style={{ color: T.mute, fontFamily: mono }}>kg e1RM</span>
        </div>
        <div className="pr-line text-sm mt-3" style={{ fontFamily: mono, color: T.text, animationDelay: "1.5s" }}>
          précédent {pr.oldBest.toFixed(1)} · <span style={{ color: T.amber }}>+{(pr.newBest - pr.oldBest).toFixed(1)} kg</span>
        </div>
        <div className="pr-line text-xs mt-6" style={{ color: T.mute, fontFamily: mono, animationDelay: "2.2s" }}>toucher pour fermer</div>
      </div>
    </div>
  );
}

// ================= Données =================
function Donnees({ data, setData, notify, sync, onToken, onTokenOff, onSync }) {
  const [imp, setImp] = useState("");
  const [tok, setTok] = useState("");
  const fileRef = useRef(null);
  const download = (name, content, type) => {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };
  // Partage natif (fiable en PWA iOS, permet d'envoyer vers Drive/Fichiers) ; repli téléchargement.
  const exportFile = async (name, content, type) => {
    const file = new File([content], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    download(name, content, type);
  };
  const applyImport = (text) => {
    try { const p = JSON.parse(text); if (!p.sessions || !p.weights) throw new Error(); setData({ ...EMPTY, ...p }); setImp(""); notify("Données importées"); }
    catch { notify("JSON invalide"); }
  };
  const onFile = (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    const r = new FileReader(); r.onload = () => applyImport(r.result); r.readAsText(f);
  };
  const toCSV = () => {
    const rows = [["type", "date", "groupe", "exercice", "serie", "kg", "reps", "rpe", "min", "km", "pente", "fc", "note"]];
    data.sessions.forEach((s) => s.sets.forEach((x, i) => rows.push(["muscu", s.date, s.group || "", s.exercise, i + 1, x.kg, x.reps, s.rpe ?? "", "", "", "", "", s.note])));
    data.treadmill.forEach((t) => rows.push(["tapis", t.date, "", "", "", "", "", "", t.min, t.km, t.slope, t.hr ?? "", t.note]));
    data.weights.forEach((w) => rows.push(["poids", w.date, "", "", "", w.kg, "", "", "", "", "", "", ""]));
    return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  };
  const importJSON = () => applyImport(imp);
  return (
    <>
      <Panel boot="boot-1" className="space-y-3">
        <p className="text-xs" style={{ color: T.mute, fontFamily: mono }}>{data.sessions.length} exercices · {data.treadmill.length} marches · {data.weights.length} pesées</p>
        <Btn full kind="ghost" onClick={() => exportFile("carnet.json", JSON.stringify(data, null, 2), "application/json")}>Exporter en JSON (sauvegarde)</Btn>
        <Btn full kind="ghost" onClick={() => exportFile("carnet.csv", toCSV(), "text/csv")}>Exporter en CSV (tableur)</Btn>
      </Panel>
      <Panel boot="boot-2" className="space-y-3">
        <H>Importer une sauvegarde JSON</H>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} style={{ display: "none" }} />
        <Btn full kind="quiet" onClick={() => fileRef.current.click()}>Importer un fichier carnet.json</Btn>
        <p className="text-xs text-center" style={{ color: T.mute, fontFamily: mono }}>— ou colle le contenu ci-dessous —</p>
        <textarea value={imp} onChange={(e) => setImp(e.target.value)} rows={4} placeholder="Colle ici le contenu du fichier carnet.json" className="inp" />
        <Btn full kind="quiet" onClick={importJSON}>Remplacer les données par cet import</Btn>
      </Panel>
      <Panel boot="boot-3" className="space-y-3">
        <H right={sync.at ? `dernière : ${sync.at}` : ""}>Synchronisation GitHub</H>
        {sync.hasToken ? (
          <>
            <p className="text-xs" style={{ color: T.mute, fontFamily: mono }}>{sync.status || "prête"}</p>
            <div className="flex gap-2">
              <Btn kind="quiet" small onClick={onSync}>Synchroniser maintenant</Btn>
              <Btn kind="danger" small onClick={onTokenOff}>Désactiver ici</Btn>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs" style={{ color: T.mute }}>
              Les données se chargent depuis GitHub sur tous les appareils. Pour que celui-ci puisse aussi y écrire,
              colle un jeton fine-grained limité au dépôt carnet (permission Contents en écriture).
            </p>
            {sync.status && <p className="text-xs" style={{ color: T.mute, fontFamily: mono }}>{sync.status}</p>}
            <input type="password" autoComplete="off" placeholder="github_pat_…" value={tok} onChange={(e) => setTok(e.target.value)} className="inp" />
            <Btn full kind="quiet" onClick={() => { onToken(tok); setTok(""); }}>Activer la synchronisation</Btn>
          </>
        )}
      </Panel>
      <Panel boot="boot-3" className="space-y-2">
        <H>Exercices</H>
        <ul className="text-sm">
          {data.exercises.map((x) => (
            <li key={x} className="row py-1.5 flex justify-between items-center"><span>{x}</span>
              <button type="button" className="text-xs" style={{ color: T.danger, fontFamily: mono }} onClick={() => setData({ ...data, exercises: data.exercises.filter((e) => e !== x) })}>retirer</button></li>
          ))}
        </ul>
      </Panel>
      <Panel boot="boot-4">
        <Btn full kind="danger" onClick={() => { if (window.confirm("Effacer toutes les données ?")) { setData(EMPTY); notify("Données effacées"); } }}>Tout effacer</Btn>
      </Panel>
    </>
  );
}
