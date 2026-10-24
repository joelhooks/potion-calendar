import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";

import {
  attachmentButton,
  attachmentMeeting,
  mountAttachmentPrompt,
} from "./prompt-attachment-fixture.js";

it.effect.prop(
  "renders two saved links with full accessible titles and per-card inline overflow",
  {
    count: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: 0 }))
    ),
  },
  ({ count }) =>
    Effect.gen(function* attachmentOverflow() {
      const attachments = Array.from({ length: count }, (_, index) => ({
        title: `Attachment ${index} with a long saved title that must not be shortened in its accessible name`,
        url: `https://files.example.test/${index}`,
      }));

      const events = [
        { ...attachmentMeeting, attachments },
        {
          ...attachmentMeeting,
          attachments,
          key: { ...attachmentMeeting.key, eventId: "other" },
        },
      ];

      const { calls, present } = yield* mountAttachmentPrompt(events);
      const first = document.querySelector("[data-prompt-card]");
      expect(first?.querySelectorAll("[data-prompt-attachment]")).toHaveLength(
        Math.min(2, count)
      );
      expect(
        document.querySelectorAll("[data-prompt-attachments-more]")
      ).toHaveLength(count > 2 ? 2 : 0);

      if (count > 2) {
        const more = attachmentButton("[data-prompt-attachments-more]");
        expect(more.textContent).toBe(`+${count - 2} more`);
        more.click();
        expect(
          first?.querySelectorAll("[data-prompt-attachment]")
        ).toHaveLength(count);
        expect(
          first?.querySelector<HTMLElement>("[data-prompt-attachments]")
            ?.dataset.expanded
        ).toBe("true");
        expect(
          document.querySelectorAll("[data-prompt-attachments-more]")
        ).toHaveLength(1);
        expect(calls).toEqual([]);
      }

      if (count > 0) {
        const control = attachmentButton('[data-prompt-attachment="0"]');
        expect(control.getAttribute("aria-label")).toBe(
          `Open attachment ${attachments[0]?.title}`
        );
        control.click();
        expect(calls).toEqual([
          {
            action: "attachment",
            index: 0,
            key: attachmentMeeting.key,
            url: attachments[0]?.url,
          },
        ]);
        expect(document.querySelectorAll("[data-prompt-card]")).toHaveLength(2);
      }

      present({ events, revision: 2 });
      expect(
        document.querySelectorAll(
          '[data-prompt-attachments][data-expanded="true"]'
        )
      ).toHaveLength(0);
      expect(
        document
          .querySelector("[data-prompt-card]")
          ?.querySelectorAll("[data-prompt-attachment]")
      ).toHaveLength(Math.min(2, count));
    }).pipe(Effect.scoped)
);
