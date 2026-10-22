import { Crypto, Effect, FileSystem } from "effect";

export const publishFixtureArtifact = Effect.fn("publishFixtureArtifact")(
  function* publishCompleteFixture(path: string, contents: string) {
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const id = yield* crypto.randomUUIDv4;
    const temporary = `${path}.${id}.tmp`;

    yield* Effect.acquireRelease(
      fs.writeFileString(temporary, "", { flag: "wx", mode: 0o600 }),
      () => fs.remove(temporary, { force: true }).pipe(Effect.orDie)
    );

    yield* fs.writeFileString(temporary, contents);
    yield* fs.rename(temporary, path);
  },
  Effect.scoped
);
