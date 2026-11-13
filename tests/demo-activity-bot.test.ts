import { describe, expect, it } from "vitest";
import { activityVerdict } from "@/lib/demos/activity-verdict";

// QA 2026-11-13 am: visitas nocturnas a demos que el registro de leads marcó como
// `bot` contaban como visitas reales en `demo_activity` y movían «Demo visitada».
const external = { internal: false, reason: null };

describe("activityVerdict", () => {
  it("marca como bot lo que el registro de leads ya trata como bot", () => {
    for (const ua of [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "WhatsApp/2.23.20.0 A",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    ])
      expect(activityVerdict(external, ua)).toEqual({ internal: true, reason: "bot" });
  });

  it("deja como visita real a un navegador de celular, también el interno de WhatsApp", () => {
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14; SM-A146M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 WA4A/2.25.1",
    ])
      expect(activityVerdict(external, ua)).toEqual(external);
    expect(activityVerdict(external, null)).toEqual(external);
  });

  it("el equipo conserva su motivo aunque además parezca un bot", () => {
    const team = { internal: true, reason: "team_session" };
    expect(activityVerdict(team, "HeadlessChrome")).toEqual(team);
  });
});
