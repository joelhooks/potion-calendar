import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  applyEditorConferencingDefault,
  hasEditorConferencing,
  requestEditorConferencing,
  withoutConferenceLinks,
} from "../src/client/editing/conferencing-draft.js";
import { draftChanges, draftEventFields } from "../src/layout/editor-fields.js";
import {
  editorCalendars,
  editorDraft,
  editorOriginal,
} from "./editor-fixture.js";

const calendars = editorCalendars.map((calendar) => ({
  ...calendar,
  allowedConferenceSolutionTypes: ["hangoutsMeet"],
}));

const context = {
  accounts: [
    { accountId: "work", email: "owner@example.test", setting: "googleMeet" },
  ],
} as const;

it.effect.prop(
  "the draft default excludes self and resources, fires once on the first human and preserves explicit removal",
  {
    count: Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 })),
    title: Schema.String,
  },
  ({ count, title }) =>
    Effect.sync(() => {
      const base = {
        calendars,
        conferencingContext: context,
        draft: { ...editorDraft, attendees: [], title },
        kind: "create",
        original: Option.none(),
      } as const;

      const rooms = applyEditorConferencingDefault({
        ...base,
        draft: {
          ...base.draft,
          attendees: [
            { email: "OWNER@example.test" },
            { email: "room@example.test", resource: true },
            { email: "alias@example.test", self: true },
          ],
        },
      });

      expect(rooms.conferencing).toEqual({
        participantSeen: false,
        request: undefined,
      });

      const guests = Array.from({ length: count }, (_, index) => ({
        email: `guest-${index}@example.test`,
      }));

      const added = applyEditorConferencingDefault({
        ...base,
        draft: { ...rooms, attendees: guests },
      });

      expect(added.conferencing).toEqual({
        participantSeen: true,
        request: { kind: "googleMeet" },
      });
      expect(added.title).toBe(title);

      const removed = requestEditorConferencing(
        { ...base, draft: added },
        { kind: "none" }
      );

      const again = applyEditorConferencingDefault({
        ...base,
        draft: {
          ...removed,
          attendees: [...guests, { email: "later@example.test" }],
        },
      });

      expect(again.conferencing).toEqual({
        participantSeen: true,
        request: { kind: "none" },
      });

      const existing = applyEditorConferencingDefault({
        ...base,
        draft: { ...base.draft, attendees: guests },
        kind: "edit",
        original: Option.some(editorOriginal),
      });

      expect(existing.conferencing?.request).toBeUndefined();
    })
);

it.effect(
  "removing recognized conferencing preserves surrounding text, punctuation, unrelated links and temporal fields",
  () =>
    Effect.gen(function* removeLinkSpans() {
      const description =
        "Bring notes (https://ZOOM.US/j/123), https://docs.example.test/agenda.";

      const location =
        "Studio: https://meet.google.com/abc-defg-hij; north door";

      const editor = {
        calendars,
        draft: { ...editorDraft, description, location },
        kind: "edit",
        original: Option.some(editorOriginal),
      } as const;

      expect(hasEditorConferencing(editor)).toBe(true);
      const removed = requestEditorConferencing(editor, { kind: "none" });
      expect(removed.description).toBe(
        "Bring notes (), https://docs.example.test/agenda."
      );
      expect(removed.location).toBe("Studio: ; north door");
      expect({
        ...removed,
        conferencing: undefined,
        description,
        location,
      }).toEqual({ ...editor.draft, conferencing: undefined });
      expect(withoutConferenceLinks("https://docs.example.test/agenda")).toBe(
        "https://docs.example.test/agenda"
      );

      const fields = yield* draftEventFields(removed);
      expect(draftChanges(removed, editorDraft, fields).noEmailOnly).toBe(
        false
      );
    })
);

it.effect.prop(
  "unset, None, unknown and unsupported calendars do not invent a draft Meet request",
  {
    setting: Schema.Literals(["unset", "none"]),
  },
  ({ setting }) =>
    Effect.sync(() => {
      const base = {
        calendars,
        draft: { ...editorDraft, attendees: [{ email: "guest@example.test" }] },
        kind: "create",
        original: Option.none(),
      } as const;

      expect(
        applyEditorConferencingDefault(base).conferencing?.request
      ).toBeUndefined();
      expect(
        applyEditorConferencingDefault({
          ...base,
          conferencingContext: {
            accounts: [{ ...context.accounts[0], setting }],
          },
        }).conferencing?.request
      ).toBeUndefined();
      expect(
        applyEditorConferencingDefault({
          ...base,
          calendars: editorCalendars.map((calendar) => ({
            ...calendar,
            allowedConferenceSolutionTypes: [],
          })),
          conferencingContext: context,
        }).conferencing?.request
      ).toBeUndefined();
    })
);
