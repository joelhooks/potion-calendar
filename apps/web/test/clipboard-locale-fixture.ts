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
  Stream,
} from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { ClipboardDelivery } from "../src/client/clipboard/delivery.js";
import { clipboardNativeHost } from "../src/client/clipboard/host.js";
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
import { normalizePreferences } from "../src/client/settings/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import type { AppLanguage } from "../src/layout/app-locale.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { unusedSearchLayer } from "./browser-runtime-fixture.js";
import {
  groupClipboardFixture,
  groupNativeEvent,
} from "./clipboard-group-fixture.js";
import { clipboardClient } from "./clipboard-runtime-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

export interface ClipboardLocaleScene {
  readonly locale: typeof AppLanguage.Type;
  readonly clock: "12" | "24" | "system";
  readonly system24Hour?: boolean;
  readonly browserDefault?: boolean;
  readonly browserLocale?: string;
  readonly endpoint?: "start" | "end";
  readonly copyLocale?: typeof AppLanguage.Type;
  readonly confirmationLocale?: typeof AppLanguage.Type;
  readonly personId?: string;
  readonly allDay?: boolean;
  readonly transition: "gap" | "fold" | "safe";
  readonly recipient: "single-month" | "relative-week" | "relative-month";
  readonly width: number;
}

const sceneClock = (scene: ClipboardLocaleScene): "12" | "24" => {
  if (scene.clock === "system") {
    return scene.system24Hour === true ? "24" : "12";
  }

  return scene.clock;
};

const sceneDates = (scene: ClipboardLocaleScene) => {
  if (scene.transition === "safe") {
    return {
      ends: ["09:00", "11:00", "13:00"],
      sourceDate: "2026-03-07",
      starts: ["08:00", "10:00", "12:00"],
      targetDate: "2026-03-09",
    };
  }

  if (scene.transition === "fold") {
    return {
      ends: ["00:45", scene.endpoint === "end" ? "01:30" : "02:15", "04:45"],
      sourceDate: "2026-10-01",
      starts: ["00:00", scene.endpoint === "end" ? "00:30" : "01:30", "04:00"],
      targetDate: "2026-11-01",
    };
  }

  return {
    ends: ["00:45", scene.endpoint === "end" ? "02:30" : "03:15", "04:45"],
    sourceDate: "2026-02-01",
    starts: ["00:00", scene.endpoint === "end" ? "01:30" : "02:30", "04:00"],
    targetDate: "2026-03-08",
  };
};

