import type { ProfileName } from "@calendar/auth/contracts";
import type { SavedProfile, SessionSnapshot } from "@calendar/core/contracts";
import { Context, Effect, Schema } from "effect";
import { RpcClient } from "effect/rpc";

import { browserGroup, protocol } from "../../rpc.js";

export class ProfileFailure extends Schema.TaggedError<ProfileFailure>()(
  "ProfileFailure",
  {}
) {}

export interface ProfileSaveContext {
  readonly proof: string;
  readonly primaryAccountId?: string;
}

export interface ProfilePortService {
  readonly read: Effect.Effect<typeof SessionSnapshot.Type, ProfileFailure>;
  readonly save: (
    name: typeof ProfileName.Type,
    context: ProfileSaveContext
  ) => Effect.Effect<typeof SavedProfile.Type, ProfileFailure>;
}

const browserProfile = (): ProfilePortService => ({
  read: Effect.gen(function* readProfile() {
    const client = yield* RpcClient.make(browserGroup);

    return yield* client.session({});
  }).pipe(
    Effect.provide(protocol),
    Effect.scoped,
    Effect.catchCause(() => Effect.fail(new ProfileFailure()))
  ),
  save: Effect.fn("Profile.save")(
    function* saveProfile(
      name: typeof ProfileName.Type,
      context: ProfileSaveContext
    ) {
      const client = yield* RpcClient.make(browserGroup);

      return yield* client.saveProfile({ name, ...context });
    },
    Effect.provide(protocol),
    Effect.scoped,
    Effect.catchCause(() => Effect.fail(new ProfileFailure()))
  ),
});

export const ProfilePort = Context.Reference<ProfilePortService>(
  "@calendar/web/profile/ProfilePort",
  { defaultValue: browserProfile }
);
