import { ConferencingStatus } from "@calendar/calendar/conferencing";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { EditorView } from "../src/client/editing/editor-model.js";
import {
  editorCalendars,
  editorOriginal,
  editorViewFields,
  renderEditorFixture,
} from "./editor-fixture.js";

const calendars = editorCalendars.map((calendar) => ({
  ...calendar,
  allowedConferenceSolutionTypes: ["hangoutsMeet"],
}));

it.effect(
  "the existing editor exposes an owned draft request, removal and a separate replacement confirmation",
  () =>
    Effect.gen(function* conferencingControls() {
      const original = {
        ...editorOriginal,
        conferenceUrl: "https://meet.google.com/abc-defg-hij",
        conferencingStatus: "ready",
      } as const;

      const fields = { ...editorViewFields, original: Option.some(original) };

      const ready = yield* renderEditorFixture(
        EditorView.cases.Editing.make(fields),
        calendars
      );

      const document = new DOMParser().parseFromString(ready.html, "text/html");
      expect(
        document.querySelector<HTMLButtonElement>("#event-add-meet")?.disabled
      ).toBe(false);
      expect(document.querySelector("#event-add-meet")?.textContent).toBe(
        "Replace with Google Meet"
      );
      expect(
        document.querySelector("#event-remove-conferencing")
      ).not.toBeNull();

      const confirmation = yield* renderEditorFixture(
        EditorView.cases.ConfirmConferencing.make(fields),
        calendars
      );

      const prompt = new DOMParser().parseFromString(
        confirmation.html,
        "text/html"
      );

      expect(
        prompt.querySelector("#replace-conferencing-dialog")
      ).not.toBeNull();
      expect(
        prompt.querySelector("#replace-conferencing-dialog-confirm")
          ?.textContent
      ).toBe("Replace with Google Meet");
      expect(prompt.body.textContent).toContain("when you save");

      const requested = yield* renderEditorFixture(
        EditorView.cases.Editing.make({
          ...fields,
          draft: {
            ...fields.draft,
            conferencing: {
              participantSeen: false,
              request: { kind: "googleMeet" },
            },
          },
        }),
        calendars
      );

      const preview = new DOMParser().parseFromString(
        requested.html,
        "text/html"
      );

      expect(preview.body.textContent).toContain(
        "Google Meet will be created when you save."
      );
      expect(preview.body.textContent).not.toContain(original.conferenceUrl);
      expect(
        preview.querySelector<HTMLButtonElement>("#event-add-meet")?.disabled
      ).toBe(true);
    })
);

it.effect(
  "a ready native conference without a web URL is not labelled absent or given an invented Join link",
  () =>
    Effect.gen(function* noWebJoin() {
      const rendered = yield* renderEditorFixture(
        EditorView.cases.Editing.make({
          ...editorViewFields,
          original: Option.some({
            ...editorOriginal,
            conferencingStatus: "ready",
          }),
        }),
        calendars
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(
        document.querySelector('[aria-label="Conferencing"]')?.textContent
      ).toContain("Conferencing is ready. No web Join link is available.");
      expect(document.querySelector("#event-add-meet")?.textContent).toBe(
        "Replace with Google Meet"
      );
      expect(
        document.querySelector('[aria-label="Conferencing"] a')
      ).toBeNull();
    })
);

it.effect.prop(
  "readback states are not silently labelled ready",
  { status: ConferencingStatus },
  ({ status }) =>
    Effect.gen(function* readbackControl() {
      const rendered = yield* renderEditorFixture(
        EditorView.cases.Editing.make({
          ...editorViewFields,
          original: Option.some({
            ...editorOriginal,
            conferenceUrl:
              status === "ready"
                ? "https://meet.google.com/abc-defg-hij"
                : undefined,
            conferencingStatus: status,
          }),
        }),
        calendars
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const content = document.querySelector(
        '[aria-label="Conferencing"]'
      )?.textContent;

      if (status === "ready") {
        expect(content).toContain("Google Meet");
        expect(
          document
            .querySelector('[aria-label="Conferencing"] a')
            ?.getAttribute("href")
        ).toBe("https://meet.google.com/abc-defg-hij");
      } else {
        expect(content).not.toContain("https://meet.google.com/abc-defg-hij");

        const hints = {
          failed: "couldn't create a Meet link",
          pending: "is creating",
          unconfirmed: "couldn't be confirmed",
        };

        expect(content).toContain(hints[status]);

        if (status === "failed") {
          expect(document.querySelector("#event-add-meet")?.textContent).toBe(
            "Try again"
          );
          expect(
            document.querySelector("#event-remove-conferencing")?.textContent
          ).toBe("Remove");
        }
      }
    })
);

it.effect.prop(
  "Meet capability and Google edit permission both gate the control with a reason",
  { supported: Schema.Boolean, writable: Schema.Boolean },
  ({ supported, writable }) =>
    Effect.gen(function* capabilityControl() {
      const rendered = yield* renderEditorFixture(
        EditorView.cases.Editing.make({
          ...editorViewFields,
          permissions: {
            ...editorViewFields.permissions,
            calendarWritable: writable,
            editMeeting: writable,
          },
        }),
        calendars.map((calendar) => ({
          ...calendar,
          accessRole: writable ? "owner" : "reader",
          allowedConferenceSolutionTypes: supported ? ["hangoutsMeet"] : [],
        }))
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(
        document.querySelector<HTMLButtonElement>("#event-add-meet")?.disabled
      ).toBe(!writable || !supported);

      const description = document.querySelector(
        "#event-meet-availability"
      )?.textContent;

      if (writable && supported) {
        expect(description).toBeUndefined();
      } else {
        expect(description).toContain(
          writable ? "can't add Google Meet" : "read-only"
        );
      }
    })
);