export const clipboardLocaleOracle = (scene: ClipboardLocaleScene) => {
  const fold = scene.transition === "fold";
  const hour = fold ? 1 : 2;
  const timeFormat = sceneClock(scene);

  const coordinates = DateTime.toEpochMillis(
    DateTime.makeUnsafe(fold ? "2026-11-01T01:30:00Z" : "2026-03-08T02:30:00Z")
  );

  const observedLocale =
    scene.browserDefault === true
      ? (scene.browserLocale ?? "fr-FR")
      : scene.locale;

  const locale = observedLocale === "es-LA" ? "es-419" : observedLocale;
  const legacyClock = timeFormat === "24" ? `0${hour}:30` : `${hour}:30am`;

  const clock =
    locale === "en-US"
      ? legacyClock
      : new Intl.DateTimeFormat(locale, {
          calendar: "gregory",
          hour: "numeric",
          hourCycle: timeFormat === "24" ? "h23" : "h12",
          minute: "2-digit",
          timeZone: "UTC",
        }).format(coordinates);

  const date = new Intl.DateTimeFormat(locale, {
    calendar: "gregory",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(coordinates);

  const reason = fold
    ? "happens twice when clocks fall back"
    : "doesn't exist when clocks spring forward";

  return {
    clock,
    date,
    sentence: `Beta would ${scene.endpoint ?? "start"} at ${clock} on ${date}, which ${reason}. Paste it somewhere else.`,
  };
};

export const collectClipboardLocale = Effect.fn("test.collectClipboardLocale")(
  function* collectClipboardLocale(
    scene: ClipboardLocaleScene,
    suppliedClient?: CalendarEditingClient["Service"]
  ) {
    const source = groupClipboardFixture(scene.recipient !== "relative-week");
    const personId = scene.personId ?? source.personId;
    const fold = scene.transition === "fold";
    const safe = scene.transition === "safe";
    const { sourceDate, targetDate, starts, ends } = sceneDates(scene);
    const single = scene.recipient === "single-month";
    const session = Option.getOrThrow(AsyncData.getData(source.model.session));

    if (session === null) {
      return yield* Effect.die(
        "Clipboard locale fixture requires a signed-in session"
      );
    }

    const events = source.events.flatMap((event, index) =>
      single && index !== 1
        ? []
        : [
            CalendarEvent.make({
              ...event,
              attendees:
                scene.confirmationLocale === undefined ? [] : event.attendees,
              end:
                scene.allDay === true
                  ? { date: "2026-03-08" }
                  : {
                      dateTime: `${sourceDate}T${ends[index]}:00-${fold ? "07" : "08"}:00`,
                    },
              start:
                scene.allDay === true
                  ? { date: sourceDate }
                  : {
                      dateTime: `${sourceDate}T${starts[index]}:00-${fold ? "07" : "08"}:00`,
                    },
            }),
          ]
    );

    let model: AppModel = {
      ...source.model,
      calendar: {
        ...source.model.calendar,
        navigation: {
          ...initialNavigation(dayFromIso(sourceDate)),
          mode: source.model.calendar.navigation.mode,
        },
        reads: [
          {
            accountId: "work",
            events: RemoteEvents.Success({ data: { events, versions: [] } }),
          },
        ],
        viewportWidth: scene.width - 245,
      },
      person: Option.some(personId),
      session: AsyncData.Success({
        data: { ...session, user: { ...session.user, id: personId } },
      }),
    };

    ({ model } = update(
      model,
      Message.ReceivedSystemSettings({
        dark: false,
        hour24: scene.system24Hour ?? false,
        locale: scene.browserLocale ?? "fr-FR",
      })
    ));
    ({ model } = update(
      model,
      Message.ReceivedPreferences({
        person: personId,
        preferences: normalizePreferences({
          ...preferenceSnapshot(model),
          language:
            scene.browserDefault === true
              ? undefined
              : (scene.copyLocale ?? scene.locale),
          timeFormat: scene.clock,
        }),
      })
    ));
    model = {
      ...model,
      calendar: {
        ...model.calendar,
        selected: visibleEvents(model).map((event) => event.key),
      },
    };

    const anchor =
      scene.recipient === "relative-week"
        ? ClipboardAnchor.cases.Timed.make({
            date: targetDate,
            instant: DateTime.toEpochMillis(
              DateTime.makeUnsafe(
                `${targetDate}T00:00:00-${fold || safe ? "07" : "08"}:00`
              )
            ),
          })
        : ClipboardAnchor.cases.AllDay.make({
            date: targetDate,
            origin: "month",
          });

    const memory = clipboardClient(0);
    const platformCrypto = yield* Crypto.Crypto;
    const counter = yield* Ref.make(0);

    const crypto = Crypto.Crypto.of({
      ...platformCrypto,
      randomUUIDv4: Ref.updateAndGet(counter, (value) => value + 1).pipe(
        Effect.map(
          (value) =>
            `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`
        )
      ),
    });

    return yield* Effect.gen(function* actualClipboardRecipient() {
      const runtime = yield* ClipboardRuntime;
      const connection = yield* runtime.connect(personId);
      const ready = yield* Deferred.make<boolean>();
      const copied = yield* Deferred.make<boolean>();
      const settled = yield* Deferred.make<boolean>();
      let pasting = false;
      let confirmed = false;
      let copyToastId: string | undefined;

      const observer = yield* connection.notices.pipe(
        Stream.runForEach((notice) =>
          Effect.gen(function* localeNotice() {
            ({ model } = update(
              model,
              Message.ReceivedClipboard({
                delivery: ClipboardDelivery.make({
                  epoch: model.clipboard.epoch,
                  notice,
                  personId,
                  sessionId: connection.sessionId,
                }),
              })
            ));

            if (ClipboardNotice.guards.State(notice)) {
              yield* Deferred.succeed(ready, true);

              if (
                ClipboardView.guards.Guests(notice.view) &&
                !confirmed &&
                scene.confirmationLocale !== undefined
              ) {
                confirmed = true;
                ({ model } = update(
                  model,
                  Message.ReceivedPreferences({
                    person: personId,
                    preferences: normalizePreferences({
                      ...preferenceSnapshot(model),
                      language: scene.confirmationLocale,
                      timeFormat: "24",
                    }),
                  })
                ));
                yield* runtime.dispatch(
                  personId,
                  connection.sessionId,
                  ClipboardAction.cases.Guests.make({
                    choice: "exclude",
                    intentId: notice.view.intentId,
                  })
                );
              }

              if (Option.isSome(notice.view.copied) && !pasting) {
                copyToastId = notice.view.copied.value.id;
                yield* Deferred.succeed(copied, true);
              }

              const freshPasteToast =
                Option.isSome(notice.view.toast) &&
                notice.view.toast.value.id !== copyToastId;

              if (
                pasting &&
                (ClipboardView.guards.Results(notice.view) ||
                  ClipboardView.guards.Failure(notice.view) ||
                  freshPasteToast)
              ) {
                yield* Deferred.succeed(settled, true);
              }
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
      yield* Deferred.await(copied);

      if (scene.copyLocale !== undefined) {
        ({ model } = update(
          model,
          Message.ReceivedPreferences({
            person: personId,
            preferences: normalizePreferences({
              ...preferenceSnapshot(model),
              language: scene.locale,
              timeFormat: scene.clock,
            }),
          })
        ));
      }

      const paste = groupNativeEvent(copy.data.get("text/plain"));
      const host = clipboardNativeHost(model, connection, anchor, document);
      pasting = true;
      yield* connection.native(
        Option.getOrThrow(
          observeNativeClipboard(host, paste.event, "paste", 2, document, false)
        )
      );
      yield* Deferred.await(settled);
      yield* Fiber.interrupt(observer);

      return {
        calls: memory.calls,
        confirmed,
        model,
        presentation: host?.target?.refusalPresentation,
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(ClipboardRuntime.layer, MonthRuntime.layer)
      ),
      Effect.provideService(
        CalendarEditingClient,
        suppliedClient ?? memory.client
      ),
      Effect.provideService(Crypto.Crypto, crypto),
      Effect.provideService(
        EditingRuntime,
        EditingRuntime.of({
          connect: () => Effect.succeed(Stream.empty),
          dispatch: () => Effect.die("DST refusal must not open a creator"),
        })
      ),
      Effect.provideService(
        DeletionWriter,
        DeletionWriter.of({
          commit: () => Effect.die("Copy paste must not delete"),
        })
      ),
      Effect.provide(unusedSearchLayer),
      Effect.provideService(CalendarSearchClient, unexpectedSearchClient)
    );
  },
  Effect.scoped
);
