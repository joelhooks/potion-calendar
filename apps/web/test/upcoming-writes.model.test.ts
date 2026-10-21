import { Provider } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import { RemoteCalendars, calendarKey } from "../src/client/calendar-state.js";
import {
  DeleteIntent,
  DeleteOutcome,
} from "../src/client/editing/delete-actor.js";
import { DeleteNotice } from "../src/client/editing/deletion-session.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  EditorMutation,
  LoadedEditor,
} from "../src/client/editing/editor-session-model.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import {
  RsvpIntent,
  RsvpResult,
  RsvpView,
} from "../src/client/editing/rsvp-machine.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { normalizePreferences } from "../src/client/settings/model.js";
import { createDraft } from "../src/layout/editor-draft.js";
import { primarySelection } from "../src/layout/selection-set.js";
import {
  upcomingCalendars,
  upcomingFixture,
  upcomingPerson,
  upcomingResult,
  savedUpcomingEvent,
} from "./upcoming-fixture.js";

const failure = new Provider({
  message: "Write refused",
  operation: "write",
  status: 403,
});

const primaryKey = calendarKey(
  savedUpcomingEvent.accountId,
  savedUpcomingEvent.calendarId
);

const deliver = (notice: typeof EditingNotice.Type) =>
  Message.ReceivedEditing({ notice, personId: upcomingPerson });

type WriteKind = "create" | "edit" | "delete" | "conferencing" | "rsvp";

const writeFixture = Effect.fn("writeFixture")(function* writeFixture(
  kind: WriteKind,
  selected: boolean,
  success: boolean
) {
  const base = upcomingFixture(selected ? [] : [primaryKey]);
  const event = savedUpcomingEvent;

  if (kind === "delete") {
    const intent = DeleteIntent.make({
      event,
      id: "upcoming-delete",
      navigation: base.calendar.navigation,
      request: {
        accountId: event.accountId,
        calendarId: event.calendarId,
        eventId: event.eventId,
        scope: "single",
        sendUpdates: "none",
      },
      selection: primarySelection(base.calendar.selected),
      title: event.title ?? "Event",
    });

    const pending = update(
      base,
      deliver(
        EditingNotice.cases.Delete.make({
          notice: DeleteNotice.cases.Changed.make({
            intent,
            keepalive: false,
            phase: "committing",
          }),
        })
      )
    ).model;

    return {
      message: deliver(
        EditingNotice.cases.Delete.make({
          notice: DeleteNotice.cases.Settled.make({
            intent,
            outcome: success
              ? DeleteOutcome.cases.Committed.make({ id: intent.id })
              : DeleteOutcome.cases.Failed.make({ failure, id: intent.id }),
          }),
        })
      ),
      pending,
    };
  }

  if (kind === "rsvp") {
    const intent = RsvpIntent.make({
      event,
      id: base.editing.handledResponse + 1,
      request: {
        accountId: event.accountId,
        calendarId: event.calendarId,
        eventId: event.eventId,
        response: "accepted",
      },
    });

    const view = RsvpView.make({
      focused: Option.some(event),
      note: "",
      result: Option.none(),
      saving: Option.some(intent),
    });

    const pending = update(
      base,
      deliver(EditingNotice.cases.Rsvp.make({ view }))
    ).model;

    const result = success
      ? RsvpResult.cases.Saved.make({ event, intent })
      : RsvpResult.cases.Failed.make({ failure, intent });

    return {
      message: deliver(
        EditingNotice.cases.Rsvp.make({
          view: { ...view, result: Option.some(result), saving: Option.none() },
        })
      ),
      pending,
    };
  }

  const baseline = yield* createDraft({
    allDay: false,
    endDate: "2026-10-21",
    endTime: "10:00",
    ref: event,
    startDate: "2026-10-21",
    startTime: "09:00",
    timeZone: "UTC",
  });

  const draft = {
    ...baseline,
    location:
      kind === "conferencing" ? "https://meet.google.com/abc-defg-hij" : "",
    title: "Saved upcoming write",
  };

  const session = LoadedEditor.make({
    baseline,
    calendars: base.calendar.calendars,
    createId: Option.some("abcd1234"),
    draft,
    id: `upcoming-${kind}`,
    kind: kind === "create" ? "create" : "edit",
    master: Option.none(),
    moveSupport: "notAvailable",
    navigation: base.calendar.navigation,
    operation: "save",
    original: kind === "create" ? Option.none() : Option.some(event),
    selection: primarySelection(base.calendar.selected),
  });

  const plan = yield* prepareEditor(session);

  const view = EditorView.cases.Saving.make({
    draft,
    error: Option.none(),
    kind: session.kind,
    moveSupport: session.moveSupport,
    operation: "save",
    original: session.original,
    permissions: {
      calendarWritable: true,
      editGuests: true,
      editMeeting: true,
      inviteGuests: true,
    },
  });

  const pending = update(
    base,
    deliver(
      EditingNotice.cases.Editor.make({
        error: Option.none(),
        mutation: Option.none(),
        plan: Option.some(plan),
        saving: true,
        view,
      })
    )
  ).model;

  const mutation = EditorMutation.cases.Saved.make({
    event: { ...event, title: draft.title },
    id: session.id,
    plan,
  });

  return {
    message: deliver(
      EditingNotice.cases.Editor.make({
        error: success ? Option.none() : Option.some("Write refused"),
        mutation: success ? Option.some(mutation) : Option.none(),
        plan: Option.some(plan),
        saving: false,
        view: EditorView.cases.Closed.make({}),
      })
    ),
    pending,
  };
});

