import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, FileSystem, Path, Schema } from "effect";

import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

it.effect.prop(
  "a concurrent reader sees only complete fixture versions while two publishers pause after partial private writes",
  { payload: Schema.String },
  ({ payload }) =>
    Effect.gen(function* concurrentPublication() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const directory = yield* fs.makeTempDirectoryScoped({
        directory: ".",
        prefix: ".fixture-publication-test-",
      });

      const destination = path.join(directory, "artifact.html");
      const previous = JSON.stringify({ payload, revision: 1 });
      const first = JSON.stringify({ payload, revision: 2 });
      const second = JSON.stringify({ payload, revision: 3 });
      const firstPartial = yield* Deferred.make<boolean>();
      const secondPartial = yield* Deferred.make<boolean>();
      const allowFirst = yield* Deferred.make<boolean>();
      const allowSecond = yield* Deferred.make<boolean>();
      const firstPublished = yield* Deferred.make<boolean>();
      const secondPublished = yield* Deferred.make<boolean>();
      const temporaryWrites: string[] = [];

      yield* fs.writeFileString(destination, previous);

      const barriers = new Map([
        [first, { allow: allowFirst, ready: firstPartial }],
        [second, { allow: allowSecond, ready: secondPartial }],
      ]);

      const stagedWriter: FileSystem.FileSystem = {
        ...fs,
        writeFileString: (target, contents, options) => {
          const barrier = barriers.get(contents);

          return barrier === undefined
            ? fs.writeFileString(target, contents, options)
            : Effect.gen(function* pausedPrivateWrite() {
                temporaryWrites.push(target);
                yield* fs.writeFileString(
                  target,
                  contents.slice(0, Math.floor(contents.length / 2)),
                  options
                );
                yield* Deferred.succeed(barrier.ready, true);
                yield* Deferred.await(barrier.allow);
                yield* fs.writeFileString(target, contents, options);
              });
        },
      };

      const result = yield* Effect.all(
        {
          firstWriter: publishFixtureArtifact(destination, first).pipe(
            Effect.provideService(FileSystem.FileSystem, stagedWriter),
            Effect.andThen(Deferred.succeed(firstPublished, true))
          ),
          reader: Effect.gen(function* concurrentReader() {
            yield* Deferred.await(firstPartial);
            yield* Deferred.await(secondPartial);

            const duringBothPrivateWrites =
              yield* fs.readFileString(destination);

            yield* Deferred.succeed(allowFirst, true);
            yield* Deferred.await(firstPublished);
            const afterFirstPublication = yield* fs.readFileString(destination);
            yield* Deferred.succeed(allowSecond, true);
            yield* Deferred.await(secondPublished);

            const afterSecondPublication =
              yield* fs.readFileString(destination);

            return {
              afterFirstPublication,
              afterSecondPublication,
              duringBothPrivateWrites,
            };
          }),
          secondWriter: publishFixtureArtifact(destination, second).pipe(
            Effect.provideService(FileSystem.FileSystem, stagedWriter),
            Effect.andThen(Deferred.succeed(secondPublished, true))
          ),
        },
        { concurrency: 3 }
      ).pipe(Effect.exit);

      expect(Exit.isSuccess(result)).toBe(true);

      if (Exit.isFailure(result)) {
        return;
      }

      expect(result.value.reader.duringBothPrivateWrites).toBe(previous);
      expect(result.value.reader.afterFirstPublication).toBe(first);
      expect(result.value.reader.afterSecondPublication).toBe(second);
      expect(temporaryWrites).toHaveLength(2);
      expect(new Set(temporaryWrites).size).toBe(2);

      for (const temporary of temporaryWrites) {
        expect(temporary).not.toBe(destination);
        expect(path.resolve(path.dirname(temporary))).toBe(
          path.resolve(directory)
        );
      }

      expect(yield* fs.readDirectory(directory)).toEqual(["artifact.html"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect(
  "a failed private fixture write retains the previous publication and removes its temporary file",
  () =>
    Effect.gen(function* failedPublication() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const directory = yield* fs.makeTempDirectoryScoped({
        directory: ".",
        prefix: ".fixture-publication-test-",
      });

      const destination = path.join(directory, "artifact.html");
      const previous = "previous complete fixture";
      const complete = "next complete fixture";

      yield* fs.writeFileString(destination, previous);

      const failedWriter: FileSystem.FileSystem = {
        ...fs,
        writeFileString: (target, contents, options) =>
          contents === complete
            ? fs
                .writeFileString(target, "partial", options)
                .pipe(
                  Effect.andThen(Effect.die("private fixture write failed"))
                )
            : fs.writeFileString(target, contents, options),
      };

      const result = yield* publishFixtureArtifact(destination, complete).pipe(
        Effect.provideService(FileSystem.FileSystem, failedWriter),
        Effect.exit
      );

      expect(Exit.isFailure(result)).toBe(true);
      expect(yield* fs.readFileString(destination)).toBe(previous);
      expect(yield* fs.readDirectory(directory)).toEqual(["artifact.html"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
