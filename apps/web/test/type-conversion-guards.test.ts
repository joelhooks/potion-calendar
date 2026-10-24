import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";

import { autoTypeConversion } from "../src/client/editing/type-conversion.js";
import { conversionActor } from "./type-conversion-fixture.js";

it.effect.prop(
  "filled fields are never discarded and unsupported calendars/all-day/saved drafts produce no conversion",
  {
    field: Arbitrary.schema(
      Schema.Literals([
        "location",
        "description",
        "participant",
        "pending-email",
        "attachment",
        "conferencing",
        "non-primary",
        "all-day",
        "saved",
        "invitation-choice",
      ])
    ),
    title: Arbitrary.schema(Schema.Literals(["Focus", "OOO"])),
  },
  ({ field, title }) =>
    Effect.gen(function* lossGuard() {
      const actor = yield* conversionActor();
      const original = actor.getSnapshot().context.session;
      expect(original).toBeDefined();

      if (original === undefined) {
        return;
      }

      let session = { ...original, draft: { ...original.draft, title } };

      switch (field) {
        case "location": {
          session = { ...session, draft: { ...session.draft, location: "  " } };
          break;
        }

        case "description": {
          session = {
            ...session,
            draft: { ...session.draft, description: "Unsent description" },
          };
          break;
        }

        case "participant": {
          session = {
            ...session,
            draft: {
              ...session.draft,
              attendees: [{ email: "guest@example.test" }],
            },
          };
          break;
        }

        case "pending-email": {
          session = {
            ...session,
            draft: { ...session.draft, participantEmail: "guest@example.test" },
          };
          break;
        }

        case "attachment": {
          session = {
            ...session,
            draft: {
              ...session.draft,
              attachments: [
                {
                  title: "Saved attachment",
                  url: "https://files.example.test/private",
                },
              ],
            },
          };
          break;
        }

        case "conferencing": {
          session = {
            ...session,
            draft: {
              ...session.draft,
              conferencing: {
                participantSeen: false,
                request: { kind: "googleMeet" },
              },
            },
          };
          break;
        }

        case "non-primary": {
          session = {
            ...session,
            draft: { ...session.draft, calendarId: "team" },
          };
          break;
        }

        case "all-day": {
          session = { ...session, draft: { ...session.draft, allDay: true } };
          break;
        }

        case "saved": {
          session = { ...session, kind: "edit" };
          break;
        }

        case "invitation-choice": {
          session = {
            ...session,
            draft: { ...session.draft, statusInvitationChoice: "declineNone" },
          };
          break;
        }

        default: {
          throw new Error("Unrepresented loss guard");
        }
      }

      const frozen = JSON.stringify(session);
      expect(Option.isNone(yield* autoTypeConversion(session))).toBe(true);
      expect(JSON.stringify(session)).toBe(frozen);
    }).pipe(Effect.provide(NodeServices.layer))
);
