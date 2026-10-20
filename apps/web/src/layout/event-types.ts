import type {
  Calendar,
  CalendarEvent,
  EventFields,
} from "@calendar/calendar/contracts";
import { CalendarRef } from "@calendar/calendar/contracts";
import { Schema } from "effect";

export const EditableEventType = Schema.Literals([
  "default",
  "focusTime",
  "outOfOffice",
]);

export const ProviderTypeDecision = Schema.TaggedUnion({
  Available: { source: Schema.NonEmptyString },
  Unknown: { reason: Schema.NonEmptyString },
  Unsupported: { reason: Schema.NonEmptyString, source: Schema.NonEmptyString },
});

export const GoogleTypeEvidence = Schema.Struct({
  ...CalendarRef.fields,
  create: ProviderTypeDecision,
  focusTime: ProviderTypeDecision,
  outOfOffice: ProviderTypeDecision,
  update: ProviderTypeDecision,
});

export const TypeAvailability = Schema.TaggedUnion({
  Available: {},
  Unknown: { reasons: Schema.NonEmptyArray(Schema.NonEmptyString) },
  Unsupported: { reasons: Schema.NonEmptyArray(Schema.NonEmptyString) },
});

const unavailable = (reason: string): typeof TypeAvailability.Type =>
  TypeAvailability.cases.Unsupported.make({ reasons: [reason] });

const unknown = (reason: string): typeof TypeAvailability.Type =>
  TypeAvailability.cases.Unknown.make({ reasons: [reason] });

const available = (): typeof TypeAvailability.Type =>
  TypeAvailability.cases.Available.make({});

const providerDecision = (
  decision: typeof ProviderTypeDecision.Type
): typeof TypeAvailability.Type => {
  if (ProviderTypeDecision.guards.Available(decision)) {
    return available();
  }

  return ProviderTypeDecision.guards.Unknown(decision)
    ? unknown(decision.reason)
    : unavailable(decision.reason);
};

const combine = (
  decisions: readonly (typeof TypeAvailability.Type)[]
): typeof TypeAvailability.Type => {
  const refused = decisions.flatMap((decision) =>
    TypeAvailability.guards.Unsupported(decision) ? decision.reasons : []
  );

  const missing = decisions.flatMap((decision) =>
    TypeAvailability.guards.Unknown(decision) ? decision.reasons : []
  );

  const [firstRefused, ...otherRefused] = refused;
  const [firstMissing, ...otherMissing] = missing;

  if (firstRefused !== undefined) {
    return TypeAvailability.cases.Unsupported.make({
      reasons: [firstRefused, ...otherRefused],
    });
  }

  if (firstMissing !== undefined) {
    return TypeAvailability.cases.Unknown.make({
      reasons: [firstMissing, ...otherMissing],
    });
  }

  return available();
};

const statusRequirements = (
  fields: typeof EventFields.Type
): typeof TypeAvailability.Type => {
  const constraints: (typeof TypeAvailability.Type)[] = [];

  for (const endpoint of [fields.start, fields.end]) {
    if (endpoint === undefined) {
      constraints.push(
        unknown("A status event requires both timed endpoints.")
      );
    } else if ("date" in endpoint) {
      constraints.push(
        unavailable("Google Focus and Out of office events cannot be all-day.")
      );
    }
  }

  if (fields.transparency === undefined) {
    constraints.push(unknown("Opaque transparency has not been established."));
  } else if (fields.transparency !== "opaque") {
    constraints.push(
      unavailable("Google status events require opaque transparency.")
    );
  }

  return combine(constraints);
};

export const EventTypeChoice = Schema.Struct({
  provider: TypeAvailability,
  request: TypeAvailability,
  target: EditableEventType,
});

export const eventTypeAvailability = (input: {
  readonly calendar: typeof Calendar.Type;
  readonly evidence: typeof GoogleTypeEvidence.Type | undefined;
  readonly fields: typeof EventFields.Type;
  readonly operation: "create" | "update";
  readonly target: typeof EditableEventType.Type;
}) => {
  const { calendar, evidence, fields, operation, target } = input;
  const current = fields.eventType ?? "default";
  const crossType = operation === "update" && current !== target;

  const scoped =
    evidence !== undefined &&
    evidence.accountId === calendar.accountId &&
    evidence.calendarId === calendar.calendarId;

  const permission = scoped
    ? providerDecision(evidence[operation])
    : unknown("No provider permission evidence for this account and calendar.");

  const readOnly =
    calendar.accessRole === "reader" ||
    calendar.accessRole === "freeBusyReader";

  const checks = [
    permission,
    readOnly
      ? unavailable("This calendar only permits read access.")
      : available(),
  ];

  if (crossType) {
    checks.push(
      unavailable("Google eventType cannot be modified after creation.")
    );
  }

  if (target !== "default") {
    checks.push(
      calendar.primary
        ? available()
        : unavailable(
            "Google status events are only available on primary calendars."
          ),
      scoped
        ? providerDecision(evidence[target])
        : unknown(
            "Status eligibility is unknown for this account and calendar."
          ),
      statusRequirements(fields)
    );
  }

  const request =
    target === "default" && !crossType
      ? available()
      : unavailable(
          crossType
            ? "No supported request changes or reverses Google eventType."
            : `The application request does not represent required ${target}Properties.`
        );

  return EventTypeChoice.make({ provider: combine(checks), request, target });
};

