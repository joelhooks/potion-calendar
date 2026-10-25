import { APIError, createAuthMiddleware } from "better-auth/api";
import { Option, Schema } from "effect";

import { normalizeProfileName, ProfileUpdateInput } from "./contracts.js";

// @effect-diagnostics-next-line asyncFunction:off -- Better Auth requires a Promise-returning middleware; synchronous validation precedes its name-only write.
export const profileUpdateHook = createAuthMiddleware(async (context) => {
  if (context.path !== "/update-user") {
    return await Promise.resolve({ context: {} });
  }

  const input = Schema.decodeUnknownOption(ProfileUpdateInput, {
    onExcessProperty: "error",
  })(context.body);

  if (Option.isNone(input)) {
    throw new APIError("BAD_REQUEST", {
      message: "Only a full name can be updated.",
    });
  }

  const name = normalizeProfileName(input.value.name);

  if (Option.isNone(name)) {
    throw new APIError("BAD_REQUEST", {
      message:
        input.value.name.trim() === ""
          ? "Full name is required."
          : "Use 100 characters or fewer.",
    });
  }

  return await Promise.resolve({ context: { body: { name: name.value } } });
});
