import { Crypto, Effect, FileSystem, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Model } from "../src/client/app.js";
import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import { timeBlockPairProof } from "./time-block-pair-proof.js";

export const GridPairInput = Schema.Struct({
  family: Schema.String.check(Schema.isPattern(/^[a-z-]+$/u)),
  model: Schema.String,
  theme: Schema.Literals(["light", "dark"]),
  width: Schema.Literals([900, 1440]),
});

export const digestPairBytes = Effect.fn("digestPairBytes")(
  function* digestPairBytes(contents: string) {
    const crypto = yield* Crypto.Crypto;

    return Array.from(
      yield* crypto.digest("SHA-256", new TextEncoder().encode(contents)),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join("");
  }
);

export const renderFrozenGridPair = Effect.fn("renderFrozenGridPair")(
  function* renderFrozenGridPair(
    input: typeof GridPairInput.Type,
    side: "parent" | "candidate",
    css: string
  ) {
    const fs = yield* FileSystem.FileSystem;

    const model = yield* Schema.decodeEffect(
      Schema.fromJsonString(Schema.toCodecJson(Model))
    )(input.model);

    const rendered = yield* renderToString(
      { init: () => ({ model }), view },
      { isHydratable: false }
    );

    const script = timeBlockPairProof(input.family, input.width, input.theme);
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${input.family} ${input.theme} ${input.width} ${side}</title><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`;
    const path = `../../.git/time-block-pairs/${input.family}-${input.theme}-${input.width}-${side}-fixture.html`;
    yield* fs.makeDirectory("../../.git/time-block-pairs", { recursive: true });
    yield* publishFixtureArtifact(path, html);

    return {
      ...input,
      html,
      inputSha256: yield* digestPairBytes(input.model),
      path,
      script,
      sha256: yield* digestPairBytes(html),
      side,
    };
  }
);