const writeKinds: readonly WriteKind[] = [
  "create",
  "edit",
  "delete",
  "conferencing",
  "rsvp",
];

for (const kind of writeKinds) {
  it.effect.prop(
    `${kind} completion refreshes selected upcoming calendars once, without trusting failed or stale-person writes`,
    {
      currentPerson: Arbitrary.schema(Schema.Boolean),
      selected: Arbitrary.schema(Schema.Boolean),
      success: Arbitrary.schema(Schema.Boolean),
    },
    ({ selected, success, currentPerson }) =>
      Effect.gen(function* completedWrite() {
        const { pending, message } = yield* writeFixture(
          kind,
          selected,
          success
        );

        const delivered = currentPerson
          ? message
          : Message.ReceivedEditing({
              notice: message.notice,
              personId: "previous-person",
            });

        const next = update(pending, delivered).model;
        const reads = selected && success && currentPerson ? 1 : 0;
        expect(next.upcoming.request).toBe(pending.upcoming.request + reads);
        expect(update(next, delivered).model.upcoming.request).toBe(
          next.upcoming.request
        );

        if (reads === 1) {
          expect(Option.getOrThrow(next.upcoming.query).request).toBe(
            next.upcoming.request
          );

          const stale = update(
            next,
            Message.ReceivedUpcoming({
              personId: upcomingPerson,
              request: pending.upcoming.request,
              result: upcomingResult,
            })
          ).model;

          expect(stale.upcoming).toBe(next.upcoming);
        }
      })
  );
}

it.effect.prop(
  "save acknowledgements interleaved with unavailable or refreshing inventory coalesce into one upcoming read",
  {
    first: Arbitrary.schema(Schema.Literals(["loading", "refreshing"])),
    history: Arbitrary.schema(
      Schema.Array(Schema.Literals(["loading", "refreshing"]))
    ),
  },
  ({ first, history }) =>
    Effect.gen(function* deferredWriteHistory() {
      const { pending, message } = yield* writeFixture("create", true, true);

      const inventory = Option.getOrThrow(
        AsyncData.getData(pending.calendar.index)
      );

      let { model } = update(
        pending,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: pending.upcoming.request,
          result: upcomingResult,
        })
      );

      let { request } = Option.getOrThrow(model.upcoming.query);
      let reads = 0;

      for (const availability of [first, ...history]) {
        const available = {
          ...model,
          calendar: {
            ...model.calendar,
            index:
              availability === "loading"
                ? RemoteCalendars.Loading()
                : RemoteCalendars.Refreshing({ data: inventory }),
          },
        };

        ({ model } = update(available, message));

        const { request: next } = Option.getOrThrow(model.upcoming.query);

        if (next !== request) {
          reads += 1;
          request = next;
        }

        expect(reads).toBeLessThanOrEqual(1);
      }

      for (let arrival = 0; arrival < 2; arrival += 1) {
        ({ model } = update(
          model,
          Message.ReceivedCalendars({
            personId: upcomingPerson,
            result: upcomingCalendars,
          })
        ));

        const { request: next } = Option.getOrThrow(model.upcoming.query);

        if (next !== request) {
          reads += 1;
          request = next;
        }
      }

      expect(reads).toBe(1);
    })
);

it.effect.prop(
  "preference echoes retain the existing calendar inventory throughout revalidation",
  {
    echoes: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 10, minimum: 1 }))
    ),
  },
  ({ echoes }) =>
    Effect.sync(() => {
      let model = upcomingFixture();
      const inventory = AsyncData.getData(model.calendar.index);

      for (let echo = 0; echo < echoes; echo += 1) {
        ({ model } = update(
          model,
          Message.ReceivedPreferences({
            person: upcomingPerson,
            preferences: normalizePreferences({ version: 2, visibility: {} }),
          })
        ));

        expect(AsyncData.isRefreshing(model.calendar.index)).toBe(true);
        expect(AsyncData.getData(model.calendar.index)).toEqual(inventory);
      }
    })
);
