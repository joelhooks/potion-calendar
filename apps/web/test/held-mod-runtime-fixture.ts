import { CalendarEvent } from "@calendar/calendar/contracts";
import { Effect, Option, Ref } from "effect";
import { AsyncData } from "foldkit";

import { Message } from "../src/client/app.js";
import { eventKey, RemoteEvents } from "../src/client/calendar-state.js";
import { EditorMutation } from "../src/client/editing/editor-session-model.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { heldModNativeGesture } from "./held-mod-native-fixture.js";
import {
  instantRuntimeFixture,
  nextInstantNotice,
} from "./instant-runtime-fixture.js";

export const heldModScenarios = [
  "week-move",
  "repeat-resize",
  "month-move",
  "readonly",
] as const;

export type HeldModScenario = (typeof heldModScenarios)[number];

export const heldModTimes: Readonly<
  Record<HeldModScenario, Readonly<{ start: string; end: string }>>
> = {
  "month-move": {
    end: "2026-10-22T10:00:00-07:00",
    start: "2026-10-22T09:00:00-07:00",
  },
  readonly: {
    end: "2026-10-21T10:00:00-07:00",
    start: "2026-10-21T09:00:00-07:00",
  },
  "repeat-resize": {
    end: "2026-10-21T11:00:00-07:00",
    start: "2026-10-21T09:00:00-07:00",
  },
  "week-move": {
    end: "2026-10-21T12:00:00-07:00",
    start: "2026-10-21T11:00:00-07:00",
  },
};

export const heldModRuntimeFixture = Effect.fn("heldModRuntimeFixture")(
  function* heldModRuntimeFixture(input: {
    readonly scenario: HeldModScenario;
    readonly downMod?: boolean;
    readonly dropMod?: boolean;
    readonly shift?: boolean;
    readonly dropShift?: boolean;
    readonly platform?: "MacIntel" | "Win32";
    readonly organizer?: boolean;
    readonly modifiable?: boolean;
    readonly eventType?: "default" | "outOfOffice";
  }) {
    const month =
      input.scenario === "month-move" || input.scenario === "readonly";

    const recurring = input.scenario === "repeat-resize";

    const h = yield* instantRuntimeFixture({
      eventType: input.eventType ?? "default",
      modifiable: input.modifiable ?? true,
      operation: "save",
      organizer: input.organizer ?? true,
      readOnly: input.scenario === "readonly",
      recurring,
      saveTimes: heldModTimes[input.scenario],
      undo: false,
    });

    let { model } = h;

    if (month) {
      const peer = CalendarEvent.make({
        ...h.source,
        eventId: "other-meeting",
        title: "Planning",
      });

      model = {
        ...model,
        calendar: {
          ...model.calendar,
          navigation: { ...model.calendar.navigation, mode: "month" },
          reads: model.calendar.reads.map((read) => ({
            ...read,
            events: RemoteEvents.Success({
              data: { events: [h.source, peer], versions: [] },
            }),
          })),
          selected: [eventKey(h.source), eventKey(peer)],
        },
      };
    }

    yield* Ref.set(h.state, model);

    const native = yield* heldModNativeGesture({
      downMod: input.downMod ?? true,
      dropMod: input.dropMod ?? true,
      dropShift: input.dropShift ?? input.shift ?? recurring,
      model,
      platform: input.platform ?? "MacIntel",
      resize: recurring,
      shift: input.shift ?? recurring,
    }).pipe(Effect.scoped);

    if (native.refusal !== undefined) {
      yield* h.dispatch(
        Message.RefusedGesture({
          hostKey: native.hostKey,
          personId: h.personId,
          reason: native.refusal,
        })
      );
    }

    if (native.completed === undefined) {
      return {
        ...h,
        before: model,
        model: yield* Ref.get(h.state),
        native,
        saved: undefined,
      };
    }

    yield* h.dispatch(
      Message.CompletedGesture({
        gesture: native.completed,
        hostKey: native.hostKey,
        personId: h.personId,
      })
    );
    const expectedInstant = input.dropMod !== false;

    if (!expectedInstant) {
      yield* nextInstantNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          ["Scope", "Email"].includes(notice.view._tag)
      );

      return {
        ...h,
        before: model,
        model: yield* Ref.get(h.state),
        native,
        saved: undefined,
      };
    }

    const notice = yield* nextInstantNotice(
      h.queue,
      (candidate) =>
        EditingNotice.guards.Editor(candidate) &&
        Option.isSome(candidate.mutation)
    );

    if (
      !EditingNotice.guards.Editor(notice) ||
      Option.isNone(notice.mutation) ||
      !EditorMutation.guards.Saved(notice.mutation.value)
    ) {
      return yield* Effect.die("Missing saved gesture mutation");
    }

    const saved = notice.mutation.value;
    const current = yield* Ref.get(h.state);

    const beforeRead = model.calendar.reads.find(
      (read) => read.accountId === saved.event.accountId
    );

    if (beforeRead === undefined) {
      return yield* Effect.die("Missing saved gesture account");
    }

    const data = Option.getOrThrow(AsyncData.getData(beforeRead.events));
    yield* h.dispatch(
      Message.ReceivedEvents({
        accountId: saved.event.accountId,
        request: current.calendar.rangeRequest,
        result: {
          ...data,
          events: data.events.map((event) =>
            event.eventId === saved.event.eventId ? saved.event : event
          ),
        },
      })
    );

    return {
      ...h,
      before: model,
      model: yield* Ref.get(h.state),
      native,
      saved,
    };
  }
);
