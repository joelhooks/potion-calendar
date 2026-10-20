import {
  DesktopAction,
  MeetingJoinOutcome,
  defaultDesktopPreferences,
  desktopWire,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  DesktopActionValue,
  DesktopSettingsValue,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";

import { createDesktopBridge } from "../src/bridge-client.js";
import type { RendererBridgePort } from "../src/bridge-client.js";

const settings: DesktopSettingsValue = {
  issues: [],
  openAtLogin: false,
  preferences: defaultDesktopPreferences(),
  revision: 1,
};

const meeting: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: 1_792_500_000_000,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "meeting" },
  responseStatus: "accepted",
  start: 1_792_496_400_000,
  title: "Saved meeting",
};

const fixture = () => {
  const publications: string[] = [];
  const joins: string[] = [];
  const actions = new Set<(message: string) => void>();
  const updates = new Set<(message: string) => void>();
  const state = { rejections: 0 };

  const port: RendererBridgePort = {
    // oxlint-disable-next-line typescript/promise-function-async -- This fake returns the native IPC Promise contract without asynchronous business logic.
    getSettings: () => Promise.resolve(JSON.stringify(settings)),
    // oxlint-disable-next-line typescript/promise-function-async -- The fake returns the native meeting handoff Promise after decoding its request.
    joinMeeting: (message) => {
      joins.push(message);
      const request = Schema.decodeSync(desktopWire.join)(message);

      return Promise.resolve(
        JSON.stringify(
          MeetingJoinOutcome.cases.Requested.make({ key: request.key })
        )
      );
    },
    publishAgenda: (message) => {
      publications.push(message);
    },
    rejected: () => {
      state.rejections += 1;
    },
    // oxlint-disable-next-line typescript/promise-function-async -- The fake returns a resolved native reply after decoding the wire request.
    savePreferences: (message) => {
      const preferences = Schema.decodeSync(desktopWire.preferences)(message);

      return Promise.resolve(
        JSON.stringify({ error: null, settings: { ...settings, preferences } })
      );
    },
    // oxlint-disable-next-line typescript/promise-function-async -- The fake implements the native IPC reply shape without introducing a second runtime.
    setStartup: (message) => {
      const request = Schema.decodeSync(desktopWire.startup)(message);

      return Promise.resolve(
        JSON.stringify({
          error: null,
          settings: { ...settings, openAtLogin: request.enabled },
        })
      );
    },
    subscribeActions: (receive) => {
      actions.add(receive);

      return () => {
        actions.delete(receive);
      };
    },
    subscribeSettings: (receive) => {
      updates.add(receive);

      return () => {
        updates.delete(receive);
      };
    },
  };

  return { actions, joins, port, publications, state, updates };
};

it.effect("decodes outgoing agenda messages before they reach native IPC", () =>
  Effect.gen(function* outgoingAgenda() {
    const transport = fixture();
    const bridge = createDesktopBridge(transport.port);

    const snapshot = {
      events: [
        {
          ...meeting,
          attendees: [{ email: "private@example.test" }],
          description: "private notes",
          location: "private address",
        },
      ],
    };

    bridge.publishAgenda(snapshot);
    bridge.publishAgenda({
      events: [{ ...meeting, conferenceUrl: "http://meet.example.test/room" }],
    });
    bridge.publishAgenda({ events: [{ ...meeting, start: Number.NaN }] });

    const published = yield* Effect.forEach((message: string) =>
      Schema.decodeEffect(desktopWire.agenda)(message)
    )(transport.publications);

    expect(published).toEqual([{ events: [meeting] }]);
    expect(transport.publications.join("")).not.toContain("private notes");
    expect(transport.publications.join("")).not.toContain("private address");
    expect(transport.publications.join("")).not.toContain(
      "private@example.test"
    );
    expect(transport.state.rejections).toBe(2);
  })
);

it.effect(
  "decodes native actions and settings changes and releases listeners",
  () =>
    Effect.sync(() => {
      const transport = fixture();
      const bridge = createDesktopBridge(transport.port);
      const received: DesktopActionValue[] = [];
      const changed: DesktopSettingsValue[] = [];

      const stopActions = bridge.onAction((action) => {
        received.push(action);
      });

      const stopSettings = bridge.onSettings((value) => {
        changed.push(value);
      });

      const action = DesktopAction.cases.ShowEvent.make({ key: meeting.key });

      for (const receive of transport.actions) {
        receive(JSON.stringify(action));
        receive(JSON.stringify({ key: meeting.key }));
      }

      for (const receive of transport.updates) {
        receive(JSON.stringify(settings));
        receive(JSON.stringify({ ...settings, openAtLogin: "yes" }));
      }

      expect(received).toEqual([action]);
      expect(changed).toEqual([settings]);
      expect(transport.state.rejections).toBe(2);

      stopActions();
      stopSettings();

      expect(transport.actions.size).toBe(0);
      expect(transport.updates.size).toBe(0);
    })
);

it.effect("rejects an unsafe native join as Failed rather than NoMeeting", () =>
  Effect.gen(function* unsafeJoin() {
    const transport = fixture();
    const bridge = createDesktopBridge(transport.port);

    const result = yield* Effect.promise(
      // @effect-diagnostics-next-line asyncFunction:off -- The test invokes the public native handoff Promise boundary.
      async () =>
        await bridge.joinMeeting({
          conferenceUrl: "http://meet.example.test/room",
          key: meeting.key,
        })
    );

    expect(result._tag).toBe("Failed");
    expect(transport.joins).toEqual([]);
    expect(transport.state.rejections).toBe(1);
  })
);

it.effect(
  "returns decoded native settings and rejects malformed native replies",
  () =>
    Effect.gen(function* nativeReplies() {
      const transport = fixture();
      const bridge = createDesktopBridge(transport.port);
      const initial = yield* Effect.promise(bridge.getSettings);

      expect(initial.openAtLogin).toBe(false);

      const joined = yield* Effect.promise(
        // @effect-diagnostics-next-line asyncFunction:off -- The test invokes the public native handoff Promise at its boundary.
        async () =>
          await bridge.joinMeeting({
            conferenceUrl: "https://meet.example.test/room",
            key: meeting.key,
          })
      );

      expect(joined).toEqual(
        MeetingJoinOutcome.cases.Requested.make({ key: meeting.key })
      );

      const preferences = {
        ...settings.preferences,
        includeDays: 30,
      } satisfies typeof settings.preferences;

      const saved = yield* Effect.promise(
        // @effect-diagnostics-next-line asyncFunction:off -- The test invokes the public native Promise API at its boundary.
        async () => await bridge.savePreferences(preferences)
      );

      const startup = yield* Effect.promise(
        // @effect-diagnostics-next-line asyncFunction:off -- The test invokes the native login-item Promise API at its boundary.
        async () => await bridge.setStartup({ enabled: true })
      );

      expect(saved.settings.preferences.includeDays).toBe(30);
      expect(startup.settings.openAtLogin).toBe(true);

      const invalid = createDesktopBridge({
        ...transport.port,
        // oxlint-disable-next-line typescript/promise-function-async -- The malformed native reply is an immediate Promise fixture, not asynchronous business logic.
        getSettings: () => Promise.resolve(JSON.stringify({ issues: [] })),
      });

      const rejected = yield* Effect.promise(invalid.getSettings).pipe(
        Effect.exit
      );

      expect(Exit.isFailure(rejected)).toBe(true);
      expect(transport.state.rejections).toBe(1);
    })
);
