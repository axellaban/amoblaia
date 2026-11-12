// QA 12/11 am: a guest visiting its panel (no account yet) tapped «Importar
// fotos con un clic». Every photo's request came back «create your account»,
// but the import kept going photo by photo: the account dialog was opened
// again for each one (16 times in a few seconds in a real session) and the
// funnel counted one «panel_visit_account_asked» per photo. Now the first
// answer stops the import and the dialog is asked for once.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ApiError, setVisiting, VISIT_ACCOUNT_EVENT, VisitAccountError } from "../src/components/admin-demos";
import { syncPhotos } from "../src/components/demo-import";

const target = new EventTarget();
const asked: string[] = [];
target.addEventListener(VISIT_ACCOUNT_EVENT, (e) => asked.push((e as CustomEvent<{ action: string }>).detail.action));

function stubWindow() {
  vi.stubGlobal("window", target);
  vi.stubGlobal("CustomEvent", class extends Event {
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      super(type);
      this.detail = init?.detail;
    }
  });
}

afterEach(() => {
  setVisiting(false);
  asked.length = 0;
  vi.unstubAllGlobals();
});

const photos = Array.from({ length: 16 }, (_, i) => `https://portal.example/fotos/${i + 1}.jpg`);

describe("the guest's import asks for the account once", () => {
  it("stops at the first «create your account» instead of trying every photo", async () => {
    stubWindow();
    setVisiting(true);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "Creá tu cuenta para guardar." }), { status: 401 }));
    vi.stubGlobal("fetch", fetch);

    const run = syncPhotos("/api/admin/demos/11111111-2222-3333-4444-555555555555", photos, () => undefined);
    await expect(run).rejects.toBeInstanceOf(VisitAccountError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(asked).toEqual(["POST /api/admin/demos/:id/photos"]);
  });

  it("the agency's 403 «visita» stops it too", async () => {
    stubWindow();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "Necesitás tu cuenta.", code: "visita" }), { status: 403 }));
    vi.stubGlobal("fetch", fetch);

    await expect(syncPhotos("/api/admin/demos/x", photos, () => undefined)).rejects.toThrow("Necesitás tu cuenta.");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(asked).toHaveLength(1);
  });

  it("other failures still skip only that photo and go on", async () => {
    stubWindow();
    let n = 0;
    const fetch = vi.fn(async () =>
      ++n === 1 ? new Response(JSON.stringify({ error: "La foto ya no está en el sitio (error 404)." }), { status: 502 }) : new Response(JSON.stringify({ id: `p${n}` }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);

    const sync = await syncPhotos("/api/admin/demos/x", photos.slice(0, 3), () => undefined);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sync.failedUrls).toEqual([photos[0]]);
    expect(sync.done).toHaveLength(2);
    expect(asked).toHaveLength(0);
    expect(new VisitAccountError("x", 401, {})).toBeInstanceOf(ApiError);
  });
});
