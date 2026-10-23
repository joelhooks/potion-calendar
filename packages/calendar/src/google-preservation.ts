import { Option, Schema } from "effect";

import { Attendee } from "./model.js";

export const GooglePreservation = Schema.Struct({
  attendees: Schema.optional(
    Schema.Array(Schema.Record(Schema.String, Schema.Json))
  ),
  extendedProperties: Schema.optional(Schema.Json),
  gadget: Schema.optional(Schema.Json),
  source: Schema.optional(Schema.Json),
});

export const mergeRetainedAttendees = (
  attendees: readonly (typeof Attendee.Type)[],
  source: (typeof GooglePreservation.Type)["attendees"]
) => {
  if (source === undefined) {
    return attendees;
  }

  return attendees.map((attendee) => {
    const email = attendee.email.trim().toLowerCase();

    if (email.length === 0) {
      return attendee;
    }

    const matches = source.filter((candidate) =>
      Option.exists(
        Schema.decodeUnknownOption(Schema.String)(candidate.email),
        (value) => value.trim().toLowerCase() === email
      )
    );

    const [retained, ...ambiguous] = matches;

    if (retained === undefined || ambiguous.length > 0) {
      return attendee;
    }

    return {
      ...Object.fromEntries(
        Object.entries(retained).filter(
          ([field]) => !Object.hasOwn(Attendee.fields, field)
        )
      ),
      ...attendee,
    };
  });
};

export const followingMetadata = (
  source: typeof GooglePreservation.Type | undefined
) => ({
  extendedProperties: source?.extendedProperties,
  gadget: source?.gadget,
  source: source?.source,
});
