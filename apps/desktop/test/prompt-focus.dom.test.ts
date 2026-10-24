import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { vi } from "vitest";

import {
  attachmentButton,
  attachmentMeeting,
  mountAttachmentPrompt,
} from "./prompt-attachment-fixture.js";

it.effect.prop(
  "render and re-presentation never move focus and preserve the first card's sequential controls",
  {
    attachments: Arbitrary.schema(Schema.Boolean),
    presentations: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 4, minimum: 1 }))
    ),
  },
  ({ attachments, presentations }) =>
    Effect.gen(function* promptFocusOwnership() {
      const focus = yield* Effect.acquireRelease(
        Effect.sync(() => vi.spyOn(HTMLElement.prototype, "focus")),
        (spy) =>
          Effect.sync(() => {
            spy.mockRestore();
          })
      );

      const events = [
        {
          ...attachmentMeeting,
          attachments: attachments
            ? [{ title: "Agenda", url: "https://files.example.test/agenda" }]
            : [],
        },
        {
          ...attachmentMeeting,
          key: { ...attachmentMeeting.key, eventId: "second" },
        },
      ];

      const { calls, present } = yield* mountAttachmentPrompt(events);

      for (let revision = 1; revision <= presentations; revision += 1) {
        if (revision > 1) {
          focus.mockClear();
          present({ events, revision });
        }

        expect(focus).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(document.body);
        const first = document.querySelector("[data-prompt-card]");

        const controls = [
          ...(first?.querySelectorAll<HTMLElement>("[tabindex],button") ?? []),
        ].filter(
          (control) =>
            control.tabIndex >= 0 &&
            !control.hasAttribute("disabled") &&
            control.closest("[hidden]") === null
        );

        const body = first?.querySelector("[data-prompt-body]");
        expect(controls).toEqual([
          body,
          ...(attachments
            ? [attachmentButton('[data-prompt-attachment="0"]')]
            : []),
          attachmentButton("[data-prompt-join]"),
          attachmentButton("[data-prompt-menu]"),
          attachmentButton("[data-prompt-dismiss]"),
        ]);
        expect(controls[0]?.getAttribute("role")).toBe("button");
        controls[0]?.focus();
        expect(document.activeElement).toBe(body);
        expect(first?.contains(document.activeElement)).toBe(true);
        expect(calls).toEqual([]);
      }
    }).pipe(Effect.scoped)
);
