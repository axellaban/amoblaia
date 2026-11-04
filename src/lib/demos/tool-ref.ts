// A tool job's source_ref: what the tool starts from ("original",
// "generation:<id>" or "retouch:<id>") and, since a demo photo's project can be
// shared by several demos (the team reuses its copies), the photo that asked
// for it, so its result lands on that photo: "original|photo:<photoId>".

export type ToolRef = { kind: "original" | "generation" | "retouch"; id: string | null; photoId: string | null };

/** The stored value: the source, then the photo that asked. */
export const toolRef = (source: string, photoId: string) => `${source}|photo:${photoId}`;

/** Reads a stored value; older jobs carry only the source. */
export function parseToolRef(raw: string | null | undefined): ToolRef {
  const [source = "original", ...tags] = (raw || "original").split("|");
  const photo = tags.find((t) => t.startsWith("photo:"))?.slice("photo:".length) || null;
  const [kind, id] = source.split(":");
  return kind === "generation" || kind === "retouch"
    ? { kind, id: id || null, photoId: photo }
    : { kind: "original", id: null, photoId: photo };
}
