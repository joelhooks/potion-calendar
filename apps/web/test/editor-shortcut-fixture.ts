import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { expect } from "@effect/vitest";
import { Effect, Option, pipe } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import type { EditingCommand } from "../src/client/editing/runtime.js";
import {
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { selectedEvent } from "../src/client/keyboard/registry.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { view } from "../src/features/app.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { editorViewFields } from "./editor-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

export const shortcutScenes = [
  "with-conferencing",
  "without-conferencing",
  "readonly",
  "unsupported",
] as const;

export type ShortcutScene = (typeof shortcutScenes)[number];

const refusalTitle: Partial<Record<ShortcutScene, string>> = {
  readonly: "Read-only meeting",
  unsupported: "Out of office",
};

export const shortcutFixture = (
  scene: ShortcutScene,
  editable = true
): AppModel => {
  const base = keyboardFixture();
  const selected = selectedEvent(base);
  expect(selected).toBeDefined();
  const original = selected?.source;

  const reads = base.calendar.reads.map((read) => ({
    ...read,
    events: pipe(
      read.events,
      AsyncData.map((data) => ({
        ...data,
        events: data.events.map((event): CalendarEventValue =>
          event.eventId === original?.eventId &&
          event.accountId === original.accountId &&
          event.calendarId === original.calendarId
            ? {
                ...event,
                conferenceUrl:
                  scene === "with-conferencing"
                    ? "https://meet.google.com/abc-defg-hij"
                    : undefined,
                eventType: scene === "unsupported" ? "outOfOffice" : "default",
                guestsCanModify: editable,
                organizer: { email: "organizer@example.test", self: editable },
                title: refusalTitle[scene] ?? event.title,
              }
            : event
        ),
      }))
    ),
  }));

  return {
    ...base,
    calendar: {
      ...base.calendar,
      calendars: base.calendar.calendars.map((calendar) => ({
        ...calendar,
        accessRole: scene === "readonly" ? "reader" : calendar.accessRole,
        allowedConferenceSolutionTypes: ["hangoutsMeet"],
      })),
      reads,
    },
  };
};

export const pressEditorShortcut = (base: AppModel, key: string) => {
  const prefix = update(
    base,
    Message.PressedCalendarKey({
      alt: false,
      key: "e",
      mod: false,
      now: 100,
      shift: false,
    })
  );

  return update(
    prefix.model,
    Message.PressedCalendarKey({
      alt: false,
      key,
      mod: false,
      now: 200,
      shift: false,
    })
  );
};

export const receiveShortcutEditor = (model: AppModel): AppModel => {
  const source = selectedEvent(model)?.source;

  return update(
    model,
    Message.ReceivedEditing({
      notice: EditingNotice.cases.Editor.make({
        error: Option.none(),
        mutation: Option.none(),
        plan: Option.none(),
        saving: false,
        view: EditorView.cases.Editing.make({
          ...editorViewFields,
          draft: {
            ...editorViewFields.draft,
            eventType: source?.eventType,
            title: source?.title ?? "Meeting",
          },
          original: Option.fromNullishOr(source),
        }),
      }),
      personId: Option.getOrThrow(model.person),
    })
  ).model;
};

export const captureShortcutCommands = Effect.fn(
  "test.captureShortcutCommands"
)(function* capture(result: ReturnType<typeof update>) {
  const commands: (typeof EditingCommand.Type)[] = [];

  for (const command of result.commands ?? []) {
    yield* command.effect.pipe(
      Effect.provide(unusedBrowserLayers),
      Effect.provideService(CalendarSearchClient, unexpectedSearchClient),
      Effect.provideService(
        EditingRuntime,
        EditingRuntime.of({
          connect: () => Effect.die("Unexpected editor connection"),
          dispatch: (_person, dispatched) =>
            Effect.sync(() => {
              commands.push(dispatched);
            }),
        })
      )
    );
  }

  return commands;
});

export const renderShortcutRoot = (model: AppModel) =>
  renderToString({ init: () => ({ model }), view }, { isHydratable: false });
