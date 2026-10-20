import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { build } from "vite";
import type { InlineConfig } from "vite";

const inspectBundle = Effect.fn("test.inspectBundle")(function* inspectBundle(
  entry: string,
  server: boolean
) {
  const modules = new Set<string>();
  const code: string[] = [];

  const options: InlineConfig = {
    build: {
      minify: false,
      rolldownOptions: { input: entry },
      ssr: server,
      write: false,
    },
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        generateBundle(_options, bundle) {
          for (const output of Object.values(bundle)) {
            if (output.type === "chunk") {
              for (const id of Object.keys(output.modules)) {
                modules.add(id);
              }

              code.push(output.code);
            }
          }
        },
        name: "calendar-artifact-privacy",
      },
    ],
    ssr: { noExternal: true },
  };

  yield* Effect.promise(build.bind(undefined, options));

  return { code: code.join("\n"), modules: [...modules] };
});

it.effect(
  "production browser and Worker artifacts exclude the fake provider and devtools",
  () =>
    Effect.gen(function* productionPrivacy() {
      for (const [entry, server] of [
        ["src/client/entry.ts", false],
        ["src/server/worker.ts", true],
      ] as const) {
        const artifact = yield* inspectBundle(entry, server);

        expect(artifact.modules.length).toBeGreaterThan(0);
        expect(
          artifact.modules.some(
            (id) =>
              id.includes("/src/dev/") ||
              id.includes("fake-google") ||
              /\/miniflare(?:@|\/)/u.test(id) ||
              id.includes("/devtools/") ||
              id.includes("/packages/calendar/test/") ||
              id.includes("/@effect/vitest/") ||
              id.includes("/vitest/") ||
              id.includes("test-person")
          )
        ).toBe(false);
        expect(artifact.code).not.toContain(
          "calendar-development-only-signing-key"
        );
        expect(artifact.code).not.toContain("fake-google-access-");
      }
    })
);

it.effect(
  "the development graph contains the fake, so the production check has a positive control",
  () =>
    Effect.gen(function* developmentControl() {
      const artifact = yield* inspectBundle("src/dev/backend.ts", true);

      expect(artifact.modules.some((id) => id.includes("fake-google"))).toBe(
        true
      );
      expect(artifact.code).toContain("fake-google-access-");
    })
);
