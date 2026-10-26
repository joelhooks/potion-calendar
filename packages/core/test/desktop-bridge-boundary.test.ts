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
        app: "Web and desktop applications cannot import each other.",
        pure: "Shared keyboard hints must contain only import-free function definitions."
      } },
      create(context) {
        const filename = context.filename.replaceAll("\\", "/");
        const core = filename.endsWith("/packages/core/src/desktop-bridge.ts") || filename.endsWith("/core-fixture.ts");
        const web = filename.includes("/apps/web/") || filename.endsWith("/web-fixture.ts");
        const desktop = filename.includes("/apps/desktop/") || filename.endsWith("/desktop-fixture.ts");
        const pure = filename.endsWith("/packages/core/src/keyboard-hints.ts") || filename.endsWith("/pure-fixture.ts");
        const check = (node, source) => {
          const name = String(source?.value ?? "");
          if (core && name !== "effect") context.report({ node, messageId: "core" });
          if (pure) context.report({ node, messageId: "pure" });
          const target = name.startsWith(".") ? path.resolve(path.dirname(context.filename), name).replaceAll("\\", "/") : name;
          if (web && (name === "" || name === "desktop" || name.startsWith("desktop/") || /(?:^|\/)apps\/desktop(?:\/|$)/u.test(target))) context.report({ node, messageId: "app" });
          if (desktop && (name === "" || name === "web" || name.startsWith("web/") || /(?:^|\/)apps\/web(?:\/|$)/u.test(target))) context.report({ node, messageId: "app" });
        };
        return {
          Program(node) {
            if (!pure) return;
            for (const entry of node.body) {
              const declaration = entry.type === "ExportNamedDeclaration" ? entry.declaration : entry;
              if (declaration?.type !== "VariableDeclaration" || declaration.declarations.some((item) => item.init?.type !== "ArrowFunctionExpression")) context.report({ node: entry, messageId: "pure" });
            }
          },
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
  const desktopFixture = path.join(directory, "desktop-fixture.ts");
  const pureFixture = path.join(directory, "pure-fixture.ts");

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
  writeFileSync(desktopFixture, "");
  writeFileSync(pureFixture, "");

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
        "cannot import each other"
      );
    }

    for (const source of [
      'import { value } from "../apps/web/src/client/app.js";',
      'export { value } from "web/client/app";',
      'await import("apps/web/src/client/app.js");',
      'const value = require("web");',
    ]) {
      writeFileSync(desktopFixture, source);
      const result = lint([desktopFixture]);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(
        "cannot import each other"
      );
    }

    for (const source of [
      'import { Schema } from "effect";',
      "const state = new Map();",
      'window.addEventListener("click", () => {});',
      "export const value = (() => 1)();",
      'export { value } from "./value.js";',
    ]) {
      writeFileSync(pureFixture, source);
      const result = lint([pureFixture]);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(
        "import-free function definitions"
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
        "apps/desktop",
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
    const hints = path.join(root, "packages/core/src/keyboard-hints.ts");
    const actual = lint([contract, hints, ...webFiles]);
    expect(actual.stdout + actual.stderr).not.toContain(
      "desktop-bridge-graph/imports"
    );
    expect(actual.status).toBe(0);
  } finally {
    for (const file of [
      coreFixture,
      webFixture,
      desktopFixture,
      pureFixture,
      config,
      plugin,
    ]) {
      unlinkSync(file);
    }

    rmdirSync(directory);
  }
});
