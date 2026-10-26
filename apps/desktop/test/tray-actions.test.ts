import { expect, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { TestClock } from "effect/testing";

import { NativeIntent } from "../src/native-host.js";
import { performTrayAction, resolveTrayAction } from "../src/tray-actions.js";
import type { TrayActionPort } from "../src/tray-actions.js";
import { trayEvent, trayNow, trayView } from "./tray-current-fixture.js";

const origin = "https://calendar.test";

it.effect(
  "main resolves each current action from the accepted event and preserves ordinary day-row Join",
  () =>
    Effect.sync(() => {
      const event = trayEvent("current");
      const view = trayView([event]);

      const join = NativeIntent.cases.TrayJoin.make({
        conferenceUrl: "https://meet.example.test/room",
        key: event.key,
        section: "current",
      });

      const attachment = NativeIntent.cases.TrayAttachment.make({
        index: 1,
        key: event.key,
        url: "https://files.example.test/notes",
      });

      const email = NativeIntent.cases.TrayEmail.make({
        href: "mailto:guest@example.test?subject=Saved%20meeting",
        key: event.key,
      });

      expect(resolveTrayAction(join, view, origin, trayNow)).toEqual({
        kind: "join",
        request: { conferenceUrl: event.conferenceUrl, key: event.key },
      });
      expect(resolveTrayAction(attachment, view, origin, trayNow)).toEqual({
        href: "https://files.example.test/notes",
        kind: "external",
      });
      expect(resolveTrayAction(email, view, origin, trayNow)).toEqual({
        href: email.href,
        kind: "external",
      });
      expect(
        resolveTrayAction(
          NativeIntent.cases.TrayShowEvent.make({ key: event.key }),
          view,
          origin,
          trayNow
        )
      ).toEqual({ key: event.key, kind: "show" });
      const later = trayEvent("later", trayNow + 1000);
      expect(
        resolveTrayAction(
          NativeIntent.cases.TrayJoin.make({
            ...join,
            key: later.key,
            section: "day",
          }),
          trayView([event, later]),
          origin,
          trayNow
        )?.kind
      ).toBe("join");
    })
);

it.effect.each([
  "https://other.example.test/x",
  "file:///etc/passwd",
  // oxlint-disable-next-line no-script-url -- A forged renderer email must not become an executable tray handoff.
  "javascript:alert(1)",
  "mailto:other@example.test?subject=Saved%20meeting",
  "mailto:guest@example.test?subject=Saved%20meeting&body=Injected",
])(
  "main refuses a different renderer email href %s even when the renderer copies it into both bounded metadata and the callback",
  (href) =>
    Effect.sync(() => {
      const event = trayEvent("current");
      const details = event.trayDetails;

      if (details === undefined) {
        throw new Error("Missing fixture details");
      }

      const forged = {
        ...event,
        trayDetails: { ...details, email: { href, recipientCount: 1 } },
      };

      expect(
        resolveTrayAction(
          NativeIntent.cases.TrayEmail.make({ href, key: event.key }),
          trayView([forged]),
          origin,
          trayNow
        )
      ).toBeUndefined();
    })
);

it.effect.each([
  "http://files.example.test/x",
  "file:///etc/passwd",
  "https://user:password@files.example.test/x",
  "https://calendar.test/private",
  "https://files.example.test/x\ny",
])(
  "main refuses an impermissible renderer attachment %s even when legacy and new fields agree",
  (url) =>
    Effect.sync(() => {
      const event = trayEvent("current");
      const details = event.trayDetails;

      if (details === undefined) {
        throw new Error("Missing fixture details");
      }

      const forged = {
        ...event,
        attachments: [{ title: "x", url }],
        trayDetails: {
          ...details,
          attachments: [{ index: 0, title: "x", url }],
        },
      };

      expect(
        resolveTrayAction(
          {
            ...NativeIntent.cases.TrayAttachment.make({
              index: 0,
              key: event.key,
              url: "https://files.example.test/x",
            }),
            url,
          },
          trayView([forged]),
          origin,
          trayNow
        )
      ).toBeUndefined();
    })
);

it.effect(
  "old current-card callbacks refuse new current choices, attachment reorder, changed recipient data and exact expiry",
  () =>
    Effect.sync(() => {
      const event = trayEvent("current");

      const action = NativeIntent.cases.TrayAttachment.make({
        index: 0,
        key: event.key,
        url: "https://files.example.test/agenda",
      });

      expect(
        resolveTrayAction(
          action,
          trayView([
            {
              ...event,
              attachments: [
                { title: "Changed", url: "https://files.example.test/new" },
              ],
            },
          ]),
          origin,
          trayNow
        )
      ).toBeUndefined();
      expect(
        resolveTrayAction(
          action,
          trayView([trayEvent("earlier", trayNow - 2000), event]),
          origin,
          trayNow
        )
      ).toBeUndefined();
      expect(
        resolveTrayAction(action, trayView([event]), origin, event.end)
      ).toBeUndefined();
      expect(
        resolveTrayAction(action, trayView([]), origin, trayNow)
      ).toBeUndefined();
      expect(
        resolveTrayAction(
          { ...action, key: { ...event.key, accountId: "foreign" } },
          trayView([event]),
          origin,
          trayNow
        )
      ).toBeUndefined();
      expect(
        resolveTrayAction(
          NativeIntent.cases.TrayEmail.make({
            href: "mailto:guest@example.test?subject=Saved%20meeting",
            key: event.key,
          }),
          trayView([{ ...event, participantEmails: ["latest@example.test"] }]),
          origin,
          trayNow
        )
      ).toBeUndefined();
      expect(
        resolveTrayAction(
          NativeIntent.cases.TrayJoin.make({
            conferenceUrl: "https://meet.example.test/stale",
            key: event.key,
            section: "current",
          }),
          trayView([event]),
          origin,
          trayNow
        )
      ).toBeUndefined();
    })
);

it.effect(
  "execution uses the fresh main clock and frame, not the cached view time, and performs each permitted action once",
  () =>
    Effect.gen(function* mainActionClock() {
      yield* TestClock.setTime(trayNow);
      const event = trayEvent("current");
      const calls = yield* Ref.make<string[]>([]);

      const record = (value: string) =>
        Ref.update(calls, (rows) => [...rows, value]);

      const port: TrayActionPort = {
        join: () => record("join"),
        open: (href) => record(href),
        origin,
        show: () => record("show"),
        trusted: Effect.succeed(true),
      };

      const action = NativeIntent.cases.TrayAttachment.make({
        index: 0,
        key: event.key,
        url: "https://files.example.test/agenda",
      });

      const view = { ...trayView([event]), now: -999_999 };
      yield* performTrayAction(action, view, port);
      expect(yield* Ref.get(calls)).toEqual([action.url]);
      yield* performTrayAction(action, view, {
        ...port,
        trusted: Effect.succeed(false),
      });
      expect(yield* Ref.get(calls)).toEqual([action.url]);
      yield* TestClock.setTime(event.end);
      yield* performTrayAction(action, view, port);
      expect(yield* Ref.get(calls)).toEqual([action.url]);
    })
);
