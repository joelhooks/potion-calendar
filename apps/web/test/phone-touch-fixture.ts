import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { Option, pipe } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { gestureTarget } from "../src/client/editing/gesture-input.js";
import { GesturePoint } from "../src/client/editing/gesture-model.js";
import { modelGestureHostKey } from "../src/client/editing/gesture-targets.js";
import { gestureRange } from "../src/layout/gesture-range.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";

export interface PhoneTouchScene {
  readonly height: number;
  readonly kind: "move" | "create";
  readonly state: "pressed" | "preview" | "read-only";
  readonly theme: "light" | "dark";
  readonly width: number;
}

export const phoneTouchScenes = [
  { height: 844, kind: "move", state: "pressed", theme: "light", width: 390 },
  { height: 932, kind: "create", state: "pressed", theme: "dark", width: 430 },
  { height: 932, kind: "move", state: "preview", theme: "light", width: 430 },
  { height: 844, kind: "create", state: "preview", theme: "dark", width: 390 },
  { height: 844, kind: "move", state: "read-only", theme: "dark", width: 390 },
  {
    height: 932,
    kind: "create",
    state: "read-only",
    theme: "light",
    width: 430,
  },
] satisfies readonly [PhoneTouchScene, ...PhoneTouchScene[]];

const point = (minute: number) =>
  GesturePoint.make({
    alt: false,
    at: 450,
    day: dayFromIso("2026-10-19"),
    minute,
    pointerId: 1,
    shift: false,
    x: 180,
    y: minute,
  });

const withOrganizerAuthority = (
  event: CalendarEventValue
): CalendarEventValue => {
  const common = {
    ...event,
    organizer: { email: "owner@example.test", self: true },
  };

  if (event.attendees === undefined) {
    return common;
  }

  return {
    ...common,
    attendees: event.attendees.map((attendee) => ({
      ...attendee,
      organizer: attendee.self === true,
    })),
  };
};

export const phoneTouchFixture = (scene: PhoneTouchScene): AppModel => {
  const base = phoneShellFixture(
    scene.width,
    scene.height,
    "closed",
    scene.theme
  );

  const initial: AppModel = {
    ...base,
    calendar: {
      ...base.calendar,
      calendars: base.calendar.calendars.map((calendar) => ({
        ...calendar,
        accessRole:
          scene.state === "read-only" ? "reader" : calendar.accessRole,
      })),
      reads: base.calendar.reads.map((read) => ({
        ...read,
        events: pipe(
          read.events,
          AsyncData.map((data) => ({
            ...data,
            events: data.events.map(withOrganizerAuthority),
          }))
        ),
      })),
    },
  };

  let { model } = update(
    initial,
    Message.MeasuredShellViewport({ width: scene.width })
  );

  const item = Option.getOrThrow(
    Option.fromNullishOr(
      visibleEvents(model).find((event) => event.source.eventId === "a-review")
    )
  );

  model = {
    ...model,
    calendar: {
      ...model.calendar,
      selected: scene.kind === "move" ? [item.key] : [],
    },
  };

  const gesture = gestureRange(
    {
      allDay: false,
      edge: "body",
      point: point(540),
      target:
        scene.kind === "move"
          ? gestureTarget(item, model.calendar.zone)
          : Option.none(),
    },
    point(600),
    1
  );

  const hostKey = Option.getOrThrow(modelGestureHostKey(model));
  const personId = Option.getOrThrow(model.person);

  if (scene.state === "preview") {
    return update(
      model,
      Message.PreviewedGesture({
        hostKey,
        personId,
        phase: "dragging",
        preview: Option.some(gesture),
      })
    ).model;
  }

  if (scene.state === "read-only") {
    return scene.kind === "move"
      ? update(
          model,
          Message.RefusedGesture({ hostKey, personId, reason: "ReadOnlyEvent" })
        ).model
      : update(model, Message.CompletedGesture({ gesture, hostKey, personId }))
          .model;
  }

  return model;
};
