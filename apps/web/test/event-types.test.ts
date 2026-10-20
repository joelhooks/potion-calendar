import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { expect } from "vitest";

import {
  assessTypeFieldLoss,
  createEventTypeChoices,
  eventTypeAvailability,
  ProviderTypeDecision,
  TypeAvailability,
} from "../src/layout/event-types.js";
import { editorOriginal } from "./editor-fixture.js";

const calendar = {
  accessRole: "owner",
  accountId: editorOriginal.accountId,
  calendarId: editorOriginal.calendarId,
  primary: true,
  timeZone: "America/Los_Angeles",
  title: "Calendar",
} as const;

const allowed = ProviderTypeDecision.cases.Available.make({
  source: "provider-fixture:explicit-scoped-observation",
});

const evidence = {
  accountId: calendar.accountId,
  calendarId: calendar.calendarId,
  create: allowed,
  focusTime: allowed,
  outOfOffice: allowed,
  update: allowed,
};

const fields = { ...editorOriginal, transparency: "opaque" } as const;

it.effect.prop(
  "status creation requires primary, timed, opaque and explicit matching evidence; request support stays separately unavailable",
  {
    allDay: Schema.Boolean,
    eligibility: Schema.Literals(["Available", "Unknown", "Unsupported"]),
    permission: Schema.Literals(["Available", "Unknown", "Unsupported"]),
    primary: Schema.Boolean,
    target: Schema.Literals(["focusTime", "outOfOffice"]),
    transparent: Schema.Boolean,
  },
  ({ allDay, eligibility, permission, primary, target, transparent }) =>
    Effect.sync(() => {
      const decision = (tag: typeof eligibility) => {
        if (tag === "Available") {
          return allowed;
        }

        return tag === "Unknown"
          ? ProviderTypeDecision.cases.Unknown.make({
              reason: "Provider has not established eligibility.",
            })
          : ProviderTypeDecision.cases.Unsupported.make({
              reason: "Provider refuses this operation.",
              source: "provider-fixture:refusal",
            });
      };

      const result = eventTypeAvailability({
        calendar: { ...calendar, primary },
        evidence: {
          ...evidence,
          create: decision(permission),
          [target]: decision(eligibility),
        },
        fields: {
          ...fields,
          end: allDay ? { date: "2026-10-20" } : fields.end,
          start: allDay ? { date: "2026-10-19" } : fields.start,
          transparency: transparent ? "transparent" : "opaque",
        },
        operation: "create",
        target,
      });

      const refused =
        !primary ||
        allDay ||
        transparent ||
        eligibility === "Unsupported" ||
        permission === "Unsupported";

      const missing = eligibility === "Unknown" || permission === "Unknown";

      if (refused) {
        expect(result.provider._tag).toBe("Unsupported");
      } else if (missing) {
        expect(result.provider._tag).toBe("Unknown");
      } else {
        expect(result.provider._tag).toBe("Available");
      }

      expect(result.request._tag).toBe("Unsupported");
    })
);

it.effect.prop(
  "same-type update is distinct from impossible cross-type conversion for every supported pair",
  {
    current: Schema.Literals(["default", "focusTime", "outOfOffice"]),
    target: Schema.Literals(["default", "focusTime", "outOfOffice"]),
  },
  ({ current, target }) =>
    Effect.sync(() => {
      const result = eventTypeAvailability({
        calendar,
        evidence,
        fields: { ...fields, eventType: current },
        operation: "update",
        target,
      });

      expect(result.provider._tag).toBe(
        current === target ? "Available" : "Unsupported"
      );
      expect(result.request._tag).toBe(
        current === "default" && target === "default"
          ? "Available"
          : "Unsupported"
      );
    })
);

it.effect.prop(
  "provider evidence never transfers across account or calendar boundaries and role never invents eligibility",
  {
    mismatch: Schema.Literals(["account", "calendar", "absent"]),
    role: Schema.Literals(["owner", "writer", "reader", "freeBusyReader"]),
  },
  ({ mismatch, role }) =>
    Effect.sync(() => {
      const supplied =
        mismatch === "absent"
          ? undefined
          : {
              ...evidence,
              accountId:
                mismatch === "account"
                  ? `${calendar.accountId}-other`
                  : calendar.accountId,
              calendarId:
                mismatch === "calendar"
                  ? `${calendar.calendarId}-other`
                  : calendar.calendarId,
            };

      const choices = createEventTypeChoices({
        calendar: { ...calendar, accessRole: role },
        evidence: supplied,
        fields,
      });

      expect(choices.map(({ target }) => target)).toEqual([
        "default",
        "focusTime",
        "outOfOffice",
      ]);
      const readOnly = role === "reader" || role === "freeBusyReader";

      expect(
        choices.every(({ provider }) =>
          readOnly
            ? TypeAvailability.guards.Unsupported(provider)
            : TypeAvailability.guards.Unknown(provider)
        )
      ).toBe(true);
    })
);

