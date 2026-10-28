import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  NotificationEvent,
  notificationTag,
} from "../src/client/reminders/model.js";
import { view } from "../src/features/app.js";
import { dayInZone, visibleDays } from "../src/layout/navigation.js";
import { editorViewFields } from "./editor-fixture.js";
import { reminderCardScene } from "./reminder-card-fixture.js";

it.effect.each(["plain", "worker"] as const)(
  "%s body click navigates to an unloaded saved occurrence, keeps the draft and shows details after the real range receipt",
  (path) =>
    Effect.gen(function* selectedDetails() {
      const initial = reminderCardScene("reminder", "light", 1440).model;
      const [notification] = initial.reminders.context.active;

      if (notification === undefined) {
        return yield* Effect.die(new Error("Missing reminder"));
      }

      const day = dayInZone(
        notification.candidate.start,
        initial.calendar.zone
      );

      const away = update(
        initial,
        Message.KeyboardDate({ day: day + 14 })
      ).model;

      const editor = EditorView.cases.Editing.make(editorViewFields);

      const model = {
        ...away,
        calendar: { ...away.calendar, selected: [] },
        editing: { ...away.editing, view: editor },
      };

      const event =
        path === "plain"
          ? NotificationEvent.cases.Clicked.make({ notification })
          : NotificationEvent.cases.Action.make({
              action: "show",
              id: notification.id,
              personId: notification.personId,
              tag: notificationTag(
                notification.personId,
                notification.candidate.identity
              ),
            });

      const message = Message.ObservedNotification({
        event,
        now: model.calendar.now,
      });

      const selected = update(model, message);
      expect(visibleDays(selected.model.calendar.navigation)).toContain(day);
      expect(selected.model.calendar.selected).toEqual([
        notification.candidate.key,
      ]);
      expect(selected.model.editing.view).toBe(editor);
      expect(selected.model.reminders).toBe(model.reminders);
      expect(
        (selected.commands ?? []).some(
          (command) => command.name === "ReadEvents"
        )
      ).toBe(true);
      const repeated = update(selected.model, message);
      expect(repeated.model).toBe(selected.model);
      expect(repeated.commands ?? []).toEqual([]);

      const loaded = update(
        selected.model,
        Message.ReceivedEvents({
          accountId: notification.candidate.event.accountId,
          request: selected.model.calendar.rangeRequest,
          result: { events: [notification.candidate.event], versions: [] },
        })
      ).model;

      const rendered = yield* renderToString(
        { init: () => ({ model: loaded }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(document.querySelector(".detail-panel")?.textContent).toContain(
        notification.candidate.title
      );
      expect(
        document.querySelectorAll(".reminder-card").length
      ).toBeGreaterThan(0);

      return yield* Effect.void;
    })
);
