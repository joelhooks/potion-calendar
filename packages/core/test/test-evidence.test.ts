// @effect-diagnostics nodeBuiltinImport:off -- These tests exercise the dependency-free Node CLI as a subprocess.
import { spawnSync } from "node:child_process";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";

const root = `${import.meta.dirname}/../../..`;

const fixtures = `${import.meta.dirname}/fixtures/test-evidence`;

const Outcome = Schema.fromJsonString(
  Schema.Struct({
    accepted: Schema.Boolean,
    reasons: Schema.Array(Schema.Struct({ code: Schema.String })),
  })
);

const runGuard = Effect.fn("runEvidenceGuard")(function* runGuard(
  report: string,
  inventory: string,
  options: {
    readonly targetExit?: number;
    readonly allowed?: string;
    readonly measured?: string;
    readonly root?: string;
  } = {}
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(`${root}/.rat/evidence-guard`, { recursive: true });

  const directory = yield* fs.makeTempDirectoryScoped({
    directory: `${root}/.rat/evidence-guard`,
  });

  yield* fs.writeFileString(`${directory}/report.json`, report);
  yield* fs.writeFileString(`${directory}/inventory.json`, inventory);

  const args = [
    `${root}/scripts/check-test-evidence.mjs`,
    "--report",
    `${directory}/report.json`,
    "--inventory",
    `${directory}/inventory.json`,
    "--target-exit",
    String(options.targetExit ?? 0),
  ];

  for (const [flag, value] of [
    ["allow", options.allowed],
    ["measured", options.measured],
  ] as const) {
    if (value !== undefined) {
      yield* fs.writeFileString(`${directory}/${flag}.json`, value);
      args.push(`--${flag}`, `${directory}/${flag}.json`);
    }
  }

  if (options.root !== undefined) {
    args.push("--root", options.root);
  }

  const result = yield* Effect.sync(() =>
    spawnSync(process.execPath, args, { cwd: root, encoding: "utf-8" })
  );

  expect(result.error).toBeUndefined();
  const outcome = yield* Schema.decodeEffect(Outcome)(result.stdout);

  return { ...outcome, exit: result.status };
});

const inventoryCase = {
  file: "/evidence/case.test.ts",
  location: { column: 1, line: 1 },
  name: "case",
};

const inventory = JSON.stringify([inventoryCase]);

const sample = (status = "passed", duration: number | null = 1) => ({
  numFailedTests: status === "failed" ? 1 : 0,
  numPassedTests: status === "passed" ? 1 : 0,
  numPendingTests: status === "pending" || status === "skipped" ? 1 : 0,
  numTodoTests: status === "todo" ? 1 : 0,
  numTotalTests: 1,
  success: status !== "failed",
  testResults: [
    {
      assertionResults: [
        {
          ancestorTitles: [],
          duration,
          fullName: "case",
          location: inventoryCase.location,
          status,
          title: "case",
        },
      ],
      message: "",
      name: inventoryCase.file,
      status: status === "failed" ? "failed" : "passed",
    },
  ],
});

