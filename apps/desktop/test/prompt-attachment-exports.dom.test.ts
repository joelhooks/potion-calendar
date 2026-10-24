// @effect-diagnostics-next-line nodeBuiltinImport:off -- Private source-only HTML exports retain exact local SHA-256 evidence without a browser.
import { createHash } from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The fixture producer reads bundled CSS and writes only named local review artifacts.
import { readFileSync, writeFileSync } from "node:fs";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  attachmentMeeting,
  mountAttachmentPrompt,
} from "./prompt-attachment-fixture.js";

it.effect(
  "exports actual attachment cards collapsed and expanded as source-only light/dark one/two-card fixtures",
  () =>
    Effect.gen(function* attachmentExports() {
      const css = yield* Effect.sync(() =>
        readFileSync("src/client/prompt.css", "utf-8")
      );

      const fixtures: {
        file: string;
        sha256: string;
        theme: string;
        cards: number;
        expanded: boolean;
        overflowAvailable: boolean;
      }[] = [];

      for (const theme of ["light", "dark"]) {
        for (const count of [1, 2]) {
          for (const expanded of [false, true]) {
            const events = Array.from({ length: count }, (_, index) => ({
              ...attachmentMeeting,
              attachments: [
                {
                  title:
                    "A saved design document with an intentionally long title that should truncate, never lose its accessible name",
                  url: "https://files.example.test/design",
                },
                {
                  title: "Budget & plans <2026>",
                  url: "https://files.example.test/budget",
                },
                {
                  title: "Third saved attachment",
                  url: "https://files.example.test/third",
                },
                {
                  title: "Fourth saved attachment",
                  url: "https://files.example.test/fourth",
                },
              ],
              key: {
                ...attachmentMeeting.key,
                eventId: `attachment-card-${index}`,
              },
            }));

            const rendered = yield* Effect.gen(
              function* serializeAttachmentPrompt() {
                yield* mountAttachmentPrompt(events);

                const controls = [
                  ...document.querySelectorAll<HTMLButtonElement>(
                    "[data-prompt-attachments-more]"
                  ),
                ];

                if (expanded) {
                  for (const control of controls) {
                    control.click();
                  }
                }

                return {
                  body: document.body.innerHTML,
                  overflowAvailable: controls.length === count,
                };
              }
            ).pipe(Effect.scoped);

            const file = `prompt-attachments-${theme}-380-${count}-${expanded ? "expanded" : "collapsed"}-fixture.html`;
            const html = `<!doctype html><html lang="en" style="color-scheme:${theme}"><head><meta charset="utf-8"><meta name="fixture-viewport" content="380x800"><title>Prompt attachments ${theme} ${count} ${expanded ? "expanded" : "collapsed"}</title><style>${css}</style></head><body>${rendered.body}</body></html>`;
            yield* Effect.sync(() => {
              writeFileSync(`../../.git/${file}`, html, { mode: 0o600 });
            });
            fixtures.push({
              cards: count,
              expanded,
              file,
              overflowAvailable: rendered.overflowAvailable,
              sha256: createHash("sha256").update(html).digest("hex"),
              theme,
            });
          }
        }
      }

      expect(fixtures).toHaveLength(8);
      yield* Effect.sync(() => {
        writeFileSync(
          "../../.git/prompt-attachment-fixture-manifest.json",
          JSON.stringify(
            {
              fixtures,
              method:
                "Actual isolated renderer serialized under Node DOM; no layout, native window or browser execution proof",
              schemaVersion: 1,
            },
            null,
            2
          ),
          { mode: 0o600 }
        );
      });
    })
);
