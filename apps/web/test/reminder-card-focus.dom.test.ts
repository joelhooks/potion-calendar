import { googleCalendarCapabilities } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Queue, Stream } from "effect";
import { Runtime, Subscription } from "foldkit";

import { Message, Model, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { editorDialogs } from "../src/features/event-editor.js";
import { reminderCards } from "../src/features/reminder-cards.js";
import { editingFixture, editorCalendars } from "./editor-fixture.js";
import { reminderCardScene } from "./reminder-card-fixture.js";
import { upcomingNow } from "./upcoming-fixture.js";

const appeared = <A>(read: () => A | undefined) =>
  Effect.callback<A>((resume) => {
    const check = () => {
      const value = read();

      if (value !== undefined) {
        resume(Effect.succeed(value));
      }
    };

    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    check();

    return Effect.sync(() => {
      observer.disconnect();
    });
  });

it.effect(
  "an actual Foldkit reminder arrival preserves focus and unsaved typing in the actual editor input",
  () =>
    Effect.gen(function* reminderArrivalFocus() {
      const container = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("div");
          element.id = "reminder-arrival-focus";
          document.body.append(element);

          return element;
        }),
        (element) =>
          Effect.sync(() => {
            element.remove();
          })
      );

      const messages = yield* Queue.unbounded<AppMessage>();
      const { before } = reminderCardScene("prompt", "light", 1440);

      const program = Runtime.makeElement({
        Model,
        container,
        devTools: false,
        init: () => ({
          model: {
            ...before,
            editing: {
              ...before.editing,
              view: {
                ...editingFixture,
                draft: {
                  ...editingFixture.draft,
                  title: "Unsaved editor text",
                },
              },
            },
          },
        }),
        subscriptions: Subscription.make<AppModel, AppMessage>()(() => ({
          arrivals: Subscription.persistentEntry(Stream.fromQueue(messages)),
        })),
        update: (model, message: AppMessage) => ({
          model: update(model, message).model,
        }),
        view: (model, h) =>
          h.div(
            [],
            [
              ...editorDialogs(h, {
                calendars: editorCalendars,
                model: model.editing.view,
                reminderLimit: googleCalendarCapabilities.maxRemindersCount,
                send: (action) =>
                  Message.EditingAction({
                    action,
                    personId: Option.getOrUndefined(model.person),
                  }),
              }),
              ...reminderCards(model, h),
            ]
          ),
      });

      yield* Effect.acquireRelease(
        Effect.sync(() => Runtime.embed(program)),
        (handle) =>
          Effect.sync(() => {
            handle.dispose();
          })
      );

      const input = yield* appeared(
        () =>
          document.querySelector<HTMLInputElement>("#event-title") ?? undefined
      );

      const dialog = document.querySelector<HTMLDialogElement>(
        "#event-editor-dialog"
      );

      if (dialog !== null) {
        dialog.open = true;
      }

      input.focus();
      input.value = "Unsaved editor text";
      expect(document.activeElement).toBe(input);
      yield* Queue.offer(
        messages,
        Message.Ticked({ now: upcomingNow + 60_000 })
      );

      const card = yield* appeared(
        () => document.querySelector<HTMLElement>(".reminder-card") ?? undefined
      );

      expect(document.querySelector("#event-title")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("Unsaved editor text");
      expect(card.getAttribute("role")).toBe("status");
      expect(card.querySelector("[autofocus]")).toBeNull();
    })
);
