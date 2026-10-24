import { CalendarEvent } from "@calendar/calendar/contracts";
import {
  Crypto,
  DateTime,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
  Stream,
} from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { clipboardAnchorAt } from "../src/client/clipboard/anchor.js";
import { ClipboardDelivery } from "../src/client/clipboard/delivery.js";
import { clipboardNativeHost } from "../src/client/clipboard/host.js";
import { ClipboardReceipt } from "../src/client/clipboard/machine.js";
import {
  ClipboardAnchor,
  ClipboardView,
} from "../src/client/clipboard/model.js";
import { observeNativeClipboard } from "../src/client/clipboard/native.js";
import {
  ClipboardAction,
  ClipboardNotice,
  ClipboardRuntime,
} from "../src/client/clipboard/runtime.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { MonthRuntime } from "../src/client/month/runtime.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { view as appView } from "../src/features/app.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { displayZone } from "../src/layout/time-zones.js";
import { unusedSearchLayer } from "./browser-runtime-fixture.js";
import {
  groupClipboardFixture,
  groupNativeEvent,
} from "./clipboard-group-fixture.js";
import { clipboardClient } from "./clipboard-runtime-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

export const GroupArtifactState = Schema.Literals([
  "guests",
  "success-week",
  "success-month",
  "success-month-all-day",
  "partial",
  "mixed",
  "dst",
]);

export const monthArtifactAnchor = Effect.fn("test.monthArtifactAnchor")(
  function* monthArtifactAnchor(model: AppModel) {
    const rendered = yield* renderToString(
      { init: () => ({ model }), view: appView },
      { isHydratable: false }
    );

    const dom = new DOMParser().parseFromString(rendered.html, "text/html");

    const root = yield* Effect.fromNullishOr(
      dom.querySelector<HTMLElement>(".month-view")
    ).pipe(Effect.orDie);

    const cell = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>(
        `.month-cell[data-day="${dayFromIso("2026-10-21")}"]`
      )
    ).pipe(Effect.orDie);

    root.getBoundingClientRect = () => new DOMRect(100, 100, 500, 500);
    cell.getBoundingClientRect = () => new DOMRect(200, 100, 100, 100);

    return yield* Effect.fromOption(
      clipboardAnchorAt(
        {
          key: "artifact-month",
          mode: "month",
          root,
          scale: 1,
          zone: model.calendar.zone,
        },
        { alt: false, key: "artifact-month", shift: false, x: 250, y: 150 },
        cell
      )
    ).pipe(Effect.orDie);
  }
);

