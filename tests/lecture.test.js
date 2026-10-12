import { test } from "node:test";
import assert from "node:assert/strict";
import { lecture, lireJeton, pullRemote, listFcFiles } from "../src/githubSync.js";

// Lecture GitHub : avec jeton si présent (5 000 requêtes par heure au lieu de 60
// par adresse IP), repli sans jeton s'il est refusé (401), jamais de nouvelle
// tentative sur une limite atteinte (403).
const b64 = (s) => Buffer.from(s).toString("base64");
const reponse = (status, corps = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => corps });
const installer = (jeton, reponses) => {
  const appels = [];
  globalThis.localStorage = { getItem: (k) => (k === "carnet-gh-token" ? jeton : null) };
  globalThis.fetch = async (url, opts) => { appels.push({ url, auth: opts?.headers?.Authorization ?? null }); return reponses.shift(); };
  return appels;
};

test("sans jeton : une lecture anonyme", async () => {
  const appels = installer(null, [reponse(200)]);
  assert.equal((await lecture("https://x/y")).status, 200);
  assert.deepEqual(appels, [{ url: "https://x/y", auth: null }]);
});

test("avec jeton : une lecture authentifiée", async () => {
  const appels = installer("tok", [reponse(200)]);
  await lecture("https://x/y");
  assert.deepEqual(appels, [{ url: "https://x/y", auth: "Bearer tok" }]);
});

test("jeton refusé (401) : repli sans jeton, la lecture publique aboutit", async () => {
  const appels = installer("perime", [reponse(401), reponse(200)]);
  assert.equal((await lecture("https://x/y")).status, 200);
  assert.deepEqual(appels.map((a) => a.auth), ["Bearer perime", null]);
});

test("limite atteinte (403) : pas de nouvelle tentative, l'erreur remonte", async () => {
  const appels = installer("tok", [reponse(403), reponse(200)]);
  assert.equal((await lecture("https://x/y")).status, 403);
  assert.equal(appels.length, 1);
});

test("stockage inaccessible : lecture anonyme, sans exception", async () => {
  globalThis.localStorage = { getItem: () => { throw new Error("privé"); } };
  assert.equal(lireJeton(), "");
});

test("pullRemote et listFcFiles passent par la même lecture", async () => {
  let appels = installer("tok", [reponse(200, { sha: "abc", content: b64('{"sessions":[]}') })]);
  assert.deepEqual(await pullRemote(), { sha: "abc", data: { sessions: [] } });
  assert.equal(appels[0].auth, "Bearer tok");
  appels = installer("tok", [reponse(200, [{ type: "file", name: "2026-10-12-1230.json", sha: "s" }, { type: "dir", name: "x" }])]);
  assert.deepEqual(await listFcFiles(), ["2026-10-12-1230.json"]);
  assert.equal(appels[0].auth, "Bearer tok");
  installer("tok", [reponse(403)]);
  await assert.rejects(pullRemote(), /GitHub 403/);
});
