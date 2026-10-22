import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { creatorPresentation } from "../src/layout/event-creator.js";
import {
  creatorEvent,
  creatorFixture,
  creatorModel,
} from "./creator-fixture.js";

const details = Effect.fn("creator.details")(function* renderCreatorDetails(
  model: ReturnType<typeof creatorModel>
) {
  const rendered = yield* renderToString(
    {
      init: () => ({ model }),
      view,
    },
    { isHydratable: false }
  );

  const root = document.createElement("div");
  root.innerHTML = rendered.html;

  return root;
});

it.effect.prop(
  "same creator/organizer retains only Organizer despite email case and whitespace",
  { padded: Schema.Boolean, uppercase: Schema.Boolean },
  ({ padded, uppercase }) =>
    Effect.gen(function* sameCreatorIdentity() {
      const email = uppercase ? "ALEX@EXAMPLE.TEST" : "Alex@example.test";

      const root = yield* details(
        creatorModel({
          ...creatorEvent(),
          creator: {
            displayName: "Not an identity",
            email: padded ? ` ${email} ` : email,
          },
        })
      );

      expect(root.textContent).toContain("Alex Rivera · Organizer");
      expect(root.textContent).not.toContain("Creator");
      expect(root.textContent).not.toContain("Created by");
    })
);

it.effect(
  "a distinct creator attendee gains Creator while You, Optional and response stay intact",
  () =>
    Effect.gen(function* attendeeCreatorIdentity() {
      const root = yield* details(creatorFixture("attendee"));

      const row = [...root.querySelectorAll("li")].find((item) =>
        item.textContent?.includes("Blair Chen")
      );

      expect(row?.textContent).toBe(
        "Blair Chen · You · Creator · Optionaltentative"
      );
      expect(root.textContent).toContain("Alex Rivera · Organizer");
      expect(root.textContent).not.toContain("Created by");
      expect(root.textContent?.match(/ · Creator/gu)).toHaveLength(1);
    })
);

it.effect(
  "a distinct non-attendee creator gets one muted byline below the list with unchanged provider spelling",
  () =>
    Effect.gen(function* nonAttendeeCreatorIdentity() {
      for (const creator of [
        { displayName: "  Drew Morgan  ", email: "Drew@Example.test" },
        { displayName: "  ", email: " Drew@Example.test " },
        { email: "Drew@Example.test" },
      ]) {
        const root = yield* details(
          creatorModel({ ...creatorEvent(), creator })
        );

        const list = root.querySelector("ul");
        const byline = list?.nextElementSibling;
        expect(byline?.classList.contains("muted")).toBe(true);
        expect(byline?.textContent).toBe(
          `Created by ${(creator.displayName?.trim().length ?? 0) > 0 ? creator.displayName : creator.email}`
        );
        expect(root.textContent?.match(/Created by/gu)).toHaveLength(1);
        expect(list?.textContent).not.toContain("Creator");
      }
    })
);

it.effect(
  "missing or unknown creator/organizer identity adds neither a role nor a byline",
  () =>
    Effect.gen(function* missingCreatorIdentity() {
      const base = creatorEvent();

      const events = [
        base,
        { ...base, creator: {} },
        { ...base, creator: { displayName: "Blair Chen", self: true } },
        { ...base, creator: { email: "  " } },
        { ...base, creator: { email: "blair@example.test" }, organizer: {} },
        {
          ...base,
          creator: { email: "blair@example.test" },
          organizer: { email: " " },
        },
      ];

      for (const event of events) {
        const root = yield* details(creatorModel(event));
        expect(root.textContent).not.toContain("Creator");
        expect(root.textContent).not.toContain("Created by");
        expect(root.textContent).toContain("Blair Chen · You · Optional");
        expect(creatorPresentation(event)).toEqual({
          attendee: undefined,
          byline: undefined,
        });
      }
    })
);
