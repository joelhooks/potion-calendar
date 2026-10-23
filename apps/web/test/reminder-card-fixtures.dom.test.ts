import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { renderToString } from "foldkit/experimental/server";
import { afterEach, vi } from "vitest";

import { browserNotifications } from "../src/client/reminders/browser.js";
import { ReminderSnoozeStorage } from "../src/client/reminders/model.js";
import type { NotificationEvent } from "../src/client/reminders/model.js";
import { view } from "../src/features/app.js";
import { reminderCardScene } from "./reminder-card-fixture.js";
import type { ReminderCardScene } from "./reminder-card-fixture.js";
import {
  executeReminderCardProofWithStandInBoxes,
  reminderCardProofScript,
} from "./reminder-card-proof.js";
import { upcomingNow } from "./upcoming-fixture.js";

const scenes: readonly ReminderCardScene[] = [
  "prompt",
  "reminder",
  "hidden-tab",
];

const themes: readonly ("light" | "dark")[] = ["light", "dark"];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const assertBrokenReminderCardProofs = (
  saved: string,
  script: string,
  width: number
): void => {
  for (const violation of ["missing", "open", "disabled-lifecycle"] as const) {
    const broken = new DOMParser().parseFromString(saved, "text/html");
    const snooze = broken.querySelector("details.reminder-snooze");
    let reason = "Exactly one Snooze disclosure";

    if (violation === "missing") {
      snooze?.remove();
    } else if (violation === "open") {
      snooze?.setAttribute("open", "");
      reason = "Snooze disclosure must initially be closed";
    } else {
      broken
        .querySelector(".reminder-card .meeting-actions button")
        ?.setAttribute("disabled", "");
      reason = "Action is disabled";
    }

    expect(() => {
      executeReminderCardProofWithStandInBoxes(broken, script, width);
    }).toThrow(reason);
  }
};

it.effect(
  "exports twelve actual-root reminder and prompt fixtures with the exact proof and one native-adapter handoff each",
  () =>
    Effect.gen(function* exportReminderCards() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      yield* TestClock.setTime(upcomingNow + 60_000);
      let exported = 0;

      for (const scene of scenes) {
        for (const theme of themes) {
          for (const width of [900, 1440]) {
            const native: {
              readonly title: string;
              readonly body: string | undefined;
            }[] = [];

            class NativeNotification extends EventTarget {
              static permission = "granted";
              constructor(title: string, options: NotificationOptions) {
                super();
                native.push({ body: options.body, title });
              }
              close() {
                this.dispatchEvent(new Event("close"));
              }
            }

            vi.stubGlobal("Notification", NativeNotification);
            vi.spyOn(document, "visibilityState", "get").mockReturnValue(
              scene === "hidden-tab" ? "hidden" : "visible"
            );
            const result = reminderCardScene(scene, theme, width);
            expect(
              result.commands?.filter(
                (command) => command.name === "DeliverReminderNotification"
              )
            ).toHaveLength(1);
            expect(
              ReminderSnoozeStorage.guards.Ready(
                result.model.reminders.context.snoozeStorage
              )
            ).toBe(true);
            const [notification] = result.model.reminders.context.active;

            if (notification?.card === undefined) {
              return yield* Effect.die(
                new Error("Missing selected reminder card")
              );
            }

            yield* Effect.gen(function* adapterReceipt() {
              const port = browserNotifications();

              const events =
                yield* Queue.unbounded<typeof NotificationEvent.Type>();

              yield* port.observe(notification.personId).pipe(
                Stream.runForEach((event) => Queue.offer(events, event)),
                Effect.forkScoped
              );
              yield* Queue.take(events);
              yield* port.show(notification);
              expect(native).toHaveLength(1);
              expect(native[0]?.title).toBe(notification.title);
              expect(native[0]?.body).toContain(
                "not in this plain browser notification"
              );
            }).pipe(Effect.scoped);

            const rendered = yield* renderToString(
              { init: () => ({ model: result.model }), view },
              { isHydratable: false }
            );

            const script = reminderCardProofScript({
              email: scene !== "reminder",
              hidden: scene === "hidden-tab",
              join: scene !== "reminder",
              kind: scene === "reminder" ? "reminder" : "upcoming",
              notificationCount: native.length,
              title:
                scene === "reminder"
                  ? "Read the project brief"
                  : "Weekly project review",
              untilStart:
                result.model.calendar.now < notification.candidate.start,
              width,
            });

            const path = `../../.git/reminder-card-${scene}-${theme}-${width}-fixture.html`;
            yield* fs.writeFileString(
              path,
              `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`
            );
            const saved = yield* fs.readFileString(path);

            const proofDocument = new DOMParser().parseFromString(
              saved,
              "text/html"
            );

            expect(
              proofDocument.querySelectorAll(".reminder-card")
            ).toHaveLength(1);
            expect(proofDocument.querySelector("script")?.textContent).toBe(
              script
            );

            const disclosure = proofDocument.querySelector(
              "details.reminder-snooze"
            );

            expect(disclosure).not.toBeNull();
            expect(disclosure?.hasAttribute("open")).toBe(false);
            expect(
              disclosure?.querySelectorAll("button[disabled]")
            ).toHaveLength(0);
            expect(
              [...(disclosure?.querySelectorAll("button") ?? [])].map(
                (button) => button.textContent?.trim()
              )
            ).toEqual([
              "1 minute",
              "5 minutes",
              "15 minutes",
              "30 minutes",
              "60 minutes",
              "1440 minutes",
              ...(result.model.calendar.now < notification.candidate.start
                ? ["Until start"]
                : []),
            ]);
            expect(() => {
              executeReminderCardProofWithStandInBoxes(
                proofDocument,
                script,
                width
              );
            }).not.toThrow();
            expect(
              proofDocument.documentElement.dataset.reminderCardProof
            ).toBe("pass");

            assertBrokenReminderCardProofs(saved, script, width);
            exported += 1;
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
          }
        }
      }

      expect(exported).toBe(12);

      return yield* Effect.void;
    }).pipe(Effect.provide(NodeServices.layer))
);
