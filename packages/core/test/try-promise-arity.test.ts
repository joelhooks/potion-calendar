// @effect-diagnostics nodeBuiltinImport:off -- This source fence runs Oxlint's parser over application sources and temporary arity fixtures.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");

const pluginSource = String.raw`export default {
  meta: { name: "promise-arity" },
  rules: {
    "explicit-callback": {
      meta: { type: "problem", schema: [], messages: { callback: "tryPromise requires an explicit callback, not bind or a bare member.", directive: "Native Promise exception must sit directly above a zero-argument tryPromise try arrow with the fixed reason." } },
      create(context) {
        const allowedLines = new Set();
        return { "Program:exit"() {
          for (const comment of context.sourceCode.getAllComments()) {
            if (!comment.value.includes("oxlint-disable") || !comment.value.includes("typescript/promise-function-async")) continue;
            const lineStart = context.sourceCode.text.lastIndexOf("\n", comment.start - 1) + 1;
            const standalone = context.sourceCode.text.slice(lineStart, comment.start).trim() === "";
            if (!standalone || comment.type !== "Line" || comment.value.trim() !== "oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter" || !allowedLines.has(comment.loc.end.line + 1)) {
              context.report({ loc: comment.loc, messageId: "directive" });
            }
          }
        }, CallExpression(node) {
          if (node.callee.type !== "MemberExpression" || node.callee.property.name !== "tryPromise") return;
          const options = node.arguments[0];
          const property = options?.type === "ObjectExpression" ? options.properties.find((candidate) => candidate.type === "Property" && (candidate.key.name ?? candidate.key.value) === "try") : undefined;
          const value = options?.type === "ObjectExpression" ? property?.value : options;
          if (property !== undefined && value?.type === "ArrowFunctionExpression" && value.params.length === 0 && !value.async) allowedLines.add(property.loc.start.line);
          if (value?.type === "MemberExpression" || (value?.type === "CallExpression" && value.callee.type === "MemberExpression" && (value.callee.property.name ?? value.callee.property.value) === "bind")) {
            context.report({ node: value, messageId: "callback" });
          }
        } };
      }
    }
  }
};`;

const sourceRoots = ["apps", "packages"]
  .flatMap((directory) =>
    readdirSync(path.join(root, directory), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, directory, entry.name, "src"))
  )
  .filter((directory) => existsSync(directory));

it("rejects bound or bare-member tryPromise callbacks throughout application source", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "calendar-promise-arity-"));
  const plugin = path.join(directory, "plugin.mjs");
  const config = path.join(directory, "oxlint.json");
  const fixture = path.join(directory, "fixture.ts");
  writeFileSync(plugin, pluginSource);
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [plugin],
      rules: { "promise-arity/explicit-callback": "error" },
    })
  );

  const lint = (files: readonly string[]) =>
    spawnSync(
      path.join(root, "node_modules/.bin/oxlint"),
      ["-c", config, "--no-ignore", ...files],
      { cwd: root, encoding: "utf-8" }
    );

  try {
    for (const callback of [
      "statement.first.bind(statement)",
      "adapter.findOne.bind(adapter, input)",
      "statement.first",
      "statement['first']",
    ]) {
      writeFileSync(
        fixture,
        `Effect.tryPromise({ catch: failure, try: ${callback} });`
      );
      const result = lint([fixture]);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(
        "requires an explicit callback"
      );
    }

    const directive =
      "// oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter";

    for (const invalid of [
      `${directive}\nconst callback = () => Promise.resolve();`,
      `Effect.tryPromise({\n${directive}\ntry: (signal) => statement.first(signal) });`,
      `Effect.tryPromise({ catch: failure, ${directive}\ntry: () => statement.first() });`,
      `Effect.tryPromise({\n${directive.replace("native Promise adapter", "a different reason")}\ntry: () => statement.first() });`,
    ]) {
      writeFileSync(fixture, invalid);
      expect(lint([fixture]).status).not.toBe(0);
    }

    writeFileSync(
      fixture,
      `Effect.tryPromise({\n${directive}\ntry: () => statement.first() });`
    );
    expect(lint([fixture]).status).toBe(0);
    writeFileSync(
      fixture,
      "Effect.tryPromise(statement.first.bind(statement));"
    );
    expect(lint([fixture]).status).not.toBe(0);
    writeFileSync(
      fixture,
      "Effect.tryPromise({ catch: failure, try: () => statement.first() });"
    );
    expect(lint([fixture]).status).toBe(0);
    writeFileSync(
      fixture,
      "Effect.promise(\n// oxlint-disable-next-line promise-function-async -- Effect.promise consumes a Promise factory directly.\n() => import('./fixture.js')); "
    );
    expect(lint([fixture]).status).toBe(0);
    const result = lint(sourceRoots);
    expect(result.stdout + result.stderr).not.toContain(
      "requires an explicit callback"
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
