// @effect-diagnostics nodeBuiltinImport:off -- This source fence runs the pinned Oxlint parser over the shared bridge and browser sources.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");

const pluginSource = String.raw`import path from "node:path";
export default {
  meta: { name: "desktop-bridge-graph" },
  rules: {
    imports: {
      meta: { type: "problem", schema: [], messages: {
        core: "The desktop bridge contract imports effect only.",
        app: "The web application cannot import the desktop application."
      } },
      create(context) {
        const filename = context.filename.replaceAll("\\", "/");
        const core = filename.endsWith("/packages/core/src/desktop-bridge.ts") || filename.endsWith("/core-fixture.ts");
        const web = filename.includes("/apps/web/") || filename.endsWith("/web-fixture.ts");
        const check = (node, source) => {
          const name = String(source?.value ?? "");
          if (core && name !== "effect") context.report({ node, messageId: "core" });
          const target = name.startsWith(".") ? path.resolve(path.dirname(context.filename), name).replaceAll("\\", "/") : name;
          if (web && (name === "" || name === "desktop" || name.startsWith("desktop/") || /(?:^|\/)apps\/desktop(?:\/|$)/u.test(target))) context.report({ node, messageId: "app" });
        };
        return {
          ImportDeclaration(node) { check(node, node.source); },
          ExportNamedDeclaration(node) { if (node.source) check(node, node.source); },
          ExportAllDeclaration(node) { check(node, node.source); },
          ImportExpression(node) { check(node, node.source); },
          CallExpression(node) {
            if (node.callee.type === "Identifier" && node.callee.name === "require") check(node, node.arguments[0]);
          }
        };
      }
    }
  }
};`;

it("keeps the shared desktop contract effect-only and web imports outside the desktop app", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "calendar-desktop-graph-"));
  const plugin = path.join(directory, "plugin.mjs");
  const config = path.join(directory, "oxlint.json");
  const coreFixture = path.join(directory, "core-fixture.ts");
  const webFixture = path.join(directory, "web-fixture.ts");

  writeFileSync(plugin, pluginSource);
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [plugin],
      rules: { "desktop-bridge-graph/imports": "error" },
    })
  );
  writeFileSync(coreFixture, "");
  writeFileSync(webFixture, "");

  const lint = (files: readonly string[]) =>
    spawnSync(
      path.join(root, "node_modules/.bin/oxlint"),
      ["-c", config, "--no-ignore", ...files],
      { cwd: root, encoding: "utf-8" }
    );

  try {
    for (const source of [
      'import { fs } from "node:fs";',
      'import { NodeRuntime } from "@effect/platform-node";',
      'export { adapter } from "./adapter.js";',
      'await import("node:fs");',
      'const fs = require("node:fs");',
    ]) {
      writeFileSync(coreFixture, source);
      const result = lint([coreFixture]);

      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("imports effect only");
    }

    for (const source of [
      'import { bridge } from "../apps/desktop/src/preload.js";',
      'export { bridge } from "desktop/bridge";',
      'await import("apps/desktop/src/main.js");',
      'const bridge = require("desktop");',
    ]) {
      writeFileSync(webFixture, source);
      const result = lint([webFixture]);

      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(
        "cannot import the desktop application"
      );
    }

    const tracked = spawnSync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        "apps/web",
      ],
      { cwd: root, encoding: "utf-8" }
    );

    expect(tracked.status).toBe(0);

    const webFiles = [...new Set(tracked.stdout.split("\0"))].flatMap(
      (file) => {
        if (!/\.(?:[cm]?[jt]sx?)$/u.test(file)) {
          return [];
        }

        const source = path.join(root, file);

        return existsSync(source) ? [source] : [];
      }
    );

    expect(webFiles.length).toBeGreaterThan(0);

    const contract = path.join(root, "packages/core/src/desktop-bridge.ts");
    const actual = lint([contract, ...webFiles]);
    expect(actual.stdout + actual.stderr).not.toContain(
      "desktop-bridge-graph/imports"
    );
    expect(actual.status).toBe(0);
  } finally {
    for (const file of [coreFixture, webFixture, config, plugin]) {
      unlinkSync(file);
    }

    rmdirSync(directory);
  }
});
