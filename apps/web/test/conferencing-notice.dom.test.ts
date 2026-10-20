import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";

import { ConferencingSaveNotice } from "../src/client/conferencing/model.js";
import type { EditorAction } from "../src/client/editing/editor-action.js";
import { conferencingSaveNotice } from "../src/features/conferencing-save-notice.js";

it.effect.prop(
  "saved conferencing notices distinguish outcome and never offer an event creation retry",
  { status: ConferencingSaveNotice.fields.status },
  ({ status }) =>
    Effect.gen(function* noticeSurface() {
      const notice = ConferencingSaveNotice.make({
        accountId: "work",
        calendarId: "primary",
        eventId: "saved-event",
        id: "write-1",
        status,
        title: "Review",
      });

      const rendered = yield* renderToString(
        {
          init: () => ({ model: notice }),
          view: (
            model: typeof ConferencingSaveNotice.Type,
            h: HtmlBuilder<typeof EditorAction.Type>
          ) => ({
            body: conferencingSaveNotice(h, model, (action) => action),
            title: "Saved event",
          }),
        },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const hints = {
        failed: "could not create",
        pending: "still creating",
        ready: "ready",
        removed: "removed",
        unconfirmed: "could not be confirmed",
      };

      expect(document.body.textContent).toContain("Event saved");
      expect(document.body.textContent).toContain(hints[status]);
      expect(
        [...document.querySelectorAll("button")].map(
          (button) => button.textContent
        )
      ).toEqual(["Dismiss"]);
    })
);
