import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { parseSync, Visitor } from "vite";

interface CopySpan {
  readonly start: number;
  readonly end: number;
}

interface CopyLiteral extends CopySpan {
  readonly text: string;
}

const featureCopy = (file: string, source: string) => {
  const parsed = parseSync(file, source);
  expect(parsed.errors, file).toEqual([]);
  const visible: CopySpan[] = [];
  const attributes: CopySpan[] = [];
  const literals: CopyLiteral[] = [];

  new Visitor({
    CallExpression: (node) => {
      const { callee } = node;

      if (
        callee.type !== "MemberExpression" ||
        callee.computed ||
        callee.object.type !== "Identifier" ||
        callee.object.name !== "h" ||
        callee.property.type !== "Identifier"
      ) {
        return;
      }

      const { name } = callee.property;

      if (
        [
          "AriaLabel",
          "AriaDescription",
          "Title",
          "Placeholder",
          "Alt",
        ].includes(name)
      ) {
        const [value] = node.arguments;

        if (value !== undefined) {
          visible.push(value);
        }
      } else if (/^[a-z]/u.test(name)) {
        const [, children] = node.arguments;

        if (children !== undefined) {
          visible.push(children);
        }
      } else {
        attributes.push(node);
      }
    },
    Literal: (node) => {
      if (Schema.is(Schema.String)(node.value)) {
        literals.push({ end: node.end, start: node.start, text: node.value });
      }
    },
    TemplateElement: (node) => {
      literals.push({
        end: node.end,
        start: node.start,
        text: node.value.cooked ?? node.value.raw,
      });
    },
  }).visit(parsed.program);

  return literals.filter(
    (literal) =>
      visible.some(
        (span) => span.start <= literal.start && span.end >= literal.end
      ) &&
      !attributes.some(
        (span) => span.start <= literal.start && span.end >= literal.end
      )
  );
};

it.effect(
  "feature text, titles and accessible labels use US color without renaming structural attributes",
  () =>
    Effect.gen(function* colorSpelling() {
      const fs = yield* FileSystem.FileSystem;
      const directory = new URL("../src/features/", import.meta.url).pathname;

      const files = (yield* fs.readDirectory(directory, {
        recursive: true,
      })).filter((file) => file.endsWith(".ts"));

      expect(files.length).toBeGreaterThan(0);
      const violations: string[] = [];

      for (const file of files) {
        const source = yield* fs.readFileString(`${directory}/${file}`);

        for (const literal of featureCopy(file, source)) {
          if (/colour/iu.test(literal.text)) {
            violations.push(`${file}:${literal.start}: ${literal.text}`);
          }
        }
      }

      expect(violations, violations.join("\n")).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer))
);
