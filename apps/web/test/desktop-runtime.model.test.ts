// oxlint-disable typescript/promise-function-async -- Owned fake native ports return deterministic Promises without adding async control flow or Effect runners.
import {
  DesktopAction,
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
import { Effect, Fiber, Option, Queue, Stream } from "effect";

import type { DesktopNotice } from "../src/client/desktop/model.js";
import { DesktopOutcome, DesktopRequest } from "../src/client/desktop/model.js";
import {
  desktopNoticeStream,
  runDesktopRequest,
} from "../src/client/desktop/runtime.js";

const settings = (): DesktopSettingsValue => ({
  issues: [],
  openAtLogin: false,
  preferences: defaultDesktopPreferences(),
  revision: 1,
});

const fixture = (current = settings(), ready?: Queue.Enqueue<boolean>) => {
  const actions = new Set<(value: DesktopActionValue) => void>();
  const observations = new Set<(value: DesktopSettingsValue) => void>();
  const startup: boolean[] = [];
  const published: AgendaSnapshotValue[] = [];

  const bridge: DesktopBridge = {
    getSettings: () => Promise.resolve(current),
    joinMeeting: (request) =>
      Promise.resolve(
        MeetingJoinOutcome.cases.Requested.make({ key: request.key })
      ),
    onAction: (receive) => {
      actions.add(receive);

      return () => {
        actions.delete(receive);
      };
    },
    onSettings: (receive) => {
      observations.add(receive);

      if (ready !== undefined) {
        Queue.offerUnsafe(ready, true);
      }

      return () => {
        observations.delete(receive);
      };
    },
    publishAgenda: (snapshot) => {
      published.push(snapshot);
    },
    savePreferences: (preferences) =>
      Promise.resolve({
        error: null,
        settings: { ...current, preferences, revision: current.revision + 1 },
      }),
    setStartup: (request) => {
      startup.push(request.enabled);

      return Promise.resolve({
        error: "macOS has not applied the login-item change.",
        settings: { ...current, revision: current.revision + 1 },
      });
    },
  };

  return { actions, bridge, observations, published, startup };
};

it.effect(
  "ordinary browsers report unavailable rather than inventing desktop preferences",
  () =>
    Effect.gen(function* noBridge() {
      const notice = yield* runDesktopRequest(
        DesktopRequest.cases.Read.make({ request: 1 }),
        Option.none()
      );

      expect(notice.outcome._tag).toBe("Unavailable");
    })
);

it.effect(
  "startup uses the observed OS result and calls the setter only once",
  () =>
    Effect.gen(function* osTruth() {
      const port = fixture();

      const notice = yield* runDesktopRequest(
        DesktopRequest.cases.Startup.make({ enabled: true, request: 2 }),
        Option.some(port.bridge)
      );

      expect(port.startup).toEqual([true]);
      expect(notice.outcome._tag).toBe("Ready");

      if (DesktopOutcome.guards.Ready(notice.outcome)) {
        expect(notice.outcome.settings.openAtLogin).toBe(false);
        expect(Option.isSome(notice.outcome.error)).toBe(true);
      }
    })
);

it.effect(
  "malformed native replies cannot become accepted browser settings",
  () =>
    Effect.gen(function* refusedReply() {
      const port = fixture({ ...settings(), revision: 0.25 });

      const notice = yield* runDesktopRequest(
        DesktopRequest.cases.Read.make({ request: 3 }),
        Option.some(port.bridge)
      );

      expect(notice.outcome._tag).toBe("Failed");
    })
);

it.effect(
  "native subscriptions decode observations and release both listeners on interruption",
  () =>
    Effect.gen(function* observerLifetime() {
      const ready = yield* Queue.unbounded<boolean>();
      const received = yield* Queue.unbounded<typeof DesktopNotice.Type>();
      const port = fixture(settings(), ready);
      const scope = yield* Effect.scope;

      const fiber = yield* desktopNoticeStream(Option.some(port.bridge)).pipe(
        Stream.runForEach((notice) => Queue.offer(received, notice)),
        Effect.forkIn(scope)
      );

      yield* Queue.take(ready);

      for (const observe of port.observations) {
        observe({ ...settings(), revision: 0.5 });
      }

      expect((yield* Queue.take(received))._tag).toBe("Rejected");

      for (const observe of port.actions) {
        observe(DesktopAction.cases.RequestedJoinMeeting.make({}));
      }

      expect((yield* Queue.take(received))._tag).toBe("Action");
      yield* Fiber.interrupt(fiber);
      expect(port.actions.size).toBe(0);
      expect(port.observations.size).toBe(0);
    })
);
