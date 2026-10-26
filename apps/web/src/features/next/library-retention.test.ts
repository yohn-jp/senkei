import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { NextLibrary, type NextLibraryProps } from "./NextLibrary";

describe("Library retention explanation", () => {
  it("explains the two completed Run limit and export before replacement on the ordinary empty Library", () => {
    const props = {
      view: "library", saved: null, recovery: null, loaded: true, canSave: true,
      experiments: [], experimentsLoaded: true, restoreDifferences: { saved: [], recovery: [] },
    } as unknown as NextLibraryProps;
    const html = renderToStaticMarkup(createElement(NextLibrary, props));
    expect(html).toContain("Up to 2 completed Runs");
    expect(html).toContain("third completed Run");
    expect(html).toContain("Export experiments before");
    expect(html).toContain("Download started does not confirm");
  });
});
