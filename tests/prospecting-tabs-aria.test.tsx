import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProspectingApp } from "@/components/prospecting/app";

describe("prospecting tabs", () => {
  it("does not point aria-controls at a panel that is not rendered (axe aria-valid-attr-value)", () => {
    // Before the dataset loads there is no tabpanel, and only the active tab owns one afterwards.
    const html = renderToStaticMarkup(<ProspectingApp initialTab="resumen" />);
    expect(html).toContain('id="pr-tab-resumen"');
    expect(html).not.toContain("aria-controls");
    expect(html).not.toContain('id="pr-panel-');
  });
});
