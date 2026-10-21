import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { view } from "../src/features/app.js";
import { editorDraft, editorViewFields } from "./editor-fixture.js";
import { fixtureEvents, fixtureSelection } from "./fixture.js";

const fixtures = [
  { theme: "light", width: 1440 },
  { theme: "dark", width: 1440 },
  { theme: "light", width: 900 },
  { theme: "dark", width: 900 },
] as const;

const fixtureHtml = (
  body: string,
  css: string,
  width: number
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Links and read-only attachments</title><style>${css}</style></head><body>${body}<script>
const dialog = document.querySelector('dialog');
if (dialog) { dialog.showModal(); const links = document.querySelector('#event-links'); if (links) links.scrollIntoView({block:'center'}); }
requestAnimationFrame(() => {
  const root = document.querySelector('#event-links') || document.querySelector('.detail-panel');
  const rect = root.getBoundingClientRect();
  const pageOverflow = document.documentElement.scrollWidth > innerWidth;
  const contentOverflow = root.scrollWidth > root.clientWidth + 1;
  const controls = [...root.querySelectorAll('a')].map(node => { const r = node.getBoundingClientRect(); return {label:node.textContent, left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height}; });
  const clipped = controls.filter(r => r.left < rect.left - 1 || r.right > rect.right + 1 || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight);
  const unsafe = [...document.querySelectorAll('a')].filter(a => a.closest('.detail-panel, #event-links') && (!['http:','https:','mailto:'].includes(new URL(a.href).protocol) || a.target !== '_blank' || a.rel !== 'noopener noreferrer'));
  document.documentElement.dataset.eventLinksGeometry = JSON.stringify({pageOverflow,contentOverflow,clipped,unsafe:unsafe.length,controls});
  document.documentElement.dataset.eventLinksLayoutProof = !pageOverflow && !contentOverflow && clipped.length === 0 && unsafe.length === 0 ? 'pass' : 'fail';
  document.documentElement.dataset.fixtureReady = 'event-links';
});
</script></body></html>`;

const verifyRenderedScene = (document: Document, scene: string): void => {
  const root = document.querySelector(
    scene === "editor" ? "#event-links" : ".detail-panel"
  );

  if (root === null) {
    throw new Error("Missing event links fixture root");
  }

  expect(document.querySelectorAll(".event-attachments img")).toHaveLength(0);

  const anchors = [...root.querySelectorAll("a")];

  for (const anchor of anchors) {
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
    expect(anchor.href).not.toContain("meet.google.com");
  }

  const attachments = root.querySelector(".event-attachments");

  if (scene === "out-of-office") {
    expect(attachments).toBeNull();
    expect(anchors).toHaveLength(0);

    return;
  }

  if (attachments === null) {
    throw new Error("Missing attachment list");
  }

  expect(attachments.textContent).not.toContain("application/pdf");
  expect(attachments.textContent).not.toContain("text/html");

  if (scene === "unsafe") {
    expect(anchors.map((anchor) => anchor.href)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^(?:javascript|file|data):/u),
      ])
    );
    expect(attachments.textContent).toContain(
      "Project review.pdf · This file can't be opened from here."
    );
    // oxlint-disable-next-line eslint/no-script-url -- The refusal proof must ensure executable URL text never reaches an attachment row.
    expect(attachments.textContent).not.toContain("javascript:");

    return;
  }

  expect(anchors.some((anchor) => anchor.href.includes("maps/search"))).toBe(
    true
  );
  expect(
    anchors.find((anchor) => anchor.href.startsWith("mailto:"))?.textContent
  ).toBe("team@example.test");
  expect(attachments.textContent).toContain("PDF");
};

it.effect.each(fixtures)(
  "exports actual roots for details, editor, unsafe and out-of-office with shared CSS: %s",
  ({ theme, width }) =>
    Effect.gen(function* eventLinkArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const base = Option.getOrThrow(Option.fromUndefinedOr(fixtureEvents[0]));

      for (const scene of [
        "details",
        "editor",
        "unsafe",
        "out-of-office",
      ] as const) {
        const event: CalendarEventValue = {
          ...base,
          attachments: [
            {
              iconUrl:
                "https://drive-thirdparty.googleusercontent.com/pdf-icon",
              mimeType: "application/pdf",
              title: "Project review.pdf",
              url:
                scene === "unsafe"
                  ? `javascript:${"blocked".repeat(35)}`
                  : "https://drive.google.com/file/d/project-review/view",
            },
            {
              mimeType: "text/html",
              title: "Meeting agenda",
              url: "https://example.test/agenda",
            },
          ],
          attendees: [],
          conferenceUrl: "https://meet.google.com/abc-defg-hij",
          description:
            scene === "unsafe"
              ? `Read file:///private/document and data:text/html,<script>alert(1)</script>\n${"x".repeat(200)}`
              : "Review https://example.test/project/notes and email mailto:team@example.test.\nJoin https://meet.google.com/abc-defg-hij",
          eventType: scene === "out-of-office" ? "outOfOffice" : "default",
          location:
            scene === "unsafe"
              ? `javascript:${"unsafe".repeat(40)}`
              : "123 Main Street, San Francisco",
          title:
            scene === "out-of-office"
              ? "Out of office"
              : "Project review and reference files",
        };

        const fixture = fixtureSelection();

        const draft = {
          ...editorDraft,
          attachments: event.attachments,
          description: event.description ?? "",
          eventType: event.eventType,
          location: event.location ?? "",
          title: event.title ?? "",
        };

        const model: AppModel = {
          ...fixture,
          calendar: {
            ...fixture.calendar,
            reads: [
              {
                accountId: event.accountId,
                events: RemoteEvents.Success({
                  data: { events: [event], versions: [] },
                }),
              },
            ],
            viewportWidth: width - (width <= 1000 ? 445 : 520),
          },
          editing: {
            ...fixture.editing,
            view:
              scene === "editor"
                ? EditorView.cases.Editing.make({
                    ...editorViewFields,
                    draft,
                    original: Option.some(event),
                  })
                : EditorView.cases.Closed.make({}),
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

        verifyRenderedScene(document, scene);

        yield* fs.writeFileString(
          `../../.git/event-links-${scene}-${theme}-${width}-fixture.html`,
          fixtureHtml(rendered.html, css, width)
        );
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
