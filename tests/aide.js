// Outils communs des tests : lecture des fixtures, copies figées de vrais
// fichiers du dépôt (carnet-data.json, daily/, fc/) à une date donnée. Les
// chiffres attendus dans les tests ont tous été vérifiés à la main sur ces
// fichiers avant d'être écrits en dur : un test qui casse signale qu'une
// modification de calculs.js a changé un résultat déjà validé.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ici = path.dirname(fileURLToPath(import.meta.url));
export const fixture = (rel) => path.join(ici, "fixtures", rel);
export const lire = (rel) => JSON.parse(fs.readFileSync(fixture(rel), "utf8"));
export const texte = (rel) => fs.readFileSync(fixture(rel), "utf8");
// Le fichier de synchronisation tel qu'il était le 16/09/2026 (200 saisies,
// 9 séances résumées, 9 nuits, décisions du matin depuis le 15/09).
export const carnet = () => lire("carnet-data.json");
export const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
// Empreinte git d'un fichier (sha1 de « blob <taille>\0<contenu> »), celle que
// le listage GitHub d'un dossier donne pour chaque fichier.
export const empreinte = (rel) => {
  const b = fs.readFileSync(fixture(rel));
  return crypto.createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest("hex");
};
