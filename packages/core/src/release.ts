import { Effect, FileSystem, Schema } from "effect";

export const ReleaseManifest = Schema.Struct({
  generation: Schema.NonEmptyString,
});

export const readReleaseManifest = Effect.fn("readReleaseManifest")(
  function* readReleaseManifest(path: string) {
    const fs = yield* FileSystem.FileSystem;
    const document = yield* fs.readFileString(path);

    return yield* Schema.decodeEffect(Schema.fromJsonString(ReleaseManifest))(
      document
    );
  }
);
