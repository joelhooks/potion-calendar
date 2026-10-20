// @effect-diagnostics-next-line nodeBuiltinImport:off -- The packaging filesystem test creates and removes only its unique mkdtemp fixture.
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- This packaging boundary test resolves its own artifact fixture and verifies absolute output paths.
import path from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  macArtifactDirectory,
  reserveMacArtifactDirectory,
} from "../scripts/package-mac.ts";

const head = "1234567890abcdef1234567890abcdef12345678";

it.effect(
  "Mac output names identify the version and twelve-character Git commit",
  () =>
    Effect.sync(() => {
      const directory = macArtifactDirectory("artifacts", "0.1.0", head);
      expect(directory).toBe(path.resolve("artifacts", "0.1.0-1234567890ab"));
      expect(path.isAbsolute(directory)).toBe(true);
      expect(() =>
        macArtifactDirectory("artifacts", "../older", head)
      ).toThrow();
      expect(() =>
        macArtifactDirectory("artifacts", "0.1.0", "../older")
      ).toThrow();
    })
);

it.effect(
  "a reserved Mac output refuses another build without touching its files or older artifacts",
  () =>
    Effect.gen(function* macOutputReservation() {
      const artifacts = path.resolve(import.meta.dirname, "../artifacts");
      yield* Effect.sync(() => fs.mkdirSync(artifacts, { recursive: true }));

      const root = yield* Effect.acquireRelease(
        Effect.sync(() =>
          fs.mkdtempSync(path.join(artifacts, ".reservation-test-"))
        ),
        (directory) =>
          Effect.sync(() => {
            fs.rmSync(directory, { recursive: true });
          })
      );

      const older = path.join(root, "Potion Calendar-darwin-arm64");
      yield* Effect.sync(() => {
        fs.mkdirSync(older);
      });
      yield* Effect.sync(() => {
        fs.writeFileSync(path.join(older, "running-app"), "older application");
      });
      const directory = macArtifactDirectory(root, "0.1.0", head);
      yield* reserveMacArtifactDirectory(directory);
      yield* Effect.sync(() => {
        fs.writeFileSync(path.join(directory, "build-proof"), "first build");
      });

      const failure = yield* Effect.flip(
        reserveMacArtifactDirectory(directory)
      );

      expect(failure.message).toContain(directory);
      expect(failure.message).toContain("never overwrites");
      expect(
        yield* Effect.sync(() =>
          fs.readFileSync(path.join(directory, "build-proof"), "utf-8")
        )
      ).toBe("first build");
      expect(
        yield* Effect.sync(() =>
          fs.readFileSync(path.join(older, "running-app"), "utf-8")
        )
      ).toBe("older application");
      expect(
        (yield* Effect.sync(() => fs.readdirSync(root))).toSorted()
      ).toEqual(["0.1.0-1234567890ab", "Potion Calendar-darwin-arm64"]);
    }).pipe(Effect.scoped)
);
