import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Landing } from "@/components/landing";
export default function Home() {
  // Scenes are listed at build time, so new example files show up on the next deploy.
  const scenes = readdirSync(join(process.cwd(), "public/ejemplos"))
    .filter((f) => f.endsWith(".webp"))
    .map((f) => f.replace(/\.webp$/, ""));
  return (
    <Landing
      scenes={scenes}
      trial={process.env.LIVE_TRIAL_ENABLED === "true"}
    />
  );
}