it.layer(NodeServices.layer)("test evidence acceptance", (test) => {
  test.effect(
    "accepts two and rejects four frozen reporter witnesses with named reasons",
    () =>
      Effect.gen(function* frozenWitnesses() {
        const fs = yield* FileSystem.FileSystem;

        const cases = [
          ["complete", "synthetic", 0, true, ""],
          ["error", "synthetic", 0, true, ""],
          ["empty", "synthetic", 0, false, "missing-case"],
          ["pending", "synthetic", 0, false, "disallowed-status"],
          ["lime-missing", "lime-missing", 1, false, "missing-case"],
          ["warrenn-pending", "warrenn-pending", 1, false, "disallowed-status"],
        ] as const;

        let accepted = 0;

        for (const [name, expected, targetExit, passes, reason] of cases) {
          const report = yield* fs.readFileString(`${fixtures}/${name}.json`);

          const expectedRows = yield* fs.readFileString(
            `${fixtures}/${expected}-inventory.json`
          );

          const result = yield* runGuard(report, expectedRows, { targetExit });
          expect(result.accepted, name).toBe(passes);
          expect(result.exit, name).toBe(passes ? 0 : 1);

          if (passes) {
            accepted += 1;
          } else {
            expect(
              result.reasons.map((entry) => entry.code),
              name
            ).toContain(reason);
          }
        }

        expect(accepted).toBe(2);
      })
  );

  test.effect(
    "checks duplicate multiplicity, extra cases, names and exact locations",
    () =>
      Effect.gen(function* identityChecks() {
        const report = JSON.stringify(sample());

        const missingDuplicate = yield* runGuard(
          report,
          JSON.stringify([inventoryCase, inventoryCase])
        );

        expect(missingDuplicate.reasons.map((entry) => entry.code)).toContain(
          "missing-case"
        );

        const changedLocation = yield* runGuard(
          report,
          JSON.stringify([
            { ...inventoryCase, location: { column: 1, line: 2 } },
          ])
        );

        expect(changedLocation.reasons.map((entry) => entry.code)).toContain(
          "missing-case"
        );
        expect(changedLocation.reasons.map((entry) => entry.code)).toContain(
          "extra-case"
        );

        const changedName = yield* runGuard(
          report,
          JSON.stringify([{ ...inventoryCase, name: "different" }])
        );

        expect(changedName.reasons.map((entry) => entry.code)).toContain(
          "extra-case"
        );
        const extra = yield* runGuard(report, "[]");
        expect(extra.reasons.map((entry) => entry.code)).toContain(
          "extra-case"
        );

        const relative = yield* runGuard(
          report,
          JSON.stringify([{ ...inventoryCase, file: "case.test.ts" }]),
          { root: "/evidence" }
        );

        expect(relative.accepted).toBe(true);
      })
  );

  test.effect(
    "matches absolute report files against repository-relative inventory files",
    () =>
      Effect.gen(function* absoluteReportIdentity() {
        const original = sample();

        const report = {
          ...original,
          testResults: original.testResults.map((file) => ({
            ...file,
            name: `${root}/apps/web/test/evidence.test.ts`,
          })),
        };

        const expected = JSON.stringify([
          { ...inventoryCase, file: "apps/web/test/evidence.test.ts" },
        ]);

        const result = yield* runGuard(JSON.stringify(report), expected, {
          root,
        });

        expect(result.accepted).toBe(true);
        expect(result.exit).toBe(0);
        expect(result.reasons).toEqual([]);
      })
  );

  test.effect(
    "requires explicit identity-scoped allowances and valid measured durations",
    () =>
      Effect.gen(function* allowedAndMeasured() {
        for (const status of ["pending", "skipped", "todo", "failed"]) {
          const report = JSON.stringify(sample(status, null));
          const denied = yield* runGuard(report, inventory);
          expect(denied.reasons.map((entry) => entry.code)).toContain(
            "disallowed-status"
          );

          const allowed = yield* runGuard(report, inventory, {
            allowed: JSON.stringify([{ ...inventoryCase, statuses: [status] }]),
            measured: "[]",
          });

          expect(allowed.accepted, status).toBe(true);
        }

        for (const duration of [null, -1]) {
          const invalid = yield* runGuard(
            JSON.stringify(sample("passed", duration)),
            inventory
          );

          expect(invalid.reasons.map((entry) => entry.code)).toContain(
            "non-finite-duration"
          );
        }

        const target = yield* runGuard(JSON.stringify(sample()), inventory, {
          targetExit: 1,
        });

        expect(target.reasons.map((entry) => entry.code)).toContain(
          "target-exit"
        );

        const brokenCount = yield* runGuard(
          JSON.stringify({ ...sample(), numPassedTests: 9 }),
          inventory
        );

        expect(brokenCount.reasons.map((entry) => entry.code)).toContain(
          "inconsistent-count"
        );
        const malformed = yield* runGuard("{", inventory);
        expect(malformed.reasons.map((entry) => entry.code)).toContain(
          "invalid-input"
        );
        const empty = sample();

        const emptyFile = {
          ...empty,
          testResults: [{ ...empty.testResults[0], assertionResults: [] }],
        };

        const emptyResult = yield* runGuard(
          JSON.stringify(emptyFile),
          inventory
        );

        expect(emptyResult.reasons.map((entry) => entry.code)).toContain(
          "unexpected-empty-file"
        );
      })
  );

  test.effect(
    "consumes real Vitest list JSON without confusing literal suite delimiters",
    () =>
      Effect.gen(function* actualListInventory() {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(`${root}/.rat/evidence-guard`, {
          recursive: true,
        });

        const directory = yield* fs.makeTempDirectoryScoped({
          directory: `${root}/.rat/evidence-guard`,
        });

        yield* fs.makeDirectory(`${directory}/test`);
        const file = `${directory}/test/case.test.ts`;
        yield* fs.writeFileString(
          file,
          'import { describe, it } from "vitest";\ndescribe("suite > literal", () => {\nit("first", () => {});\nit("second", () => {});\n});\n'
        );
        const listFile = `${directory}/list.json`;

        const result = yield* Effect.sync(() =>
          spawnSync(
            process.execPath,
            [
              `${root}/apps/web/node_modules/vitest/vitest.mjs`,
              "list",
              "--root",
              directory,
              "--config",
              `${root}/packages/core/vitest.config.ts`,
              "--includeTaskLocation",
              "--static-parse-concurrency=1",
              `--json=${listFile}`,
            ],
            { cwd: root, encoding: "utf-8" }
          )
        );

        expect(result.status, result.stdout + result.stderr).toBe(0);
        const rowsText = yield* fs.readFileString(listFile);

        const rows = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Array(
              Schema.Struct({
                file: Schema.String,
                location: Schema.Struct({
                  column: Schema.Int,
                  line: Schema.Int,
                }),
                name: Schema.String,
              })
            )
          )
        )(rowsText);

        expect(rows).toHaveLength(2);
        const report = sample();

        const assertion = yield* Effect.fromNullishOr(
          report.testResults[0]?.assertionResults[0]
        );

        const assertions = rows.map((row, index) => ({
          ...assertion,
          ancestorTitles: ["suite > literal"],
          fullName:
            index === 0 ? "suite > literal first" : "suite > literal second",
          location: row.location,
          title: index === 0 ? "first" : "second",
        }));

        const actual = {
          ...report,
          numPassedTests: 2,
          numTotalTests: 2,
          testResults: [
            {
              assertionResults: assertions,
              message: "",
              name: file,
              status: "passed",
            },
          ],
        };

        const accepted = yield* runGuard(JSON.stringify(actual), rowsText);
        expect(accepted.accepted).toBe(true);
      })
  );
});
