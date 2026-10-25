// Baja la música de cada video desde Mixkit (Mixkit Stock Music Free License: uso comercial
// permitido dentro del video; no se redistribuyen los archivos sueltos, por eso no van al repo).
// Uso: node scripts/fetch-music.mjs
import fs from "node:fs";
import path from "node:path";

export const TRACKS = {
  "amoblaia.mp3": { id: 175, title: "Digital Clouds", author: "Alejandro Magaña (A. M.)" },
};

const dir = path.resolve("public/music");
fs.mkdirSync(dir, { recursive: true });
for (const [file, t] of Object.entries(TRACKS)) {
  const dest = path.join(dir, file);
  if (fs.existsSync(dest)) continue;
  const res = await fetch(`https://assets.mixkit.co/music/${t.id}/${t.id}.mp3`);
  if (!res.ok) throw new Error(`No pude bajar «${t.title}» (${res.status})`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`✓ ${file}: «${t.title}» de ${t.author} (Mixkit)`);
}
