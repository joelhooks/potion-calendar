import type {
  AgendaEventValue,
  PromptAction,
  PromptBridge,
  PromptView,
} from "@calendar/core/desktop-bridge";
import { expect } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import "../src/client/globals.js";

export const attachmentMeeting: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: 3_600_000,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "card" },
  responseStatus: "accepted",
  start: 120_000,
  title: "Meeting with attachments",
};

export const attachmentButton = (selector: string): HTMLButtonElement => {
  const found = document.querySelector<HTMLButtonElement>(selector);
  expect(found).not.toBeNull();

  if (found === null) {
    throw new Error("Expected attachment control is absent");
  }

  return found;
};

export const mountAttachmentPrompt = Effect.fn("FakeAttachmentPrompt.mount")(
  function* mountAttachmentPrompt(
    events: readonly AgendaEventValue[],
    reportSize?: PromptBridge["reportSize"]
  ) {
    const calls: (typeof PromptAction.Type)[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(window, "potionPrompt");
    let receive: ((view: typeof PromptView.Type) => void) | undefined;

    const bridge: PromptBridge = {
      act: (action) => {
        calls.push(action);
      },
      // @effect-diagnostics-next-line asyncFunction:off -- The owned fixture implements the isolated preload's one native Promise read.
      getView: async () => await Promise.resolve({ events, revision: 1 }),
      onView: (next) => {
        receive = next;

        return () => {
          receive = undefined;
        };
      },
    };

    if (reportSize !== undefined) {
      Object.defineProperty(bridge, "reportSize", { value: reportSize });
    }

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        document.body.innerHTML = "<main></main>";
        Object.defineProperty(window, "potionPrompt", {
          configurable: true,
          value: bridge,
        });
        vi.resetModules();
      }),
      () =>
        Effect.sync(() => {
          window.dispatchEvent(new Event("pagehide"));

          if (descriptor === undefined) {
            Reflect.deleteProperty(window, "potionPrompt");
          } else {
            Object.defineProperty(window, "potionPrompt", descriptor);
          }

          document.body.replaceChildren();
        })
    );
    // @effect-diagnostics-next-line asyncFunction:off -- Importing the actual renderer uses the native module loader, not a module mock.
    yield* Effect.promise(async () => await import("../src/client/prompt.js"));
    // @effect-diagnostics-next-line asyncFunction:off -- The preload Promise must settle before reading the actual rendered controls.
    yield* Effect.promise(async () => {
      await Promise.resolve();
    });

    return {
      calls,
      present: (view: typeof PromptView.Type) => {
        receive?.(view);
      },
    };
  }
);
