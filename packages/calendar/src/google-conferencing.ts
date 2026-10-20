import { Crypto, Effect, Option, Schema } from "effect";

import type { ConferencingWriteRequestValue } from "./conferencing-model.js";
import type { CalendarEventValue } from "./model.js";
import { ConferenceEntryPoint, OwnedConference } from "./owned-conference.js";
import type {
  OwnedConferenceValue,
  ConferenceDetailsValue,
} from "./owned-conference.js";
import { Provider } from "./provider.js";

const GoogleEntryPoint = Schema.Struct({
  accessCode: ConferenceEntryPoint.fields.accessCode,
  entryPointType: Schema.String,
  label: ConferenceEntryPoint.fields.label,
  meetingCode: ConferenceEntryPoint.fields.meetingCode,
  passcode: ConferenceEntryPoint.fields.passcode,
  password: ConferenceEntryPoint.fields.password,
  pin: ConferenceEntryPoint.fields.pin,
  uri: Schema.String,
});

export const GoogleConferenceData = Schema.Struct({
  conferenceId: Schema.optional(Schema.String),
  conferenceSolution: Schema.optional(
    Schema.Struct({
      iconUri: Schema.optional(Schema.String),
      key: Schema.optional(
        Schema.Struct({ type: Schema.optional(Schema.String) })
      ),
      name: Schema.optional(Schema.String),
    })
  ),
  createRequest: Schema.optional(
    Schema.Struct({
      status: Schema.optional(
        Schema.Struct({
          statusCode: Schema.Literals(["pending", "success", "failure"]),
        })
      ),
    })
  ),
  entryPoints: Schema.optional(Schema.Array(GoogleEntryPoint)),
  notes: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
});

const solutionTypes = new Map<string, OwnedConferenceValue["kind"]>([
  ["hangoutsMeet", "googleMeet"],
  ["eventHangout", "legacyHangout"],
  ["eventNamedHangout", "legacyNamedHangout"],
  ["addOn", "thirdParty"],
]);

const googleSolutionTypes: Record<OwnedConferenceValue["kind"], string> = {
  googleMeet: "hangoutsMeet",
  legacyHangout: "eventHangout",
  legacyNamedHangout: "eventNamedHangout",
  thirdParty: "addOn",
};

const ownedConference = (
  data: typeof GoogleConferenceData.Type | null | undefined,
  hangoutLink: string | undefined
): ConferenceDetailsValue | undefined => {
  if (data === null || data === undefined) {
    return hangoutLink === undefined ? undefined : { kind: "unrepresentable" };
  }

  const decoded = Schema.decodeUnknownOption(OwnedConference)({
    entryPoints: data.entryPoints?.map(({ entryPointType, ...entry }) => ({
      ...entry,
      kind: entryPointType,
    })),
    id: data.conferenceId,
    kind: solutionTypes.get(data.conferenceSolution?.key?.type ?? ""),
    notes: data.notes,
    signature: data.signature,
    solutionIconUrl: data.conferenceSolution?.iconUri,
    solutionName: data.conferenceSolution?.name,
  });

  return data.createRequest?.status?.statusCode === "failure"
    ? undefined
    : Option.getOrElse(decoded, (): ConferenceDetailsValue => ({
        kind: "unrepresentable",
      }));
};

const existingConferenceData = (conference: OwnedConferenceValue) => ({
  conferenceId: conference.id,
  conferenceSolution: {
    iconUri: conference.solutionIconUrl,
    key: { type: googleSolutionTypes[conference.kind] },
    name: conference.solutionName,
  },
  entryPoints: conference.entryPoints.map(({ kind, ...entry }) => ({
    ...entry,
    entryPointType: kind,
  })),
  notes: conference.notes,
  signature: conference.signature,
});

export const requestedConferenceData = Effect.fn("requestedConferenceData")(
  function* requestedConferenceData(
    request: ConferencingWriteRequestValue | undefined
  ) {
    if (request === undefined) {
      return request;
    }

    if (request.kind === "none") {
      return null;
    }

    if (request.kind === "keepExisting") {
      return existingConferenceData(request.conference);
    }

    const requestId = yield* Crypto.Crypto.use(
      (crypto) => crypto.randomUUIDv4
    ).pipe(
      Effect.mapError(
        () =>
          new Provider({
            message: "Could not create a conferencing request id",
            operation: "conference.requestId",
            status: 0,
          })
      )
    );

    return {
      createRequest: {
        conferenceSolutionKey: { type: "hangoutsMeet" },
        requestId,
      },
    };
  }
);

export const googleConferencing = (
  data: typeof GoogleConferenceData.Type | null | undefined,
  hangoutLink: string | undefined
): Pick<
  CalendarEventValue,
  "conference" | "conferenceUrl" | "conferencingStatus"
> => {
  const conference = ownedConference(data, hangoutLink);

  const conferenceUrl =
    hangoutLink ??
    data?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;

  const status = data?.createRequest?.status?.statusCode;

  if (status === "pending") {
    return { conference, conferencingStatus: "pending" };
  }

  if (status === "failure") {
    return { conference, conferencingStatus: "failed" };
  }

  if (data === undefined || data === null) {
    return { conference, conferenceUrl };
  }

  return {
    conference,
    conferenceUrl,
    conferencingStatus:
      conferenceUrl === undefined &&
      (conference === undefined || conference.kind === "unrepresentable")
        ? "unconfirmed"
        : "ready",
  };
};

export const conferencingReadback = (
  event: CalendarEventValue,
  request: ConferencingWriteRequestValue
): CalendarEventValue => {
  if (request.kind === "none") {
    return {
      ...event,
      conferencingStatus:
        event.conferenceUrl === undefined ? undefined : "unconfirmed",
    };
  }

  if (request.kind === "keepExisting") {
    const actual = event.conference;
    const expected = request.conference;

    const preserved =
      actual !== undefined &&
      actual.kind !== "unrepresentable" &&
      actual.kind === expected.kind &&
      actual.id === expected.id &&
      expected.entryPoints.every((entry) =>
        actual.entryPoints.some(
          (point) => point.kind === entry.kind && point.uri === entry.uri
        )
      );

    return {
      ...event,
      conferencingStatus: preserved ? "ready" : "unconfirmed",
    };
  }

  return {
    ...event,
    conferencingStatus: event.conferencingStatus ?? "unconfirmed",
  };
};
