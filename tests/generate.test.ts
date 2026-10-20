import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createSession } from "../src/lib/session";
const state = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (state.token ? { value: state.token } : undefined),
  }),
}));
import { POST } from "../src/app/api/generate/route";
const password = "a-strong-pilot-password-for-tests";
async function request({ badFile = false, room = "living" } = {}) {
  const body = new FormData();
  body.set(
    "image",
    new Blob(
      [
        badFile
          ? "not an image"
          : new Uint8Array(
              await sharp({
                create: {
                  width: 400,
                  height: 300,
                  channels: 3,
                  background: "#ddd",
                },
              })
                .jpeg()
                .toBuffer(),
            ),
      ],
      { type: "image/jpeg" },
    ),
    "room.jpg",
  );
  body.set("room", room);
  body.set("style", "modern");
  body.set("mode", "furnish");
  return new Request("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    body,
  });
}
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key-never-real");
  vi.stubEnv("STUDIO_ACCESS_PASSWORD", password);
  state.token = createSession(password);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Pipeline de generación", () => {
  it("bloquea generación sin sesión antes de llamar al proveedor", async () => {
    state.token = undefined;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await POST(await request())).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rechaza bytes falsos e identificadores no permitidos", async () => {
    expect((await POST(await request({ badFile: true }))).status).toBe(400);
    expect((await POST(await request({ room: "invalid" }))).status).toBe(400);
  });
  it("envía la foto normalizada al proveedor y devuelve un JPG sin cache", async () => {
    const image = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#b9d4a0" },
    })
      .jpeg()
      .toBuffer();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: [{ b64_json: image.toString("base64") }] }),
      );
    vi.stubGlobal("fetch", fetch);
    const response = await POST(await request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const metadata = await sharp(
      Buffer.from(await response.arrayBuffer()),
    ).metadata();
    expect(metadata.format).toBe("jpeg");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect(options.body.get("quality")).toBe("high");
    expect(options.body.get("model")).toBe("gpt-image-2.5-sunburst");
    expect(options.body.get("image")).toBeInstanceOf(Blob);
  });
  it("maneja saldo agotado sin filtrar la respuesta del proveedor", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: "private upstream detail" } },
            { status: 429 },
          ),
        ),
    );
    const response = await POST(await request());
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain("private upstream detail");
  });
});
