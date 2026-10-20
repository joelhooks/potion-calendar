import { CalendarEvent } from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import {
  DeleteIntent,
  DeleteOutcome,
} from "../src/client/editing/delete-actor.js";
import { DeleteNotice } from "../src/client/editing/deletion-session.js";
import { EditingNotice } from "../src/client/editing/runtime.js";
import { fixtureEvents, fixtureSelection } from "./fixture.js";

export const undoFixture = () => {
  const selected = fixtureSelection();
  const source = Schema.decodeUnknownSync(CalendarEvent)(fixtureEvents[0]);

  const event = CalendarEvent.make({
    ...source,
    originalStartTime: source.start,
    recurringEventId: "fixture-review-series",
  });

  const base = update(
    selected,
    Message.ReceivedEvents({
      accountId: source.accountId,
      request: selected.calendar.rangeRequest,
      result: {
        events: fixtureEvents
          .filter((candidate) => candidate.accountId === source.accountId)
          .map((candidate) =>
            candidate.eventId === source.eventId ? event : candidate
          ),
        versions: [],
      },
    })
  ).model;

  const intent = DeleteIntent.make({
    event,
    id: "fixture-undo",
    navigation: base.calendar.navigation,
    request: {
      accountId: event.accountId,
      calendarId: event.calendarId,
      eventId: event.eventId,
      scope: "single",
      sendUpdates: "none",
    },
    selection: base.calendar.selected,
    title: event.title ?? "Event",
  });

  const personId = Option.getOrThrow(base.person);

  const pending = update(
    base,
    Message.ReceivedEditing({
      notice: EditingNotice.cases.Delete.make({
        notice: DeleteNotice.cases.Changed.make({
          intent,
          keepalive: false,
          phase: "pending",
        }),
      }),
      personId,
    })
  ).model;

  const restored = update(
    pending,
    Message.ReceivedEditing({
      notice: EditingNotice.cases.Delete.make({
        notice: DeleteNotice.cases.Settled.make({
          intent,
          outcome: DeleteOutcome.cases.Undone.make({ id: intent.id }),
        }),
      }),
      personId,
    })
  ).model;

  return { base, intent, pending, restored };
};
