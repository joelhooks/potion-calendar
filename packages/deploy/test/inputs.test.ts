import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Schema } from "effect";

import { validateDeployInputs } from "../src/inputs.js";

const keys = [
  "ALCHEMY_PROFILE",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "BETTER_AUTH_SECRET",
  "ALLOWED_EMAILS",
];

const schema = keys
  .map((key) => `# @required=forEnv(production)\n${key}=\n`)
  .join("\n");

const values = {
  ALCHEMY_PROFILE: "test-profile",
  ALLOWED_EMAILS: "test-secret",
  BETTER_AUTH_SECRET: "persistent",
  GOOGLE_CLIENT_ID: "test-destination",
  GOOGLE_CLIENT_SECRET: "true",
};

it.effect.prop(
  "missing production inputs name only their keys before planning",
  { missing: Schema.Literals(keys) },
  ({ missing }) =>
    Effect.gen(function* test() {
      const env = Object.fromEntries(
        Object.entries(values).filter(([key]) => key !== missing)
      );

      const failure = yield* validateDeployInputs(schema).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({ env })
        ),
        Effect.flip
      );

      expect(failure.keys).toStrictEqual([missing]);
      expect(JSON.stringify(failure)).not.toContain("test-secret");
    }),
  { arbitrary: { runs: 100 } }
);

it.effect("explicit auth settings preserve the required key set", () =>
  Effect.gen(function* test() {
    const found = yield* validateDeployInputs(schema).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: values })
      )
    );

    expect(found).toStrictEqual(keys);
  })
);
