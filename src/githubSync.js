// Synchronisation via l'API GitHub Contents.
// Le fichier carnet-data.json (même format que l'export JSON) vit sur la
// branche main du dépôt : lecture publique sans jeton, écriture avec un
// jeton fine-grained limité à ce dépôt. Le sha sert de verrou optimiste —
// GitHub refuse d'écraser une version que l'on n'a pas lue.
const API = "https://api.github.com/repos/sylvainherbin/carnet/contents/carnet-data.json";

const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
};
const b64decode = (b64) => {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

// Fichiers FC déposés par le raccourci Apple Watch : un JSON [{t, bpm}, …]
// par entraînement, nommé fc/AAAA-MM-JJ-HHMM.json. Chaque fichier est créé une
// seule fois et jamais réécrit — aucun sha à gérer côté Raccourcis.
const FC_DIR = "https://api.github.com/repos/sylvainherbin/carnet/contents/fc";

export async function listFcFiles() {
  const r = await fetch(`${FC_DIR}?ref=main`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (r.status === 404) return []; // pas encore de dossier fc/
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  return j.filter((f) => f.type === "file" && f.name.endsWith(".json")).map((f) => f.name);
}

export async function pullFcFile(name) {
  const r = await fetch(`${FC_DIR}/${encodeURIComponent(name)}?ref=main`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  return JSON.parse(b64decode(j.content));
}

export async function pullRemote() {
  const r = await fetch(`${API}?ref=main`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (r.status === 404) return null; // pas encore de fichier distant
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(b64decode(j.content)) };
}

export async function pushRemote(data, sha, token) {
  const body = {
    message: `Synchro carnet ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    content: b64encode(JSON.stringify(data, null, 1)),
    branch: "main",
  };
  if (sha) body.sha = sha;
  const r = await fetch(API, {
    method: "PUT",
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 409 || r.status === 422) return { conflict: true }; // sha périmé : modifié ailleurs
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  return { sha: j.content.sha };
}
