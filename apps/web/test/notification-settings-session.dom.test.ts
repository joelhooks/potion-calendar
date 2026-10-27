import { SessionSnapshot } from "@calendar/core/contracts";
import {
  NotificationSettingsReply,
  NotificationSettingsRequest,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Predicate, Queue, Schema } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import {
  NotificationSettingsChange,
  RemoteNotificationSettingsOperation,
  initialNotificationSettings,
} from "../src/client/desktop/notification-model.js";
import { view } from "../src/features/app.js";
import {
  browserIcsBridge,
  unusedIcsRootLayers,
} from "./desktop-ics-fixture.js";
import { notificationSettingsFixture } from "./notification-settings-fixture.js";

interface Envelope {
  readonly operation: typeof NotificationSettingsRequest.Type;
  readonly resolve: (reply: typeof NotificationSettingsReply.Type) => void;
}

const commandArgs = Schema.Struct({
  operation: NotificationSettingsRequest,
  request: Schema.Int,
});

const refreshedSession = Schema.decodeSync(SessionSnapshot)({
  accounts: [],
  user: {
    email: "owner@example.test",
    id: "fixture-person",
    name: "Calendar owner",
  },
});

const newestFailure = "The newer System Settings handoff failed.";

const rootHistory = Effect.fn("NotificationSettings.rootHistory")(
  function* rootHistory({
    before = 0,
    paint = true,
    postRefresh,
    refreshes = 1,
    signOut,
  }: {
    readonly before?: number;
    readonly paint?: boolean;
    readonly postRefresh: number;
    readonly refreshes?: number;
    readonly signOut: boolean;
  }) {
    const pending = yield* Queue.unbounded<Envelope>();
    const calls: string[] = [];
    const ids: number[] = [];
    const trace: string[] = [];
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const previous = Object.getOwnPropertyDescriptor(
          window,
          "potionDesktop"
        );

        // oxlint-disable promise/avoid-new -- Only this faithful native Promise boundary is queued into the existing test scope.
        const bridge = {
          ...browserIcsBridge(),
          // oxlint-disable-next-line typescript/promise-function-async -- The supplied preload port returns a native Promise controlled by this test's existing scope.
          notificationSettings: (
            operation: typeof NotificationSettingsRequest.Type
          ) =>
            // @effect-diagnostics-next-line newPromise:off -- This controlled preload boundary must expose a native Promise to the existing command.
            new Promise<typeof NotificationSettingsReply.Type>((resolve) => {
              calls.push(operation._tag);
              Queue.offerUnsafe(pending, { operation, resolve });
            }),
        };
        // oxlint-enable promise/avoid-new -- The supplied native Promise boundary ends here.

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
    const base = notificationSettingsFixture();

    let model: AppModel = {
      ...base,
      desktop: {
        ...base.desktop,
        notificationSettings: initialNotificationSettings(),
      },
    };

    const begin = Effect.fn("NotificationSettings.beginRootCommand")(
      function* begin(action: "Read" | "Open") {
        const result = update(
          model,
          Message.ChangedDesktopNotificationSettings({
            change:
              action === "Read"
                ? NotificationSettingsChange.cases.Read.make({})
                : NotificationSettingsChange.cases.Open.make({}),
          })
        );

        ({ model } = result);
        expect(result.commands).toHaveLength(1);
        const [command] = result.commands ?? [];

        if (command === undefined) {
          return yield* Effect.die("Missing root notification command");
        }

        expect(command.name).toBe("ApplyNotificationSettings");

        const args = yield* Schema.decodeUnknownEffect(commandArgs)(
          command.args
        );

        expect(args.operation._tag).toBe(action);
        ids.push(args.request);
        trace.push(`${action}:${args.request}`);

        const fiber = yield* command.effect.pipe(
          Effect.provide(unusedIcsRootLayers),
          Effect.forkScoped
        );

        const envelope = yield* Queue.take(pending);
        expect(envelope.operation).toEqual(args.operation);

        return { envelope, fiber };
      }
    );

    const read = Effect.fn("NotificationSettings.completeRootRead")(
      function* read() {
        const work = yield* begin("Read");
        work.envelope.resolve(
          NotificationSettingsReply.cases.Read.make({
            permission: { authorization: "unknown", supported: true },
            version: 1,
          })
        );
        ({ model } = update(model, yield* Fiber.join(work.fiber)));
      }
    );

    const completedOpen = Effect.fn("NotificationSettings.completeRootOpen")(
      function* completedOpen() {
        const work = yield* begin("Open");
        work.envelope.resolve(
          NotificationSettingsReply.cases.Requested.make({ version: 1 })
        );
        ({ model } = update(model, yield* Fiber.join(work.fiber)));
      }
    );

    const receiveSession = (snapshot: typeof SessionSnapshot.Type | null) => {
      const session = update(model, Message.ReceivedSession({ snapshot }));
      ({ model } = session);
      trace.push(snapshot === null ? "signed-out" : "session-refreshed");

      if (snapshot === null) {
        expect(session.commands ?? []).toEqual([]);

        return;
      }

      expect(session.commands?.map((command) => command.name)).toEqual([
        "ReadPreferences",
      ]);

      const preferences = update(
        model,
        Message.FailedPreferences({ person: snapshot.user.id })
      );

      ({ model } = preferences);
      expect(preferences.commands?.map((command) => command.name)).toEqual([
        "ReadCalendars",
      ]);

      const calendars = update(
        model,
        Message.FailedCalendars({
          failure: {
            kind: "retry",
            message:
              "The supplied session fixture has no remote calendar inventory.",
          },
          personId: snapshot.user.id,
        })
      );

      ({ model } = calendars);
      expect(calendars.commands ?? []).toEqual([]);
    };

    yield* read();

    for (let index = 0; index < before; index += 1) {
      yield* completedOpen();
    }

    const old = yield* begin("Open");

    if (signOut) {
      receiveSession(null);
    }

    for (let index = 0; index < refreshes; index += 1) {
      receiveSession(refreshedSession);
    }

    if (
      Option.isNone(
        AsyncData.getData(
          model.desktop.notificationSettings?.permission ??
            initialNotificationSettings().permission
        )
      )
    ) {
      if (paint) {
        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        expect(
          new DOMParser()
            .parseFromString(rendered.html, "text/html")
            .querySelector("#desktop-notification-settings-read")
        ).not.toBeNull();
      }

      yield* read();
    }

    for (let index = 0; index < postRefresh; index += 1) {
      yield* completedOpen();
    }

    const newer = yield* begin("Open");
    old.envelope.resolve(
      NotificationSettingsReply.cases.Requested.make({ version: 1 })
    );
    const oldMessage = yield* Fiber.join(old.fiber);
    ({ model } = update(model, oldMessage));

    const newerStillPending = Predicate.isTagged(
      model.desktop.notificationSettings?.operation,
      "Loading"
    );

    trace.push("old-open-delivered-during-new-open");
    newer.envelope.resolve(
      NotificationSettingsReply.cases.Failed.make({
        message: newestFailure,
        version: 1,
      })
    );
    ({ model } = update(model, yield* Fiber.join(newer.fiber)));
    const current = model.desktop.notificationSettings?.operation;
    expect(current).toEqual(
      RemoteNotificationSettingsOperation.Failure({ error: newestFailure })
    );
    expect(newerStillPending).toBe(true);

    if (paint) {
      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const dom = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(
        dom.querySelector(
          'section[aria-label="macOS notifications"] [role="alert"]'
        )?.textContent
      ).toBe(newestFailure);
    }

    expect(update(model, oldMessage).model).toBe(model);
    expect(ids.every((id, index) => id > (ids[index - 1] ?? 0))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(trace).toContain("old-open-delivered-during-new-open");
    expect(calls.filter((call) => call === "Open")).toHaveLength(
      before + postRefresh + 2
    );
  },
  Effect.scoped
);

it.effect.each([
  { postRefresh: 0, signOut: false },
  { postRefresh: 1, signOut: false },
  { postRefresh: 0, signOut: true },
  { postRefresh: 1, signOut: true },
])(
  "an old positive-id Open cannot hide the newer failure after session reset with postRefresh=$postRefresh and signOut=$signOut",
  rootHistory
);

it.effect.prop(
  "positive root histories retain a notification high-water mark across repeated refresh and sign-in",
  {
    before: Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 })),
    postRefresh: Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 })),
    refreshes: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 1 })),
    signOut: Schema.Boolean,
  },
  (history) => rootHistory({ ...history, paint: false })
);
