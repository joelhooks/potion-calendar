import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import type { ConferencingRequestValue } from "../src/conferencing-model.js";
import { automaticConferencingRequest } from "../src/conferencing-rule.js";
import type { Attendee } from "../src/model.js";

const Participant = Schema.Literals([
  "human",
  "resource",
  "selfFlag",
  "selfEmail",
]);

const participants: Record<typeof Participant.Type, typeof Attendee.Type> = {
  human: { email: "guest@example.test" },
  resource: { email: "room@example.test", resource: true },
  selfEmail: { email: " OWNER@EXAMPLE.TEST " },
  selfFlag: { email: "alias@example.test", self: true },
};

it.effect.prop(
  "only a new event's first human guest can apply an explicit Meet default, and unset never writes",
  {
    initiallySeen: Schema.Boolean,
    isNew: Schema.Boolean,
    setting: Schema.Literals(["unset", "none", "googleMeet", "unresolved"]),
    steps: Schema.Array(
      Schema.Struct({
        attendees: Schema.Array(Participant).check(Schema.isMaxLength(6)),
        hasConferencing: Schema.Boolean,
        remove: Schema.Boolean,
      })
    ).check(Schema.isMinLength(1), Schema.isMaxLength(15)),
  },
  ({ isNew, initiallySeen, setting, steps }) =>
    Effect.sync(() => {
      const firstHuman = steps.findIndex((step) =>
        step.attendees.includes("human")
      );

      let participantSeen = initiallySeen;
      let request: ConferencingRequestValue | undefined;
      let automaticAdds = 0;

      for (const [index, step] of steps.entries()) {
        if (step.remove) {
          request = { kind: "none" };
        }

        const previous = request;

        const result = automaticConferencingRequest({
          attendees: step.attendees.map((kind) => participants[kind]),
          hasConferencing: step.hasConferencing,
          isNew,
          participantSeen,
          request,
          selfEmail: "owner@example.test",
          setting: setting === "unresolved" ? undefined : setting,
        });

        const expectedAdd =
          index === firstHuman &&
          !initiallySeen &&
          isNew &&
          setting === "googleMeet" &&
          !step.hasConferencing &&
          previous === undefined;

        if (expectedAdd) {
          expect(result.request).toEqual({ kind: "googleMeet" });
          automaticAdds += 1;
        } else {
          expect(result.request).toEqual(previous);
        }

        expect(result.participantSeen).toBe(
          initiallySeen || (firstHuman !== -1 && index >= firstHuman)
        );
        ({ participantSeen, request } = result);
      }

      expect(automaticAdds).toBeLessThanOrEqual(1);
    })
);

it.effect.prop(
  "inviting any human guests to an existing event never applies its account default",
  {
    count: Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 1 })),
  },
  ({ count }) =>
    Effect.sync(() => {
      const result = automaticConferencingRequest({
        attendees: Array.from({ length: count }, (_, index) => ({
          email: `guest-${index}@example.test`,
        })),
        hasConferencing: false,
        isNew: false,
        participantSeen: false,
        request: undefined,
        selfEmail: "owner@example.test",
        setting: "googleMeet",
      });

      expect(result.request).toBeUndefined();
      expect(result.participantSeen).toBe(true);
    })
);
