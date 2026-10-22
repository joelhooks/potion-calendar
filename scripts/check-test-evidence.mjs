/// <reference types="node" />
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const usage = `Usage: node scripts/check-test-evidence.mjs --report FILE --inventory FILE --target-exit INTEGER [--root DIR] [--allow FILE] [--measured FILE]
Inventory: Vitest list --json for the same commit and selection flags.
Docs: https://vitest.dev/guide/cli.html#vitest-list
List names use suite > test; reporter hierarchy is reconstructed without replacing literal delimiters.
Allow: inventory-shaped rows with statuses arrays; inventory membership is never waived.
Measured: inventory-shaped rows requiring finite nonnegative durations; defaults to all cases.
An empty measured array permits explicitly allowed untimed cases.
The caller owns actual exit receipts and same-commit/flags provenance.`;

/** @type {(value: unknown) => asserts value is Record<string, unknown>} */
const requireObject = (value) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Dependency-free JSON boundary validation cannot import a schema runtime.
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
};

/** @type {(value: unknown) => asserts value is string} */
const requireText = (value) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Dependency-free JSON boundary validation establishes string fields before use.
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expected a nonempty string");
  }
};

/** @type {(value: unknown) => asserts value is unknown[]} */
const requireArray = (value) => {
  if (!Array.isArray(value)) {
    throw new TypeError("Expected a JSON array");
  }
};

/** @param {unknown} value @returns {number[] | null} */
const location = (value) => {
  if (value === undefined) {
    return null;
  }

  requireObject(value);

  if (
    !Number.isSafeInteger(value.line) ||
    Number(value.line) < 1 ||
    !Number.isSafeInteger(value.column) ||
    Number(value.column) < 1
  ) {
    throw new Error("Location requires positive integer line and column");
  }

  return [Number(value.line), Number(value.column)];
};

/** @param {unknown} row @param {string} root */
const identity = (row, root) => {
  requireObject(row);
  requireText(row.file);
  requireText(row.name);

  return JSON.stringify([
    path.resolve(root, row.file),
    row.name,
    location(row.location),
  ]);
};

/** @param {Iterable<string>} keys */
const counts = (keys) => {
  /** @type {Map<string, number>} */
  const result = new Map();

  for (const key of keys) {
    result.set(key, (result.get(key) ?? 0) + 1);
  }

  return result;
};

/** @param {string} file @returns {Promise<unknown>} */
const readJson = async (file) => JSON.parse(await readFile(file, "utf-8"));

/** @param {Map<string, string>} options @param {string} flag */
const required = (options, flag) => {
  const value = options.get(flag);

  if (value === undefined) {
    throw new Error(`Missing ${flag}`);
  }

  return value;
};

/** @param {string[]} args */
const parseOptions = (args) => {
  /** @type {Map<string, string>} */
  const options = new Map();

  const known = new Set([
    "--report",
    "--inventory",
    "--target-exit",
    "--root",
    "--allow",
    "--measured",
  ]);

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];

    if (
      flag === undefined ||
      !known.has(flag) ||
      options.has(flag) ||
      value === undefined
    ) {
      throw new Error(`Invalid or duplicate option: ${flag}`);
    }

    options.set(flag, value);
  }

  return options;
};

/** @param {Map<string, string>} options @param {Map<string, number>} expected @param {string} root */
const allowances = async (options, expected, root) => {
  /** @type {Map<string, Set<string>>} */
  const result = new Map();
  const file = options.get("--allow");

  if (file === undefined) {
    return result;
  }

  const rows = await readJson(file);
  requireArray(rows);
  const known = new Set(["pending", "skipped", "todo", "failed"]);

  for (const row of rows) {
    requireObject(row);
    const key = identity(row, root);
    requireArray(row.statuses);

    const statuses = row.statuses.map((status) => {
      requireText(status);

      if (!known.has(status)) {
        throw new Error("Invalid allowed status");
      }

      return status;
    });

    if (!expected.has(key) || statuses.length === 0 || result.has(key)) {
      throw new Error("Allowances must uniquely identify expected cases");
    }

    result.set(key, new Set(statuses));
  }

  return result;
};

/** @typedef {{code: string, detail: unknown}} Reason */

