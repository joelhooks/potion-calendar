import type { ProfileName } from "@calendar/auth/contracts";
import type { SessionSnapshot } from "@calendar/core/contracts";
import { Context, Effect, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { RpcClient } from "effect/rpc";

import { browserGroup, protocol } from "../../rpc.js";

export class ProfileFailure extends Schema.TaggedError<ProfileFailure>()(
  "ProfileFailure",
  {}
) {}

export interface ProfilePortService {
  readonly read: Effect.Effect<typeof SessionSnapshot.Type, ProfileFailure>;
  readonly save: (
    name: typeof ProfileName.Type
  ) => Effect.Effect<typeof ProfileName.Type, ProfileFailure>;
}

const browserProfile = (): ProfilePortService => ({
  read: Effect.gen(function* readProfile() {
    const client = yield* RpcClient.make(browserGroup);

    return yield* client.session({});
  }).pipe(
    Effect.provide(protocol),
    Effect.scoped,
    Effect.mapError(() => new ProfileFailure())
  ),
  save: Effect.fn("Profile.save")(
    function* saveProfile(name: typeof ProfileName.Type) {
      const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);

      const response = yield* client.execute(
        HttpClientRequest.post("/auth/update-user").pipe(
          HttpClientRequest.bodyJsonUnsafe({ name })
        )
      );

      yield* HttpClientResponse.schemaBodyJson(
        Schema.Struct({ status: Schema.Literal(true) })
      )(response);

      return name;
    },
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError(() => new ProfileFailure())
  ),
});

export const ProfilePort = Context.Reference<ProfilePortService>(
  "@calendar/web/profile/ProfilePort",
  { defaultValue: browserProfile }
);
