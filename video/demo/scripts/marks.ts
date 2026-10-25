// Muestra las marcas del guion: npx tsx scripts/marks.ts amoblaia
const name = process.argv[2];
const mod = await import(`../src/${name}/script.ts`);
for (const [k, fn] of Object.entries(mod)) {
  if (typeof fn === "function" && k.startsWith("build")) {
    const tl = (fn as () => { marks: Record<string, number>; now: number })();
    console.log(k, JSON.stringify(tl.marks), "fin:", tl.now);
  }
}
