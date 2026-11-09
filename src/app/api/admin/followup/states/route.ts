import { agentRoute } from "@/lib/followup/route";
import { canonicalClassifierOptions, readStateCatalog } from "@/lib/followup/state-catalog";
export const runtime = "nodejs";

/** Read-only authenticated catalog for the WhatsApp extension's classifier. */
export const GET = agentRoute(async () => ({
  canonical: canonicalClassifierOptions(),
  custom: (await readStateCatalog()).filter((x) => x.active && x.source === "whatsapp"),
  policy: { min_confidence: 0.7, unknown: "revisar", inactive: "revisar", absent_confidence: "revisar" },
}));
