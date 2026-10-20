import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { ClipboardView } from "../src/client/clipboard/model.js";
import { view } from "../src/features/app.js";
import { fixtureSelection } from "./fixture.js";

it.effect(
  "exports the mounted saved notice inside both viewport sizes without shrinking the calendar workspace",
  () =>
    Effect.gen(function* savedNoticeArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const theme of ["light", "dark"] as const) {
        for (const width of [1440, 900]) {
          const fixture = fixtureSelection();

          const model = {
            ...fixture,
            clipboard: {
              ...fixture.clipboard,
              sessionId: Option.some("fixture-clipboard-session"),
              view: ClipboardView.cases.Idle.make({
                copied: Option.none(),
                toast: Option.some({
                  id: "copied-event",
                  message: "Event copied.",
                }),
              }),
            },
            editing: {
              ...fixture.editing,
              conferencingResult: Option.some({
                accountId: "work",
                calendarId: "primary",
                eventId: "saved-event",
                id: "saved-mutation",
                status: "unconfirmed" as const,
                title: "Design review",
              }),
            },
            settings: { ...fixture.settings, theme },
          };

          const rendered = yield* renderToString(
            { init: () => ({ model }), view },
            { isHydratable: false }
          );

          const document = new DOMParser().parseFromString(
            rendered.html,
            "text/html"
          );

          const notice = document.querySelector<HTMLElement>(
            '[aria-label="Saved event conferencing"]'
          );

          expect(
            document.querySelector<HTMLElement>(".notification-stack")?.style
              .position
          ).toBe("fixed");
          expect(
            document.querySelector<HTMLElement>(".notification-stack")?.style
              .bottom
          ).toBe("24px");
          expect(notice?.style.position).toBe("");
          expect(
            document.querySelectorAll(
              ".view-controls button, .view-controls select, .detail-panel button, .detail-panel input, .detail-panel textarea, .detail-panel select, .detail-panel a, .clipboard-toast"
            ).length
          ).toBeGreaterThanOrEqual(14);
          expect(
            document.querySelector(".detail-panel textarea")
          ).not.toBeNull();
          expect(
            [...document.querySelectorAll(".detail-panel button")].map(
              (button) => button.textContent?.trim()
            )
          ).toEqual(
            expect.arrayContaining([
              "Edit",
              "Duplicate",
              "Delete",
              "Yes",
              "No",
              "Maybe",
              "Join meeting ↗",
            ])
          );
          expect(notice?.textContent).toContain("could not be confirmed");

          const script = `
          const notice = document.querySelector('[aria-label="Saved event conferencing"]');
          const rect = notice.getBoundingClientRect();
          const pageOverflow = document.documentElement.scrollWidth > innerWidth + 1;
          const noticeClipped = rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight || notice.scrollWidth > notice.clientWidth + 1;
          const protectedBounds = [...document.querySelectorAll('.view-controls button, .view-controls select, .detail-panel button, .detail-panel input, .detail-panel textarea, .detail-panel select, .detail-panel a, .clipboard-toast')].map((element) => {
            const other = element.getBoundingClientRect();
            return { label: element.getAttribute('aria-label') ?? element.textContent.trim(), left: other.left, right: other.right, top: other.top, bottom: other.bottom, overlaps: rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top };
          });
          const collisions = protectedBounds.filter((value) => value.overlaps);
          const clipboard = document.querySelector('.clipboard-toast').getBoundingClientRect();
          const stackGap = clipboard.top - rect.bottom;
          document.documentElement.dataset.conferencingGeometryProof = JSON.stringify({ pageOverflow, noticeClipped, collisions, protectedBounds, stackGap, bounds: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, viewport: { width: innerWidth, height: innerHeight } });
          document.documentElement.dataset.conferencingLayoutProof = !pageOverflow && !noticeClipped && protectedBounds.length >= 14 && collisions.length === 0 && stackGap >= 11 ? 'pass' : 'fail';
          document.documentElement.dataset.fixtureReady = 'conferencing';
        `;

          yield* fs.writeFileString(
            `../../.git/conferencing-saved-notice-${theme}-${width}-fixture.html`,
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Saved conferencing notice</title><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`
          );
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