it.effect.prop(
  "read-only calendars refuse every write even with contradictory positive evidence",
  {
    operation: Schema.Literals(["create", "update"]),
    role: Schema.Literals(["reader", "freeBusyReader"]),
    target: Schema.Literals(["default", "focusTime", "outOfOffice"]),
  },
  ({ operation, role, target }) =>
    Effect.sync(() => {
      const result = eventTypeAvailability({
        calendar: { ...calendar, accessRole: role },
        evidence,
        fields: { ...fields, eventType: target },
        operation,
        target,
      });

      expect(result.provider).toEqual(
        TypeAvailability.cases.Unsupported.make({
          reasons: ["This calendar only permits read access."],
        })
      );
    })
);

it.effect.prop(
  "OOO loss assessment names only the populated E6 groups and never mutates source or promises an inverse",
  {
    attachments: Schema.Literals(["absent", "present", "unknown"]),
    conference: Schema.Boolean,
    description: Schema.Boolean,
    location: Schema.Boolean,
    participants: Schema.Boolean,
  },
  ({ attachments, conference, description, location, participants }) =>
    Effect.sync(() => {
      const event = {
        ...editorOriginal,
        attendees: participants ? [{ email: "guest@example.test" }] : [],
        conference: undefined,
        conferenceUrl: conference
          ? "https://meet.example.test/selected"
          : undefined,
        conferencingStatus: undefined,
        description: description ? "An agenda" : "",
        location: location ? "A room" : "",
      };

      const original = structuredClone(event);

      const plan = assessTypeFieldLoss({
        attachments,
        event,
        target: "outOfOffice",
      });

      const expected: string[] = [];

      if (conference) {
        expected.push("conferencing");
      }

      if (participants) {
        expected.push("participants");
      }

      if (attachments === "present") {
        expected.push("attachments");
      }

      if (location) {
        expected.push("location");
      }

      if (description) {
        expected.push("description");
      }

      expect(plan.lost.map(({ field }) => field)).toEqual(expected);
      expect(plan.unknownFields).toEqual(
        attachments === "unknown" ? ["attachments"] : []
      );
      let confirmation = attachments === "unknown" ? "unknown" : "none";

      if (expected.length > 0) {
        confirmation = "fieldLoss";
      }

      expect(plan.confirmation).toBe(confirmation);
      expect(plan.conversion._tag).toBe("Unsupported");
      expect(plan.undo._tag).toBe("Unavailable");
      expect(event).toEqual(original);
    })
);

it.effect(
  "Focus compatibility is unknown, omitted guests remain unknown, and unchanged types have no hypothetical field loss",
  () =>
    Effect.sync(() => {
      const focus = assessTypeFieldLoss({
        attachments: "present",
        event: { ...editorOriginal, transparency: "transparent" },
        target: "focusTime",
      });

      expect(focus.lost).toEqual([]);
      expect(focus.unknownFields).toEqual([
        "conferencing",
        "participants",
        "attachments",
        "location",
        "description",
      ]);
      expect(focus.constraints).toEqual(
        TypeAvailability.cases.Unsupported.make({
          reasons: ["Google status events require opaque transparency."],
        })
      );

      const omitted = assessTypeFieldLoss({
        attachments: "unknown",
        event: { ...fields, attendees: [], attendeesOmitted: true },
        target: "outOfOffice",
      });

      expect(omitted.unknownFields).toEqual([
        "omitted participants",
        "attachments",
      ]);

      const unchanged = assessTypeFieldLoss({
        attachments: "present",
        event: {
          ...fields,
          description: "Retain without a conversion.",
          eventType: "outOfOffice",
        },
        target: "outOfOffice",
      });

      expect(unchanged.changed).toBe(false);
      expect(unchanged.lost).toEqual([]);
      expect(unchanged.unknownFields).toEqual([]);
      expect(unchanged.constraints).toEqual(
        TypeAvailability.cases.Available.make({})
      );
    })
);

it.effect.prop(
  "all conference representations are named exactly once without inventing provider restrictions for Focus",
  { details: Schema.Boolean, status: Schema.Boolean, url: Schema.Boolean },
  ({ url, details, status }) =>
    Effect.sync(() => {
      const event = {
        ...fields,
        conference: details ? { kind: "unrepresentable" as const } : undefined,
        conferenceUrl: url ? "https://meet.example.test/example" : undefined,
        conferencingStatus: status ? ("pending" as const) : undefined,
      };

      const loss = assessTypeFieldLoss({
        attachments: "absent",
        event,
        target: "outOfOffice",
      });

      const paths: string[] = [];

      if (details) {
        paths.push("conference");
      }

      if (url) {
        paths.push("conferenceUrl");
      }

      if (status) {
        paths.push("conferencingStatus");
      }

      expect(loss.lost.filter(({ field }) => field === "conferencing")).toEqual(
        paths.length > 0 ? [{ field: "conferencing", paths }] : []
      );
    })
);

it.effect(
  "missing endpoints, eligibility and transparency stay unknown instead of inventing a timed opaque event",
  () =>
    Effect.sync(() => {
      for (const target of ["focusTime", "outOfOffice"] as const) {
        const availability = eventTypeAvailability({
          calendar,
          evidence,
          fields: {},
          operation: "create",
          target,
        });

        expect(availability.provider._tag).toBe("Unknown");
        expect(availability.request._tag).toBe("Unsupported");
      }
    })
);
