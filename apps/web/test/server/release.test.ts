import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

import { contentFingerprint } from "../../release.js";

it.effect.prop(
  "release identity follows source bytes and ignores directory enumeration order",
  { after: Schema.String, before: Schema.String },
  ({ after, before }) =>
    Effect.gen(function* releaseIdentity() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const directory = fileURLToPath(
        new URL("../../../../.rat/", import.meta.url)
      );

      yield* fs.makeDirectory(directory, { recursive: true });

      const root = yield* fs.makeTempDirectoryScoped({
        directory,
        prefix: "calendar-release-test-",
      });

      yield* fs.writeFileString(path.join(root, "app.ts"), before);
      yield* fs.writeFileString(
        path.join(root, "contract.ts"),
        "fixed-contract"
      );

      const original = yield* contentFingerprint(root, [
        "app.ts",
        "contract.ts",
      ]);

      const reordered = yield* contentFingerprint(root, [
        "contract.ts",
        "app.ts",
      ]);

      expect(reordered).toBe(original);
      yield* fs.writeFileString(path.join(root, "app.ts"), after);

      const changed = yield* contentFingerprint(root, [
        "app.ts",
        "contract.ts",
      ]);

      const encoder = new TextEncoder();

      expect(changed === original).toBe(
        encoder.encode(after).toString() === encoder.encode(before).toString()
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 30 } }
);
