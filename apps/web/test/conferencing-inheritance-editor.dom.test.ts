import type { ConferencingDefault } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { editorConferencingContext } from "../src/client/conferencing/editor-context.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { modelGestureHostKey } from "../src/client/editing/gesture-targets.js";
import {
  EditingCommand,
  EditingNotice,
} from "../src/client/editing/runtime.js";
import type { UserDefaultConferencing } from "../src/client/settings/conferencing/default.js";
import { ConferencingSettingsChange } from "../src/client/settings/conferencing/model.js";
import { CalendarRoute } from "../src/layout/route.js";
import {
  inheritanceModel,
  inheritanceSession,
  persistInheritanceChoice,
} from "./conferencing-inheritance-fixture.js";
import { writeBody } from "./editing-rpc-fixture.js";

const combinations: readonly {
  readonly account: typeof ConferencingDefault.Type;
  readonly expectedMeet: boolean;
  readonly name: string;
  readonly save: boolean;
  readonly user: typeof UserDefaultConferencing.Type;
}[] = [
  {
    account: "unset",
    expectedMeet: false,
    name: "None inherits None",
    save: false,
    user: null,
  },
  {
    account: "none",
    expectedMeet: false,
    name: "explicit account None against user None",
    save: false,
    user: null,
  },
  {
    account: "googleMeet",
    expectedMeet: true,
    name: "explicit account Meet overrides user None",
    save: false,
    user: null,
  },
  {
    account: "unset",
    expectedMeet: true,
    name: "user Meet is inherited",
    save: true,
    user: "googleMeet",
  },
  {
    account: "none",
    expectedMeet: false,
    name: "explicit account None suppresses user Meet",
    save: true,
    user: "googleMeet",
  },
  {
    account: "googleMeet",
    expectedMeet: true,
    name: "explicit account Meet against user Meet",
    save: false,
    user: "googleMeet",
  },
];

it.effect.each(combinations)(
  "real root and editor actor: $name",
  ({ account, expectedMeet, save, user }) =>
    Effect.gen(function* inheritedEditor() {
      const model = yield* inheritanceModel(user, account);

      const session = yield* inheritanceSession(model);

      expect(session.editing().draft.conferencing?.request).toBeUndefined();
      yield* session.add("guest@example.test");
      expect(session.editing().draft.conferencing?.request).toEqual(
        expectedMeet ? { kind: "googleMeet" } : undefined
      );
      expect(yield* session.requests()).toEqual([]);

      if (save) {
        const saved = yield* session.save();

        expect(saved.requests.map((request) => request.method)).toEqual(
          expectedMeet ? ["GET", "POST", "GET"] : ["POST"]
        );

        const inserted = saved.requests.find(
          (request) => request.method === "POST"
        );

        const body = writeBody(inserted?.body);

        expect(body.attendees).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ email: "guest@example.test" }),
          ])
        );

        if (expectedMeet) {
          expect(body.conferenceData).toMatchObject({
            createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } },
          });
          expect(inserted?.path).toContain("conferenceDataVersion=1");
        } else {
          expect(body.conferenceData).toBeUndefined();
        }
      }
    })
);

it.effect(
  "inherited Meet retains the calendar capability gate and never writes while proposing",
  () =>
    Effect.gen(function* unavailableInheritedMeet() {
      const model = yield* inheritanceModel("googleMeet", "unset", false);

      const session = yield* inheritanceSession(model);
      yield* session.add("guest@example.test");
      expect(session.editing().draft.conferencing?.request).toBeUndefined();
      expect(yield* session.requests()).toEqual([]);
    })
);

it.effect(
  "an explicit removal remains None when the first human is later invited",
  () =>
    Effect.gen(function* explicitNone() {
      const session = yield* inheritanceSession(
        yield* inheritanceModel("googleMeet")
      );

      yield* session.dispatch(EditorAction.cases.AddMeet.make({}));
      yield* session.take(
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.conferencing?.request?.kind === "googleMeet"
      );
      yield* session.dispatch(EditorAction.cases.RemoveConferencing.make({}));
      yield* session.take(
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.conferencing?.request?.kind === "none"
      );
      yield* session.add("guest@example.test");
      expect(session.editing().draft.conferencing?.request).toEqual({
        kind: "none",
      });
      expect(yield* session.requests()).toEqual([]);
    })
);

it.effect(
  "keyboard creation, duplicate, edit and the actual root gesture recipient carry the committed user snapshot",
  () =>
    Effect.gen(function* inheritedOpeningRecipients() {
      const loaded = yield* inheritanceModel("googleMeet");
      const model = { ...loaded, route: CalendarRoute.make({}) };

      const actions = [
        EditorAction.cases.OpenCreate.make({}),
        EditorAction.cases.DuplicateSelected.make({}),
        EditorAction.cases.OpenEdit.make({}),
      ];

      const results = actions.map((action) =>
        update(model, Message.EditingAction({ action }))
      );

      results.push(
        update(
          model,
          Message.CompletedGesture({
            gesture: {
              allDayRow: false,
              duplicate: false,
              id: 1,
              range: {
                allDay: false,
                endDate: "2026-10-21",
                endTime: "11:00",
                startDate: "2026-10-21",
                startTime: "10:00",
              },
              target: Option.none(),
            },
            hostKey: Option.getOrThrow(modelGestureHostKey(model)),
            personId: Option.getOrThrow(model.person),
          })
        )
      );

      for (const result of results) {
        const descriptor = result.commands?.find(
          (command) => command.name === "DispatchEditing"
        );

        expect(descriptor).toBeDefined();

        const command = yield* Schema.decodeUnknownEffect(EditingCommand)(
          descriptor?.args?.command
        );

        expect(EditingCommand.guards.Open(command)).toBe(true);

        if (EditingCommand.guards.Open(command)) {
          expect(command.request.conferencingContext).toMatchObject({
            defaultConferencing: "googleMeet",
          });
          expect(command.request.conferencingContext?.accounts).toContainEqual({
            accountId: "work",
            email: "owner@example.test",
            setting: "unset",
          });
        }
      }
    })
);

it.effect(
  "saving a user preference changes future context but does not rewrite an already-open draft",
  () =>
    Effect.gen(function* openDraftSnapshot() {
      const session = yield* inheritanceSession(yield* inheritanceModel(null));
      const personId = Option.getOrThrow(session.get().person);

      const pending = session.receive(
        Message.ChangedConferencingSettings({
          change: ConferencingSettingsChange.cases.Default.make({
            value: "googleMeet",
          }),
          personId,
        })
      );

      expect(session.editing().draft.conferencing?.request).toBeUndefined();
      session.receive(yield* persistInheritanceChoice(pending));
      expect(session.get().conferencingSettings.defaultConferencing).toBe(
        "googleMeet"
      );
      expect(editorConferencingContext(session.get())).toMatchObject({
        defaultConferencing: "googleMeet",
      });
      yield* session.add("guest@example.test");
      expect(session.editing().draft.conferencing?.request).toBeUndefined();
      expect(yield* session.requests()).toEqual([]);
    })
);
