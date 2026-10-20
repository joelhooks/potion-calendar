import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

it.effect("DOM tests run in the JSDOM project", () =>
  Effect.sync(() => {
    expect(globalThis.document).toBeDefined();
    expect(document.defaultView?.navigator.userAgent).toContain("jsdom");
  })
);