/** @param {unknown} report @param {string} root @param {Set<string>} measured @param {Map<string, Set<string>>} allowed */
const assertions = (report, root, measured, allowed) => {
  requireObject(report);
  requireArray(report.testResults);
  /** @type {Reason[]} */
  const reasons = [];
  const keys = [];
  const statuses = [];

  for (const file of report.testResults) {
    requireObject(file);
    requireText(file.name);
    requireArray(file.assertionResults);

    if (file.assertionResults.length === 0) {
      reasons.push({ code: "unexpected-empty-file", detail: file.name });
    }

    if (file.message !== undefined && file.message !== "") {
      reasons.push({ code: "file-error", detail: file.name });
    }

    for (const row of file.assertionResults) {
      requireObject(row);
      requireArray(row.ancestorTitles);

      const ancestors = row.ancestorTitles.map((title) => {
        requireText(title);

        return title;
      });

      requireText(row.title);
      requireText(row.status);

      if (row.fullName !== [...ancestors, row.title].join(" ")) {
        throw new Error(
          "Report fullName disagrees with ancestorTitles and title"
        );
      }

      const key = identity(
        {
          file: file.name,
          location: row.location,
          name: [...ancestors, row.title].join(" > "),
        },
        root
      );

      keys.push(key);
      statuses.push(row.status);

      if (
        row.status !== "passed" &&
        allowed.get(key)?.has(row.status) !== true
      ) {
        reasons.push({
          code: "disallowed-status",
          detail: { key, status: row.status },
        });
      }

      if (
        measured.has(key) &&
        (!Number.isFinite(row.duration) || Number(row.duration) < 0)
      ) {
        reasons.push({ code: "non-finite-duration", detail: key });
      }
    }
  }

  return { keys, reasons, statuses };
};

/** @param {Map<string, number>} expected @param {Map<string, number>} actual */
const inventoryDifferences = (expected, actual) => {
  /** @type {Reason[]} */
  const reasons = [];

  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    const difference = (actual.get(key) ?? 0) - (expected.get(key) ?? 0);

    if (difference !== 0) {
      reasons.push({
        code: difference < 0 ? "missing-case" : "extra-case",
        detail: { count: Math.abs(difference), key },
      });
    }
  }

  return reasons;
};

/** @param {unknown} report @param {string[]} statuses */
const aggregateDifferences = (report, statuses) => {
  requireObject(report);
  /** @type {Reason[]} */
  const reasons = [];

  const totals = new Map([
    ["numTotalTests", statuses.length],
    ["numPassedTests", statuses.filter((status) => status === "passed").length],
    ["numFailedTests", statuses.filter((status) => status === "failed").length],
    [
      "numPendingTests",
      statuses.filter((status) => status === "pending" || status === "skipped")
        .length,
    ],
    ["numTodoTests", statuses.filter((status) => status === "todo").length],
  ]);

  for (const [field, actual] of totals) {
    if (report[field] !== actual) {
      reasons.push({
        code: "inconsistent-count",
        detail: { actual, field, reported: report[field] },
      });
    }
  }

  return reasons;
};

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${usage}\n`);

    return;
  }

  const options = parseOptions(args);
  const reportFile = required(options, "--report");
  const inventoryFile = required(options, "--inventory");
  const exitText = required(options, "--target-exit");

  if (!/^-?\d+$/u.test(exitText) || !Number.isSafeInteger(Number(exitText))) {
    throw new Error("Target exit must be an integer");
  }

  const root = path.resolve(options.get("--root") ?? process.cwd());
  const inventory = await readJson(inventoryFile);
  requireArray(inventory);
  const expected = counts(inventory.map((row) => identity(row, root)));
  const measuredFile = options.get("--measured");

  const measuredRows =
    measuredFile === undefined ? inventory : await readJson(measuredFile);

  requireArray(measuredRows);
  const measured = new Set(measuredRows.map((row) => identity(row, root)));

  if ([...measured].some((key) => !expected.has(key))) {
    throw new Error("Measured entries must identify expected cases");
  }

  const allowed = await allowances(options, expected, root);
  const report = await readJson(reportFile);
  const result = assertions(report, root, measured, allowed);

  const reasons = [
    ...result.reasons,
    ...inventoryDifferences(expected, counts(result.keys)),
    ...aggregateDifferences(report, result.statuses),
  ];

  if (Number(exitText) !== 0) {
    reasons.push({ code: "target-exit", detail: Number(exitText) });
  }

  process.stdout.write(
    `${JSON.stringify({ accepted: reasons.length === 0, actualCases: result.keys.length, expectedCases: inventory.length, reasons })}\n`
  );
  process.exitCode = reasons.length === 0 ? 0 : 1;
};

try {
  await main();
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ accepted: false, reasons: [{ code: "invalid-input", detail: error instanceof Error ? error.message : String(error) }] })}\n`
  );
  process.exitCode = 1;
}
