import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import { ClipboardDelivery } from "../src/client/clipboard/delivery.js";
import { clipboardNativeHost } from "../src/client/clipboard/host.js";
import { ClipboardReceipt } from "../src/client/clipboard/machine.js";
import { ClipboardView } from "../src/client/clipboard/model.js";
import { observeNativeClipboard } from "../src/client/clipboard/native.js";
import {
  ClipboardAction,
  ClipboardNotice,
  ClipboardRuntime,
} from "../src/client/clipboard/runtime.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import type { EditingCommand } from "../src/client/editing/runtime.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { MonthRuntime } from "../src/client/month/runtime.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { unusedSearchLayer } from "./browser-runtime-fixture.js";
import {
  clipboardClient,
  clipboardPoint,
} from "./clipboard-runtime-fixture.js";
import { fixtureSelection } from "./fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

const eventFixture = (text = "") => {
  let prevented = false;
  const data = new Map([["text/plain", text]]);

  return {
    data,
    event: {
      clipboardData: {
        clearData: () => {
          data.clear();
        },
        getData: (kind: string) => data.get(kind) ?? "",
        setData: (kind: string, value: string) => {
          data.set(kind, value);
        },
      },
      get defaultPrevented() {
        return prevented;
      },
      isTrusted: true,
      preventDefault: () => {
        prevented = true;
      },
      target: document.body,
    },
  };
};

it.effect.each(["copy", "cut"] as const)(
  "native producer arms the owned copy before root %s receipt handling, then Paste reconciles the normal creation without replacing the global editor",
  (operation) =>
    Effect.scoped(
      Effect.gen(function* rootClipboardRecipient() {
        const memory = clipboardClient(0);
        const opened: (typeof EditingCommand.Type)[] = [];

        const editing = EditingRuntime.of({
          connect: () => Effect.succeed(Stream.empty),
          dispatch: (_personId, command) =>
            Effect.sync(() => {
              opened.push(command);
            }),
        });

        yield* Effect.gen(function* integratedClipboard() {
          const runtime = yield* ClipboardRuntime;
          const connection = yield* runtime.connect("fixture-person");
          let model = fixtureSelection();
          const ready = yield* Deferred.make<boolean>();
          const copied = yield* Deferred.make<boolean>();
          const guests = yield* Deferred.make<boolean>();
          const created = yield* Deferred.make<boolean>();
          const commands: ReturnType<typeof update>["commands"][] = [];

          const notices = yield* connection.notices.pipe(
            Stream.runForEach((notice) =>
              Effect.gen(function* receiveClipboard() {
                const result = update(
                  model,
                  Message.ReceivedClipboard({
                    delivery: ClipboardDelivery.make({
                      epoch: 0,
                      notice,
                      personId: connection.personId,
                      sessionId: connection.sessionId,
                    }),
                  })
                );

                ({ model } = result);

                if (ClipboardNotice.guards.State(notice)) {
                  if (Option.isSome(notice.view.copied)) {
                    yield* Deferred.succeed(copied, true);
                  }

                  if (ClipboardView.guards.Guests(notice.view)) {
                    yield* Deferred.succeed(guests, true);
                  }

                  yield* Deferred.succeed(ready, true);
                } else {
                  commands.push(result.commands);

                  if (ClipboardReceipt.guards.Cut(notice.receipt)) {
                    expect(connection.copied()).toBeDefined();

                    for (const command of result.commands ?? []) {
                      yield* command.effect;
                    }

                    const replay = update(
                      model,
                      Message.ReceivedClipboard({
                        delivery: ClipboardDelivery.make({
                          epoch: 0,
                          notice,
                          personId: connection.personId,
                          sessionId: connection.sessionId,
                        }),
                      })
                    );

                    expect(replay.commands).toBeUndefined();
                  } else {
                    yield* Deferred.succeed(created, true);
                  }
                }
              })
            ),
            Effect.forkScoped
          );

          yield* Deferred.await(ready);
          const source = eventFixture();

          const host = clipboardNativeHost(
            model,
            connection,
            clipboardPoint,
            document
          );

          expect(host).toBeDefined();

          const native = Option.getOrThrow(
            observeNativeClipboard(
              host,
              source.event,
              operation,
              1,
              document,
              false
            )
          );

          expect(source.event.defaultPrevented).toBe(true);
          expect(opened).toHaveLength(0);
          yield* connection.native(native);
          yield* Deferred.await(copied);
          const pasted = eventFixture(source.data.get("text/plain"));

          const pasteHost = clipboardNativeHost(
            model,
            connection,
            clipboardPoint,
            document
          );

          yield* connection.native(
            Option.getOrThrow(
              observeNativeClipboard(
                pasteHost,
                pasted.event,
                "paste",
                2,
                document,
                false
              )
            )
          );
          yield* Deferred.await(guests);

          const guestView = yield* Effect.succeed(model.clipboard.view).pipe(
            Effect.filterOrElse(ClipboardView.guards.Guests, () =>
              Effect.die("Guest view missing")
            )
          );

          const action = update(
            model,
            Message.ClipboardAction({
              action: ClipboardAction.cases.Guests.make({
                choice: "exclude",
                intentId: guestView.intentId,
              }),
              personId: connection.personId,
              sessionId: connection.sessionId,
            })
          );

          for (const command of action.commands ?? []) {
            yield* command.effect;
          }

          yield* Deferred.await(created);
          expect(memory.calls).toHaveLength(1);
          expect(model.editing.view).toEqual(fixtureSelection().editing.view);
          expect(Option.isSome(model.editing.write)).toBe(true);
          expect(
            commands.flat().some((command) => command?.name === "ReadEvents")
          ).toBe(true);
          expect(opened).toHaveLength(operation === "cut" ? 1 : 0);

          if (operation === "cut") {
            expect(opened[0]).toMatchObject({
              request: {
                event: {
                  accountId: "work",
                  calendarId: "primary",
                  eventId: "a-review",
                },
                mode: "delete",
              },
            });
          }

          yield* Fiber.interrupt(notices);
        }).pipe(
          Effect.provide(
            Layer.merge(ClipboardRuntime.layer, MonthRuntime.layer)
          ),
          Effect.provideService(CalendarEditingClient, memory.client),
          Effect.provideService(
            DeletionWriter,
            DeletionWriter.of({
              commit: () => Effect.die("Clipboard must not directly delete"),
            })
          ),
          Effect.provideService(EditingRuntime, editing),
          Effect.provide(unusedSearchLayer),
          Effect.provideService(CalendarSearchClient, unexpectedSearchClient)
        );
      })
    ).pipe(Effect.provide(NodeServices.layer))
);
