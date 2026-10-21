import { expect, it } from "@effect/vitest";
import { Effect, Option, Result, Schema } from "effect";

import { LoadedEditor } from "../src/client/editing/editor-session-model.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import {
  editorCalendars,
  editorDraft,
  editorOriginal,
} from "./editor-fixture.js";
import { fixtureModel } from "./fixture.js";

const movedSession = (date: string, endTime: string) =>
  LoadedEditor.make({
    baseline: editorDraft,
    calendars: editorCalendars,
    createId: Option.none(),
    direct: true,
    draft: { ...editorDraft, endDate: date, endTime, startDate: date },
    id: "held-mod-preparation",
    intent: "noEmailGesture",
    kind: "edit",
    master: Option.none(),
    moveSupport: "notAvailable",
    navigation: fixtureModel().calendar.navigation,
    operation: "save",
    original: Option.some(editorOriginal),
    selection: Option.none(),
  });

it.effect.prop(
  "held-Mod preparation always fixes eligible recurring moves and resizes to this occurrence and none while the ordinary plan keeps both decisions",
  {
    date: Schema.Literals(["2026-10-19", "2026-10-20"]),
    endTime: Schema.Literals(["11:00", "12:00", "13:00"]),
  },
  ({ date, endTime }) =>
    Effect.gen(function* occurrenceGesturePlan() {
      const session = movedSession(date, endTime);
      const normal = yield* prepareEditor({ ...session, intent: "ordinary" });
      expect(normal.prompt).toBe("scope");
      expect(normal.emailNeeded).toBe(true);
      const held = yield* prepareEditor(session);
      expect(held.scope).toBe("single");
      expect(held.sendUpdates).toBe("none");
      expect(held.prompt).toBe("none");
      expect(held.emailNeeded).toBe(false);
    })
);

it.effect.prop(
  "held intent never grants writable calendars, modify permission, unsupported types or raw-master occurrence eligibility",
  {
    canModify: Schema.Boolean,
    ordinary: Schema.Boolean,
    organizer: Schema.Boolean,
    rawMaster: Schema.Boolean,
    writable: Schema.Boolean,
  },
  ({ writable, organizer, canModify, ordinary, rawMaster }) =>
    Effect.gen(function* gesturePermissionModel() {
      const base = movedSession("2026-10-19", "11:00");

      const original = {
        ...editorOriginal,
        eventType: ordinary ? "default" : "outOfOffice",
        guestsCanModify: canModify,
        organizer: { email: "owner@example.test", self: organizer },
        originalStartTime: rawMaster
          ? undefined
          : editorOriginal.originalStartTime,
        recurrence: rawMaster ? ["RRULE:FREQ=DAILY"] : [],
        recurringEventId: rawMaster
          ? undefined
          : editorOriginal.recurringEventId,
      } satisfies typeof editorOriginal;

      const session = LoadedEditor.make({
        ...base,
        calendars: editorCalendars.map((calendar) => ({
          ...calendar,
          accessRole: writable ? "owner" : "reader",
        })),
        original: Option.some(original),
      });

      const result = yield* Effect.result(prepareEditor(session));

      const allowed =
        writable && ordinary && !rawMaster && (organizer || canModify);

      expect(Result.isSuccess(result)).toBe(allowed);
    })
);
