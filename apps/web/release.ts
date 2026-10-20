import { Crypto, Effect, FileSystem, Path } from "effect";

export const contentFingerprint = Effect.fn("contentFingerprint")(
  function* contentFingerprint(root: string, files: readonly string[]) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const entries: { readonly path: string; readonly text: string }[] = [];

    for (const file of files.toSorted()) {
      entries.push({
        path: file,
        text: yield* fs.readFileString(path.join(root, file)),
      });
    }

    const digest = yield* crypto.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(entries))
    );

    return [...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
);

export const releaseFingerprint = Effect.gen(function* releaseFingerprint() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = import.meta.dirname;

  const files = [
    "index.html",
    "package.json",
    "vite.config.ts",
    "release.ts",
    "../../pnpm-lock.yaml",
    "../../tsconfig.base.json",
    "../../packages/auth/package.json",
    "../../packages/capability/package.json",
    "../../packages/core/package.json",
    "../../packages/database/package.json",
  ];

  const directories = [
    "src",
    "../../packages/auth/src",
    "../../packages/capability/src",
    "../../packages/core/src",
    "../../packages/database/src",
    "../../packages/database/migrations/calendar",
  ];

  if (yield* fs.exists(path.join(root, "../../packages/calendar/src"))) {
    directories.push("../../packages/calendar/src");
    files.push("../../packages/calendar/package.json");
  }

  for (const directory of directories) {
    const names = yield* fs.readDirectory(path.join(root, directory), {
      recursive: true,
    });

    for (const name of names) {
      const relative = path.join(directory, name);
      const info = yield* fs.stat(path.join(root, relative));

      if (info.type === "File") {
        files.push(relative);
      }
    }
  }

  return yield* contentFingerprint(root, files);
});
