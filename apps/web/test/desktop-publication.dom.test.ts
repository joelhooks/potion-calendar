// oxlint-disable typescript/promise-function-async -- Owned fake native IPC ports return deterministic Promises without an Effect runner or module mock.
import {
  MeetingJoinOutcome,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaSnapshotValue,
  DesktopActionValue,
  DesktopBridge,
  DesktopSettingsValue,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";

import { Message, init, update } from "../src/client/app.js";
import { DesktopNotice } from "../src/client/desktop/model.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { SearchRuntime } from "../src/client/search/runtime.js";
import { subscriptions } from "../src/client/subscriptions.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingPerson,
} from "./upcoming-fixture.js";

const unusedDomainWork = Effect.die(
  new Error("Desktop publication must not invoke editing or search")
);

const domainFence = Layer.mergeAll(
  unusedBrowserLayers,
  Layer.succeed(
    EditingRuntime,
    EditingRuntime.of({
      connect: () => unusedDomainWork,
      dispatch: () => unusedDomainWork,
    })
  ),
  Layer.succeed(
    SearchRuntime,
    SearchRuntime.of({ observe: () => Stream.fromEffect(unusedDomainWork) })
  )
);

const native = Effect.fn("FakeDesktop.install")(function* install(
  published: AgendaSnapshotValue[]
) {
  const settings: DesktopSettingsValue = {
    issues: [],
    openAtLogin: false,
    preferences: defaultDesktopPreferences(),
    revision: 1,
  };

  const actions = new Set<(value: DesktopActionValue) => void>();
  const observations = new Set<(value: DesktopSettingsValue) => void>();

  const bridge: DesktopBridge = {
    getSettings: () => Promise.resolve(settings),
    joinMeeting: () =>
      Promise.resolve(
        MeetingJoinOutcome.cases.NoMeeting.make({ reason: "noUpcoming" })
      ),
    onAction: (receive) => {
      actions.add(receive);

      return () => {
        actions.delete(receive);
      };
    },
    onSettings: (receive) => {
      observations.add(receive);

      return () => {
        observations.delete(receive);
      };
    },
    publishAgenda: (snapshot) => {
      published.push(snapshot);
    },
    savePreferences: (preferences) =>
      Promise.resolve({ error: null, settings: { ...settings, preferences } }),
    setStartup: (request) =>
      Promise.resolve({
        error: null,
        settings: { ...settings, openAtLogin: request.enabled },
      }),
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = Object.getOwnPropertyDescriptor(window, "potionDesktop");
      Object.defineProperty(window, "potionDesktop", {
        configurable: true,
        value: bridge,
      });

      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          Reflect.deleteProperty(window, "potionDesktop");
        } else {
          Object.defineProperty(window, "potionDesktop", previous);
        }
      })
  );

  return settings;
});

it.effect(
  "the actual application bootstrap reads the native settings before exposing desktop controls",
  () =>
    Effect.gen(function* nativeBootstrap() {
      yield* native([]);
      const started = init();

      const read = started.commands?.find(
        (command) => command.name === "ApplyDesktopRequest"
      );

      if (read === undefined) {
        throw new Error(
          "Application bootstrap did not declare its desktop read"
        );
      }

      const message = yield* Schema.decodeUnknownEffect(Message)(
        yield* read.effect
      );

      const { model } = update(started.model, message);
      expect(model.desktop.availability).toBe("available");
    })
);

it.effect(
  "the production subscription publishes only the saved selection-wide DTO and clears it at sign-out",
  () =>
    Effect.gen(function* publicationHistory() {
      const published: AgendaSnapshotValue[] = [];
      const settings = yield* native(published);
      const base = upcomingFixture();

      const read = update(
        base,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: base.upcoming.request,
          result: { events: [savedUpcomingEvent], versions: [] },
        })
      ).model;

      const { model } = update(
        read,
        Message.ReceivedDesktop({
          notice: DesktopNotice.cases.Settings.make({ settings }),
        })
      );

      yield* subscriptions.desktopAgenda
        .dependenciesToStream(
          subscriptions.desktopAgenda.modelToDependencies(model)
        )
        .pipe(Stream.runDrain);
      expect(published).toHaveLength(1);
      expect(published[0]?.events).toHaveLength(1);
      expect(published[0]?.events[0]?.key.eventId).toBe(
        savedUpcomingEvent.eventId
      );
      expect(JSON.stringify(published)).not.toContain("Saved server value");
      expect(published[0]?.events[0]).not.toHaveProperty("attendees");

      const signedOut = update(model, Message.ClickedSignOut()).model;
      yield* subscriptions.desktopAgenda
        .dependenciesToStream(
          subscriptions.desktopAgenda.modelToDependencies(signedOut)
        )
        .pipe(Stream.runDrain);
      expect(published.at(-1)).toEqual({ events: [] });
    }).pipe(Effect.provide(domainFence))
);

it.effect("publication waits until native availability is observed", () =>
  Effect.gen(function* noNativePublication() {
    const published: AgendaSnapshotValue[] = [];
    yield* native(published);
    const model = upcomingFixture();
    yield* subscriptions.desktopAgenda
      .dependenciesToStream(
        subscriptions.desktopAgenda.modelToDependencies(model)
      )
      .pipe(Stream.runDrain);
    expect(published).toEqual([]);
  }).pipe(Effect.provide(domainFence))
);
