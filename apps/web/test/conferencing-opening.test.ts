import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema, Stream } from "effect";

import { RemoteConferencingDefault } from "../src/client/conferencing/model.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import {
  EditingCommand,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { editAction, completeGesture } from "../src/client/editing/update.js";
import { fixtureSelection } from "./fixture.js";

it.effect.prop(
  "keyboard create, duplicate, edit and blank-grid gesture forward the authenticated account preference snapshot",
  { value: Schema.Literals(["googleMeet", "none", "unset"]) },
  ({ value }) =>
    Effect.gen(function* openingConferencingContext() {
      const fixture = fixtureSelection();

      const model = {
        ...fixture,
        conferencing: {
          accounts: {
            work: {
              operation: "read" as const,
              remote: RemoteConferencingDefault.Success({
                data: { accountId: "work", value },
              }),
              requestId: 1,
            },
          },
          nextRequestId: 1,
        },
      };

      const captured = yield* Ref.make<readonly (typeof EditingCommand.Type)[]>(
        []
      );

      const runtime = EditingRuntime.of({
        connect: () => Effect.succeed(Stream.empty),
        dispatch: (_personId, command) =>
          Ref.update(captured, (commands) => [...commands, command]),
      });

      for (const action of [
        EditorAction.cases.OpenCreate.make({}),
        EditorAction.cases.DuplicateSelected.make({}),
        EditorAction.cases.OpenEdit.make({}),
      ]) {
        for (const command of editAction(model, action).commands ?? []) {
          yield* command.effect.pipe(
            Effect.provideService(EditingRuntime, runtime)
          );
        }
      }

      const gesture = completeGesture(model, {
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
      });

      for (const command of gesture.commands ?? []) {
        yield* command.effect.pipe(
          Effect.provideService(EditingRuntime, runtime)
        );
      }

      const commands = yield* Ref.get(captured);
      expect(commands).toHaveLength(4);

      for (const command of commands) {
        expect(EditingCommand.guards.Open(command)).toBe(true);

        if (EditingCommand.guards.Open(command)) {
          expect(
            command.request.conferencingContext?.accounts.find(
              (account) => account.accountId === "work"
            )
          ).toEqual({
            accountId: "work",
            email: "owner@example.test",
            setting: value,
          });
        }
      }
    })
);