export const collectGroupArtifact = Effect.fn("test.collectGroupArtifact")(
  function* collectGroupArtifact(kind: typeof GroupArtifactState.Type) {
    const platformCrypto = yield* Crypto.Crypto;
    const uuid = yield* Ref.make(0);

    const artifactCrypto = Crypto.Crypto.of({
      ...platformCrypto,
      randomUUIDv4: Ref.updateAndGet(uuid, (value) => value + 1).pipe(
        Effect.map(
          (value) =>
            `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`
        )
      ),
    });

    const fixture = groupClipboardFixture(
      kind === "success-month" || kind === "success-month-all-day"
    );

    const events = fixture.events.map((event, index) => {
      if (kind === "success-month-all-day") {
        return CalendarEvent.make({
          ...event,
          end: { date: `2026-10-${20 + index}` },
          start: { date: `2026-10-${19 + index}` },
        });
      }

      if (kind === "mixed" && index === 2) {
        return CalendarEvent.make({
          ...event,
          end: { date: "2026-10-21" },
          start: { date: "2026-10-19" },
        });
      }

      if (kind === "dst") {
        const time = ["00:00", "02:30", "04:00"][index] ?? "00:00";
        const end = ["00:45", "03:15", "04:45"][index] ?? "00:45";

        return CalendarEvent.make({
          ...event,
          end: { dateTime: `2026-02-01T${end}:00-08:00` },
          start: { dateTime: `2026-02-01T${time}:00-08:00` },
        });
      }

      return event;
    });

    const initial: AppModel = {
      ...fixture.model,
      calendar: {
        ...fixture.model.calendar,
        navigation:
          kind === "dst"
            ? initialNavigation(dayFromIso("2026-02-01"))
            : fixture.model.calendar.navigation,
        reads: [
          {
            accountId: "work",
            events: RemoteEvents.Success({ data: { events, versions: [] } }),
          },
        ],
        zone: kind === "dst" ? "Asia/Tokyo" : fixture.model.calendar.zone,
      },
      timeZones:
        kind === "dst"
          ? {
              ...fixture.model.timeZones,
              temporary: Option.some(displayZone("Asia/Tokyo")),
            }
          : fixture.model.timeZones,
    };

    let model: AppModel = {
      ...initial,
      calendar: {
        ...initial.calendar,
        selected: visibleEvents(initial)
          .map((event) => event.key)
          .toReversed(),
      },
    };

    const memory = clipboardClient(kind === "partial" ? 1 : 0);

    let anchor: typeof ClipboardAnchor.Type = fixture.anchor;

    if (kind === "dst") {
      anchor = ClipboardAnchor.cases.Timed.make({
        date: "2026-03-08",
        instant: DateTime.toEpochMillis(
          DateTime.makeUnsafe("2026-03-08T00:00:00-08:00")
        ),
      });
    }

    if (kind === "success-month" || kind === "success-month-all-day") {
      anchor = yield* monthArtifactAnchor(model);
    }

    return yield* Effect.gen(function* generateGroupState() {
      const runtime = yield* ClipboardRuntime;
      const connection = yield* runtime.connect(fixture.personId);
      const ready = yield* Deferred.make<boolean>();
      const copied = yield* Deferred.make<boolean>();
      const guests = yield* Deferred.make<boolean>();
      const refused = yield* Deferred.make<boolean>();

      const done =
        yield* Deferred.make<typeof ClipboardReceipt.cases.CreatedGroup.Type>();

      const observer = yield* connection.notices.pipe(
        Stream.runForEach((notice) =>
          Effect.gen(function* rootArtifactNotice() {
            ({ model } = update(
              model,
              Message.ReceivedClipboard({
                delivery: ClipboardDelivery.make({
                  epoch: model.clipboard.epoch,
                  notice,
                  personId: fixture.personId,
                  sessionId: connection.sessionId,
                }),
              })
            ));

            if (ClipboardNotice.guards.State(notice)) {
              yield* Deferred.succeed(ready, true);

              if (Option.isSome(notice.view.copied)) {
                yield* Deferred.succeed(copied, true);
              }

              if (ClipboardView.guards.Guests(notice.view)) {
                yield* Deferred.succeed(guests, true);
              }

              if (Option.isSome(notice.view.toast) && kind === "mixed") {
                yield* Deferred.succeed(refused, true);
              }
            } else if (ClipboardReceipt.guards.CreatedGroup(notice.receipt)) {
              yield* Deferred.succeed(done, notice.receipt);
            }
          })
        ),
        Effect.forkScoped
      );

      yield* Deferred.await(ready);
      const copy = groupNativeEvent();
      yield* connection.native(
        Option.getOrThrow(
          observeNativeClipboard(
            clipboardNativeHost(model, connection, anchor, document),
            copy.event,
            "copy",
            1,
            document,
            false
          )
        )
      );

      if (kind === "mixed") {
        yield* Deferred.await(refused);
      } else {
        yield* Deferred.await(copied);

        if (kind === "dst") {
          model = {
            ...model,
            calendar: {
              ...model.calendar,
              navigation: initialNavigation(dayFromIso("2026-03-08")),
            },
          };
        }

        const paste = groupNativeEvent(copy.data.get("text/plain"));
        yield* connection.native(
          Option.getOrThrow(
            observeNativeClipboard(
              clipboardNativeHost(model, connection, anchor, document),
              paste.event,
              "paste",
              2,
              document,
              false
            )
          )
        );
        yield* Deferred.await(guests);

        if (kind !== "guests") {
          const view = yield* Effect.succeed(model.clipboard.view).pipe(
            Effect.filterOrElse(ClipboardView.guards.Guests, () =>
              Effect.die("Artifact group choice missing")
            )
          );

          const decision = update(
            model,
            Message.ClipboardAction({
              action: ClipboardAction.cases.Guests.make({
                choice: "exclude",
                intentId: view.intentId,
              }),
              personId: fixture.personId,
              sessionId: connection.sessionId,
            })
          );

          for (const command of decision.commands ?? []) {
            yield* command.effect;
          }

          const receipt = yield* Deferred.await(done);
          const request = model.calendar.rangeRequest;

          for (const read of model.calendar.reads) {
            ({ model } = update(
              model,
              Message.ReceivedEvents({
                accountId: read.accountId,
                request,
                result: {
                  events:
                    read.accountId === "work"
                      ? [
                          ...events,
                          ...receipt.mutations.map(
                            (mutation) => mutation.event
                          ),
                        ]
                      : [],
                  versions: [],
                },
              })
            ));
          }
        }
      }

      yield* Fiber.interrupt(observer);

      return { anchor, calls: memory.calls, model };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(ClipboardRuntime.layer, MonthRuntime.layer)
      ),
      Effect.provideService(CalendarEditingClient, memory.client),
      Effect.provideService(Crypto.Crypto, artifactCrypto),
      Effect.provideService(
        EditingRuntime,
        EditingRuntime.of({
          connect: () => Effect.succeed(Stream.empty),
          dispatch: () =>
            Effect.die(
              "Clipboard artifacts must not replace the global editor"
            ),
        })
      ),
      Effect.provideService(
        DeletionWriter,
        DeletionWriter.of({
          commit: () => Effect.die("Group paste artifacts must not delete"),
        })
      ),
      Effect.provide(unusedSearchLayer),
      Effect.provideService(CalendarSearchClient, unexpectedSearchClient)
    );
  },
  Effect.scoped
);
