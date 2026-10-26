// @effect-diagnostics-next-line nodeBuiltinImport:off -- codesign is invoked only by the explicitly requested Mac packaging command.
import { execFileSync } from "node:child_process";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Packaging verifies the generated artifact layout before signing.
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Packaging resolves app-local build paths.
import path from "node:path";

import {
  flipFuses,
  FuseState,
  FuseVersion,
  FuseV1Options,
  getCurrentFuseWire,
} from "@electron/fuses";
import { packager } from "@electron/packager";
import { Effect } from "effect";

import manifest from "../package.json" with { type: "json" };
import { DesktopError } from "../src/config.ts";

// @effect-diagnostics-next-line asyncFunction:off -- Packager invokes this native Promise hook after copying the distributable.
const verifyFiles = async (directory: string): Promise<void> => {
  const files = await readdir(directory);

  await Promise.all(
    files.map(
      // @effect-diagnostics-next-line asyncFunction:off -- Packaging validates each generated file before invoking the packager.
      async (file) => {
        const location = path.join(directory, file);
        const info = await lstat(location);

        if (info.isSymbolicLink() || file === "node_modules") {
          throw new Error(
            "Desktop bundle must contain no dependency trees or symlinks"
          );
        }

        if (info.isDirectory()) {
          await verifyFiles(location);
        }
      }
    )
  );
};

export const macArtifactDirectory = (
  root: string,
  version: string,
  head: string
): string => {
  if (
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u.test(version) ||
    !/^[0-9a-f]{40}$/u.test(head)
  ) {
    throw new Error(
      "Packaging requires a safe application version and full Git commit"
    );
  }

  return path.resolve(root, `${version}-${head.slice(0, 12)}`);
};

export const reserveMacArtifactDirectory = (directory: string) =>
  Effect.tryPromise({
    catch: (cause) =>
      new DesktopError({
        cause,
        message: `Packaging requires a fresh folder and never overwrites existing output: ${directory}`,
      }),
    // @effect-diagnostics-next-line asyncFunction:off -- Exclusive native mkdir reserves the build output without a packager invocation.
    try: async () => {
      await mkdir(directory);
    },
  });

export const macNotificationInfo = { NSUserNotificationAlertStyle: "alert" };

const packageMac = Effect.gen(function* packageMacBuild() {
  const head = yield* Effect.try({
    catch: (cause) =>
      new DesktopError({
        cause,
        message: "Packaging could not read the Git commit",
      }),
    try: () =>
      execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
        encoding: "utf-8",
      }).trim(),
  });

  const directory = macArtifactDirectory("artifacts", manifest.version, head);
  yield* Effect.tryPromise({
    catch: (cause) =>
      new DesktopError({
        cause,
        message: "Packaging could not prepare the artifacts directory",
      }),
    // @effect-diagnostics-next-line asyncFunction:off -- This explicit packaging command prepares only the output parent directory.
    try: async () => await mkdir(path.dirname(directory), { recursive: true }),
  });
  yield* reserveMacArtifactDirectory(directory);

  return yield* Effect.tryPromise({
    catch: (cause) =>
      new DesktopError({ cause, message: "Mac packaging failed" }),
    // @effect-diagnostics-next-line asyncFunction:off -- This explicit build command adapts Packager and fuse APIs to Effect, never the hosted page.
    try: async () => {
      await writeFile(
        "dist/package.json",
        JSON.stringify({
          main: "main.js",
          name: "potion-calendar",
          productName: "Potion Calendar",
          type: "module",
          version: manifest.version,
        })
      );
      await verifyFiles("dist");

      const outputs = await packager({
        afterCopy: [
          // @effect-diagnostics-next-line asyncFunction:off -- Packager supplies a native Promise hook for the copied application directory.
          async ({ buildPath }) => {
            await verifyFiles(buildPath);
          },
        ],
        appBundleId: "sh.wzrrd.potion-calendar",
        arch: "arm64",
        asar: true,
        dir: "dist",
        electronVersion: manifest.devDependencies.electron,
        extendInfo: macNotificationInfo,
        name: "Potion Calendar",
        out: directory,
        platform: "darwin",
        prune: false,
      });

      if (outputs.length !== 1) {
        throw new Error(
          "Packaging must produce exactly one new arm64 Mac application"
        );
      }

      await Promise.all(
        outputs.map(
          // @effect-diagnostics-next-line asyncFunction:off -- Each completed Mac bundle is fused and then signed before this build resolves.
          async (output) => {
            const application = path.join(output, "Potion Calendar.app");
            await flipFuses(application, {
              version: FuseVersion.V1,
              [FuseV1Options.RunAsNode]: false,
              [FuseV1Options.EnableCookieEncryption]: true,
              [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
              [FuseV1Options.EnableNodeCliInspectArguments]: false,
              [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
              [FuseV1Options.OnlyLoadAppFromAsar]: true,
            });
            const wire = await getCurrentFuseWire(application);

            if (
              wire[FuseV1Options.RunAsNode] !== FuseState.DISABLE ||
              wire[FuseV1Options.EnableCookieEncryption] !== FuseState.ENABLE ||
              wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable] !==
                FuseState.DISABLE ||
              wire[FuseV1Options.EnableNodeCliInspectArguments] !==
                FuseState.DISABLE ||
              wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] !==
                FuseState.ENABLE ||
              wire[FuseV1Options.OnlyLoadAppFromAsar] !== FuseState.ENABLE
            ) {
              throw new Error("Desktop binary fuse verification failed");
            }

            execFileSync(
              "codesign",
              ["--force", "--deep", "--sign", "-", application],
              { stdio: "inherit" }
            );
            execFileSync(
              "codesign",
              ["--verify", "--deep", "--strict", application],
              { stdio: "inherit" }
            );
          }
        )
      );

      return outputs.map((output) =>
        path.resolve(output, "Potion Calendar.app")
      );
    },
  });
});

if (import.meta.main) {
  if (process.platform !== "darwin") {
    throw new Error("Build and sign the Mac application on macOS");
  }

  const applications = await Effect.runPromise(packageMac);

  for (const application of applications) {
    process.stdout.write(`${application}\n`);
  }
}
