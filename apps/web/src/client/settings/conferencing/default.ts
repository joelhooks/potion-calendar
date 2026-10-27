import type { ConferencingDefault } from "@calendar/calendar/contracts";
import { Schema } from "effect";

export const UserDefaultConferencing = Schema.NullOr(
  Schema.Literal("googleMeet")
);

export const deskDefaultConferencing: typeof UserDefaultConferencing.Type =
  null;

export const resolvedConferencingDefault = (
  account: typeof ConferencingDefault.Type | undefined,
  user: typeof UserDefaultConferencing.Type
): typeof ConferencingDefault.Type | undefined => {
  if (account !== "unset") {
    return account;
  }

  return user ?? "none";
};
