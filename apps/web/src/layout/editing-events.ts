import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { DateTime, Option } from "effect";

import { DeleteIntent } from "../client/editing/delete-actor.js";
import { EditorView } from "../client/editing/editor-model.js";
import type { EventDraftValue } from "../client/editing/editor-model.js";
import type { WritePlan } from "../client/editing/editor-session-model.js";
import type { EditingUi } from "../client/editing/ui-model.js";
import {
  deletionAffectsEvent,
  projectPendingDeletes,
} from "./delete-projection.js";
import { editorDate, editorLocalTime } from "./editor-time.js";

const planAffects = (
  plan: typeof WritePlan.Type,
  event: CalendarEventValue
): boolean => {
  const source = Option.getOrUndefined(plan.session.original);

  if (source === undefined) {
    return false;
  }

  return deletionAffectsEvent(
    DeleteIntent.make({
      event: source,
      id: plan.session.id,
      navigation: plan.session.navigation,
      request: {
        accountId: source.accountId,
        calendarId: source.calendarId,
        eventId: source.eventId,
        scope: plan.scope,
      },
      selection: plan.session.selection,
      title: source.title ?? "Event",
    }),
    event
  );
};

const applyPlan = (
  event: CalendarEventValue,
  plan: typeof WritePlan.Type
): CalendarEventValue => {
  if (!planAffects(plan, event)) {
    return event;
  }

  const selected = Option.getOrUndefined(plan.session.original);

  const changed: CalendarEventValue = {
    ...event,
    ...plan.changes,
    accountId: plan.session.draft.accountId,
    calendarId: plan.session.draft.calendarId,
  };

  return selected?.eventId === event.eventId
    ? changed
    : { ...changed, end: event.end, start: event.start };
};

const draftPreview = (
  draft: EventDraftValue
): Option.Option<CalendarEventValue> => {
  const common = {
    accountId: draft.accountId,
    attendees: draft.attendees,
    calendarId: draft.calendarId,
    colorId: draft.colorId,
    description: draft.description,
    eventId: "calendar-local-draft",
    location: draft.location,
    status: "confirmed",
    title: draft.title || "New event",
  } satisfies CalendarEventValue;

  if (draft.allDay) {
    const from = editorDate(draft.startDate);
    const last = editorDate(draft.endDate);

    if (
      Option.isNone(from) ||
      Option.isNone(last) ||
      DateTime.toEpochMillis(last.value) < DateTime.toEpochMillis(from.value)
    ) {
      return Option.none();
    }

    return Option.some({
      ...common,
      end: {
        date: DateTime.formatIsoDateUtc(DateTime.add(last.value, { days: 1 })),
      },
      start: { date: draft.startDate },
    });
  }

  const from = editorLocalTime(
    draft.startDate,
    draft.startTime,
    draft.timeZone
  );

  const to = editorLocalTime(draft.endDate, draft.endTime, draft.timeZone);

  if (
    Option.isNone(from) ||
    Option.isNone(to) ||
    DateTime.toEpochMillis(to.value) <= DateTime.toEpochMillis(from.value)
  ) {
    return Option.none();
  }

  return Option.some({
    ...common,
    end: { dateTime: DateTime.formatIso(to.value), timeZone: draft.timeZone },
    start: {
      dateTime: DateTime.formatIso(from.value),
      timeZone: draft.timeZone,
    },
  });
};

export const projectEditingEvents = (
  events: readonly CalendarEventValue[],
  editing: typeof EditingUi.Type
): readonly CalendarEventValue[] => {
  let projected = projectPendingDeletes(
    events,
    editing.deletes.map((item) => item.intent)
  );

  if (Option.isSome(editing.write)) {
    const { plan } = editing.write.value;

    if (plan.session.kind === "edit") {
      const source = Option.getOrUndefined(plan.session.original);

      const present =
        source !== undefined &&
        projected.some(
          (event) =>
            event.accountId === source.accountId &&
            event.calendarId === source.calendarId &&
            event.eventId === source.eventId
        );

      projected = projected.map((event) => applyPlan(event, plan));

      if (source !== undefined && !present) {
        projected = [...projected, applyPlan(source, plan)];
      }
    }
  }

  if (Option.isSome(editing.response)) {
    const { intent } = editing.response.value;

    const matches = (event: CalendarEventValue) =>
      event.accountId === intent.event.accountId &&
      event.calendarId === intent.event.calendarId &&
      event.eventId === intent.event.eventId;

    const responding = (event: CalendarEventValue): CalendarEventValue => ({
      ...event,
      attendees: (event.attendees ?? []).map((person) =>
        person.self === true
          ? {
              ...person,
              comment: intent.request.note ?? person.comment,
              responseStatus: intent.request.response,
            }
          : person
      ),
    });

    const present = projected.some(matches);
    projected = projected.map((event) =>
      matches(event) ? responding(event) : event
    );

    if (!present) {
      projected = [...projected, responding(intent.event)];
    }
  }

  const { view } = editing;

  if (
    !EditorView.guards.Closed(view) &&
    !EditorView.guards.Loading(view) &&
    view.kind !== "edit"
  ) {
    const preview = draftPreview(view.draft);

    if (Option.isSome(preview)) {
      return [...projected, preview.value];
    }
  }

  if (
    Option.isSome(editing.write) &&
    editing.write.value.plan.session.kind !== "edit"
  ) {
    const preview = draftPreview(editing.write.value.plan.session.draft);

    if (Option.isSome(preview)) {
      return [...projected, preview.value];
    }
  }

  return projected;
};
