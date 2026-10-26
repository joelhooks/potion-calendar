import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate } from "effect";

import { EditorView } from "../src/client/editing/editor-model.js";
import { draftEventFields } from "../src/layout/editor-fields.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { writeBody } from "./editing-rpc-fixture.js";
import { fulldayModel, mountedFullday } from "./fullday-fixture.js";
import { fulldaySession } from "./fullday-runtime-fixture.js";

const dates = [
  ["2028-02-29", "2028-03-01"],
  ["2026-12-31", "2027-01-01"],
  ["2026-01-31", "2026-02-01"],
  ["2026-03-08", "2026-03-09"],
  ["2026-11-01", "2026-11-02"],
] as const;

for (const [date, exclusiveEnd] of dates) {
  it.effect(
    `native calendar boundary ${date} saves exactly one date ending ${exclusiveEnd}`,
    () =>
      Effect.gen(function* calendarBoundary() {
        const base = fulldayModel("timed");

        const model = {
          ...base,
          calendar: {
            ...base.calendar,
            navigation: {
              ...base.calendar.navigation,
              anchor: dayFromIso(date),
              mode: "day" as const,
            },
          },
        };

        const h = yield* mountedFullday(model, "MacIntel");
        const cell = yield* Effect.fromNullishOr(h.cells.at(-1));
        expect(Number(cell.dataset.day)).toBe(dayFromIso(date));
        yield* h.click(cell, 100, 1439, { mod: true });
        expect(h.commands).toHaveLength(0);
        yield* h.click(cell, 300, 1439, { mod: true });
        expect(h.commands).toHaveLength(1);
        expect(
          h.messages.filter((message) =>
            Predicate.isTagged(message, "CompletedGesture")
          )
        ).toHaveLength(1);
        const command = yield* Effect.fromNullishOr(h.commands[0]);
        const session = yield* fulldaySession(h.get(), command, date);

        const editor = yield* Effect.fromOption(
          Option.some(session.opened.editing.view).pipe(
            Option.filter(EditorView.guards.Editing)
          )
        );

        expect(editor.draft.allDay).toBe(true);
        expect(editor.draft.startDate).toBe(date);
        expect(editor.draft.endDate).toBe(date);
        expect(editor.draft.reminders).toEqual({
          overrides: [],
          useDefault: false,
        });
        const fields = yield* draftEventFields(editor.draft);
        expect(fields.start).toEqual({ date });
        expect(fields.end).toEqual({ date: exclusiveEnd });
        const saved = yield* session.save();
        expect(saved.rpc).toHaveLength(1);
        expect(saved.requests.map((request) => request.method)).toEqual([
          "GET",
          "POST",
        ]);
        const body = writeBody(saved.requests.at(-1)?.body);
        expect(body.start).toEqual({ date });
        expect(body.end).toEqual({ date: exclusiveEnd });
        expect(body.reminders).toEqual({ overrides: [], useDefault: false });
      }).pipe(Effect.scoped)
  );
}
