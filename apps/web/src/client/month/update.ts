import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { DateTime, Option } from "effect";
import { AsyncData } from "foldkit";

import { dayFromIso, dayInZone } from "../../layout/navigation.js";
import { visibleEvents } from "../../layout/presentation.js";
import type { AppModel, reloadRange } from "../app.js";
import { eventKey } from "../calendar-state.js";
import { AcknowledgeMonthRead } from "./commands.js";
import { monthHostKey } from "./host.js";
import { MonthNotice, MonthReadBinding } from "./model.js";

export const settleMonthRead = (
  model: AppModel
): ReturnType<typeof reloadRange> => {
  const pending = Option.getOrUndefined(model.month.pending);

  if (
    pending === undefined ||
    !Option.contains(monthHostKey(model), pending.session.hostKey) ||
    model.calendar.reads.some((read) => AsyncData.isPending(read.events))
  ) {
    return { model };
  }

  return {
    commands: [
      AcknowledgeMonthRead({
        id: pending.request.id,
        session: pending.session,
        success: model.calendar.reads.every((read) =>
          AsyncData.isSuccess(read.events)
        ),
      }),
    ],
    model: { ...model, month: { ...model.month, pending: Option.none() } },
  };
};

export const receiveMonthNotice = (
  model: AppModel,
  notice: typeof MonthNotice.Type,
  load: typeof reloadRange
): ReturnType<typeof reloadRange> => {
  if (!Option.contains(monthHostKey(model), notice.session.hostKey)) {
    return { model };
  }

  const current = Option.getOrUndefined(model.month.frame);

  if (current !== undefined && current.session.id > notice.session.id) {
    return { model };
  }

  return MonthNotice.match(notice, {
    Frame: ({ frame, session }) => ({
      model: {
        ...model,
        month: { ...model.month, frame: Option.some({ frame, session }) },
      },
    }),
    Read: ({ request, session }) => {
      if (current?.session.id !== session.id) {
        return { model };
      }

      const pending = Option.some(MonthReadBinding.make({ request, session }));
      const next = { ...model, month: { ...model.month, pending } };
      const range = Option.getOrUndefined(model.month.range);

      const reuse =
        range?.start === request.range.start &&
        range.end === request.range.end &&
        Option.contains(model.month.rangeHost, session.hostKey) &&
        model.calendar.reads.every(
          (read) =>
            AsyncData.isPending(read.events) || AsyncData.isSuccess(read.events)
        );

      if (reuse) {
        return settleMonthRead(next);
      }

      const loaded = load(next, false);
      const settled = settleMonthRead(loaded.model);

      return {
        commands: [...(loaded.commands ?? []), ...(settled.commands ?? [])],
        model: settled.model,
      };
    },
    Settled: ({ anchor, position, session }) =>
      current?.session.id === session.id
        ? {
            model: {
              ...model,
              month: {
                ...model.month,
                settled: Option.some({ anchor, position, session }),
              },
            },
          }
        : { model },
  });
};

const sourceDay = (
  time: NonNullable<CalendarEventValue["start"]>,
  end: boolean,
  zone: string
) =>
  "date" in time
    ? Option.some(dayFromIso(time.date) - Number(end))
    : DateTime.make(time.dateTime).pipe(
        Option.map((value) =>
          dayInZone(DateTime.toEpochMillis(value) - Number(end), zone)
        )
      );

export const retainedMonthSources = (
  model: AppModel,
  previous: readonly CalendarEventValue[],
  incoming: readonly CalendarEventValue[]
): readonly CalendarEventValue[] => {
  const range = Option.getOrUndefined(model.month.range);

  if (model.calendar.navigation.mode !== "month" || range === undefined) {
    return incoming;
  }

  const selected = Option.getOrUndefined(model.calendar.selected);

  const selectionKeys = new Set(
    visibleEvents(model)
      .filter((item) => item.key === selected)
      .flatMap((item) => item.copies.map((copy) => eventKey(copy.source)))
  );

  const drag = Option.getOrUndefined(model.editing.gesture)?.target;

  const dragSource =
    drag === undefined ? undefined : Option.getOrUndefined(drag)?.event;

  const dragKey = dragSource === undefined ? undefined : eventKey(dragSource);

  const known = new Set(incoming.map(eventKey));

  return [
    ...incoming,
    ...previous.filter((event) => {
      const key = eventKey(event);

      if (
        (!selectionKeys.has(key) && key !== dragKey) ||
        known.has(key) ||
        event.start === undefined ||
        event.end === undefined
      ) {
        return false;
      }

      const start = Option.getOrUndefined(
        sourceDay(event.start, false, model.calendar.zone)
      );

      const end = Option.getOrUndefined(
        sourceDay(event.end, true, model.calendar.zone)
      );

      return (
        start !== undefined &&
        end !== undefined &&
        (end < range.start || start >= range.end)
      );
    }),
  ];
};
