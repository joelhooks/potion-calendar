import { CalendarRef } from "@calendar/calendar/contracts";
import { Effect, Queue, Stream } from "effect";
import type { Cause } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";
import { ManagementChange } from "./model.js";

type PickerMessage =
  | ReturnType<typeof Message.ChangedSettingsManagement>
  | ReturnType<typeof Message.Navigated>;

const closePicker =
  (
    queue: Queue.Queue<PickerMessage, Cause.Done>,
    ref: typeof CalendarRef.Type
  ) =>
  () => {
    Queue.offerUnsafe(
      queue,
      Message.ChangedSettingsManagement({
        change: ManagementChange.cases.ClosePicker.make({ ref }),
      })
    );
  };

export const PrepareColourPicker = Mount.defineStream("PrepareColourPicker", {
  args: CalendarRef.fields,
  execute: ({ element, accountId, calendarId }) =>
    Stream.callback<PickerMessage>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const document = element.ownerDocument;

          const trigger =
            element.parentElement?.querySelector<HTMLButtonElement>(
              ".settings-colour-trigger"
            );

          const close = closePicker(queue, { accountId, calendarId });

          const outside = (event: PointerEvent): void => {
            if (
              event.target instanceof Node &&
              !element.contains(event.target) &&
              trigger?.contains(event.target) !== true
            ) {
              close();
            }
          };

          const key = (event: Event): void => {
            if (event instanceof KeyboardEvent && event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          };

          document.addEventListener("pointerdown", outside, true);
          element.addEventListener("keydown", key, true);
          element.querySelector<HTMLButtonElement>("button")?.focus();
          Queue.offerUnsafe(queue, Message.Navigated());

          return { document, key, outside, trigger };
        }),
        (resource) =>
          Effect.sync(() => {
            resource.document.removeEventListener(
              "pointerdown",
              resource.outside,
              true
            );
            element.removeEventListener("keydown", resource.key, true);

            if (
              (element.contains(resource.document.activeElement) ||
                resource.document.activeElement === resource.document.body) &&
              resource.trigger?.isConnected === true
            ) {
              resource.trigger.focus();
            }
          })
      )
    ),
  messages: [Message.ChangedSettingsManagement, Message.Navigated],
});