export const createEventTypeChoices = (input: {
  readonly calendar: typeof Calendar.Type;
  readonly evidence: typeof GoogleTypeEvidence.Type | undefined;
  readonly fields: typeof EventFields.Type;
}) =>
  EditableEventType.literals.map((target) =>
    eventTypeAvailability({ ...input, operation: "create", target })
  );

export const ConversionField = Schema.Literals([
  "conferencing",
  "participants",
  "attachments",
  "location",
  "description",
]);

export const AttachmentPresence = Schema.Literals([
  "absent",
  "present",
  "unknown",
]);

export const ConversionUndo = Schema.TaggedStruct("Unavailable", {
  reason: Schema.NonEmptyString,
});

export const TypeFieldLoss = Schema.Struct({
  changed: Schema.Boolean,
  confirmation: Schema.Literals(["fieldLoss", "none", "unknown"]),
  constraints: TypeAvailability,
  conversion: TypeAvailability,
  lost: Schema.Array(
    Schema.Struct({
      field: ConversionField,
      paths: Schema.NonEmptyArray(Schema.NonEmptyString),
    })
  ),
  undo: ConversionUndo,
  unknownFields: Schema.Array(Schema.NonEmptyString),
});

const outOfOfficeLoss = (
  event: typeof CalendarEvent.Type,
  attachments: typeof AttachmentPresence.Type
) => {
  const lost: (typeof TypeFieldLoss.Type)["lost"][number][] = [];
  const unknownFields: string[] = [];
  {
    const conference = [
      "conference",
      "conferenceUrl",
      "conferencingStatus",
    ] as const;

    const populatedConference = conference.filter(
      (field) => event[field] !== undefined
    );

    const [first, ...remaining] = populatedConference;

    if (first !== undefined) {
      lost.push({ field: "conferencing", paths: [first, ...remaining] });
    }

    if ((event.attendees?.length ?? 0) > 0) {
      lost.push({ field: "participants", paths: ["attendees"] });
    }

    if (event.attendeesOmitted === true) {
      unknownFields.push("omitted participants");
    }

    if (attachments === "present") {
      lost.push({ field: "attachments", paths: ["attachments"] });
    } else if (attachments === "unknown") {
      unknownFields.push("attachments");
    }

    for (const field of ["location", "description"] as const) {
      if ((event[field]?.length ?? 0) > 0) {
        lost.push({ field, paths: [field] });
      }
    }
  }

  return { lost, unknownFields };
};

export const assessTypeFieldLoss = (input: {
  readonly attachments: typeof AttachmentPresence.Type;
  readonly event: typeof CalendarEvent.Type;
  readonly target: typeof EditableEventType.Type;
}) => {
  const { attachments, event, target } = input;
  const current = event.eventType ?? "default";
  const changed = current !== target;

  const { lost, unknownFields } =
    changed && target === "outOfOffice"
      ? outOfOfficeLoss(event, attachments)
      : { lost: [], unknownFields: [] };

  if (changed && target === "focusTime") {
    unknownFields.push(...ConversionField.literals);
  }

  if (changed && target === "default" && current !== "default") {
    unknownFields.push(`${current} type-specific properties`);
  }

  let confirmation: (typeof TypeFieldLoss.Type)["confirmation"] = "none";

  if (lost.length > 0) {
    confirmation = "fieldLoss";
  } else if (unknownFields.length > 0) {
    confirmation = "unknown";
  }

  return TypeFieldLoss.make({
    changed,
    confirmation,
    constraints:
      changed && target !== "default" ? statusRequirements(event) : available(),
    conversion: changed
      ? unavailable("Google eventType cannot be modified after creation.")
      : available(),
    lost,
    undo: ConversionUndo.make({
      reason:
        "No existing request expresses a supported inverse Google type conversion.",
    }),
    unknownFields,
  });
};
