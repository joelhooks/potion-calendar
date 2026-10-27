import { runInNewContext } from "node:vm";

import type { ConferencingDefault } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Crypto, Effect, FileSystem, Option } from "effect";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { UserDefaultConferencing } from "../src/client/settings/conferencing/default.js";
import { ConferencingSettingsChange } from "../src/client/settings/conferencing/model.js";
import { AccountSettingsRoute } from "../src/layout/route.js";
import {
  inheritanceModel,
  inheritanceSession,
  persistInheritanceChoice,
  renderInheritanceRoot,
} from "./conferencing-inheritance-fixture.js";

const scenes = [
  "factory-none",
  "saved-meet",
  "pending-default",
  "failed-default",
  "account-inherits-meet",
  "account-none-user-meet",
  "account-meet-user-none",
  "editor-inherited-meet",
  "editor-unavailable-meet",
];

const combinations: readonly {
  readonly theme: "light" | "dark";
  readonly width: number;
}[] = [
  { theme: "light", width: 1440 },
  { theme: "dark", width: 1440 },
  { theme: "light", width: 390 },
  { theme: "dark", width: 390 },
];

interface InheritanceExport {
  readonly path: string;
  readonly scene: string;
  readonly sha256: string;
  readonly theme: string;
  readonly width: number;
}

const exported = new Map<string, readonly InheritanceExport[]>();

const proofScript = `(() => {
  const evidence = JSON.parse(document.getElementById("inheritance-evidence").textContent);
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  if (evidence.scene.startsWith("editor-")) {
    const add = document.getElementById("event-add-meet");
    require(add !== null && add.disabled, "actual editor Meet control");
    if (evidence.scene === "editor-inherited-meet") {
      require(document.body.textContent.includes("Google Meet will be created when you save."), "actual inherited proposal");
      require(document.getElementById("event-remove-conferencing") !== null, "removable proposal");
    } else {
      require(document.getElementById("event-meet-availability").textContent.includes("can't add Google Meet"), "actual capability notice");
      require(document.getElementById("event-remove-conferencing") === null, "no unavailable proposal");
    }
  } else if (evidence.scene.startsWith("account-")) {
    const select = document.getElementById("conferencing-default-work");
    require(select !== null && !select.disabled, "confirmed account control");
    require(select.value === evidence.account, "actual account override");
    if (evidence.scene === "account-inherits-meet") require(select.closest("section").textContent.includes("Your default: Google Meet."), "inheritance hint");
    if (evidence.scene === "account-none-user-meet") require(select.closest("section").textContent.includes("Do not add conferencing automatically."), "explicit None suppression");
  } else {
    const select = document.getElementById("user-default-conferencing");
    require(select !== null, "actual user control");
    require(select.value === evidence.selected, "selected user choice");
    require(select.disabled === (evidence.scene === "pending-default"), "pending selection fence");
    require(select.closest("section").textContent.includes("does not sync across devices"), "browser-local disclosure");
    if (evidence.scene === "failed-default") require(select.closest("section").querySelector('[role="alert"]').textContent.includes("previous choice is still in use"), "actual storage failure");
  }
  document.documentElement.dataset.conferencingInheritanceProof = "pass";
})();`;

it.effect.each(combinations)(
  "exports nine actual inheritance states at $width in $theme and executes their exact embedded DOM proofs",
  ({ theme, width }) =>
    Effect.gen(function* inheritanceExports() {
      const fs = yield* FileSystem.FileSystem;
      const crypto = yield* Crypto.Crypto;
      const css = yield* fs.readFileString("src/client/style.css");
      const fixtures: InheritanceExport[] = [];

      for (const scene of scenes) {
        const user: typeof UserDefaultConferencing.Type = [
          "saved-meet",
          "account-inherits-meet",
          "account-none-user-meet",
          "editor-inherited-meet",
          "editor-unavailable-meet",
        ].includes(scene)
          ? "googleMeet"
          : null;

        let account: typeof ConferencingDefault.Type = "unset";

        if (scene === "account-none-user-meet") {
          account = "none";
        } else if (scene === "account-meet-user-none") {
          account = "googleMeet";
        }

        let model = yield* inheritanceModel(
          user,
          account,
          scene !== "editor-unavailable-meet"
        );

        ({ model } = update(model, Message.MeasuredShellViewport({ width })));
        model = { ...model, settings: { ...model.settings, theme } };

        if (scene === "pending-default" || scene === "failed-default") {
          const pending = update(
            model,
            Message.ChangedConferencingSettings({
              change: ConferencingSettingsChange.cases.Default.make({
                value: "googleMeet",
              }),
              personId: Option.getOrThrow(model.person),
            })
          );

          ({ model } = pending);
          expect(model.conferencingSettings.defaultConferencing).toBeNull();

          if (scene === "failed-default") {
            const write = vi
              .spyOn(Storage.prototype, "setItem")
              .mockImplementation(() => {
                throw new Error("Fixture storage unavailable");
              });

            const failed = yield* persistInheritanceChoice(pending).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  write.mockRestore();
                })
              )
            );

            ({ model } = update(model, failed));
            expect(model.conferencingSettings.defaultConferencing).toBeNull();
            expect(Option.isSome(model.conferencingSettings.defaultError)).toBe(
              true
            );
          }
        } else if (scene.startsWith("account-")) {
          model = {
            ...model,
            route: AccountSettingsRoute.make({ accountId: "work" }),
          };
        } else if (scene.startsWith("editor-")) {
          const session = yield* inheritanceSession(model);
          yield* session.add("guest@example.test");
          model = session.get();
          expect(session.editing().draft.conferencing?.request).toEqual(
            scene === "editor-inherited-meet"
              ? { kind: "googleMeet" }
              : undefined
          );
          expect(yield* session.requests()).toEqual([]);
        }

        const rendered = yield* renderInheritanceRoot(model);

        const evidence = {
          account,
          committedDefault: model.conferencingSettings.defaultConferencing,
          mode: model.conferencingSettings.mode,
          scene,
          selected:
            scene === "pending-default" || scene === "saved-meet"
              ? "googleMeet"
              : "none",
          source:
            "Actual person preference read, root update, named storage result or live editing actor; account preference is a confirmed fixture read",
          theme,
          width,
        };

        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>User conferencing ${scene} ${theme}</title><style>${css}</style></head><body>${rendered.html}<script id="inheritance-evidence" type="application/json">${JSON.stringify(evidence).replaceAll("<", "\\u003c")}</script><script id="inheritance-proof">${proofScript}</script></body></html>`;

        const document = new DOMParser().parseFromString(html, "text/html");

        const script =
          document.querySelector("#inheritance-proof")?.textContent;

        expect(script).toBe(proofScript);
        runInNewContext(script ?? "throw new Error('Missing proof')", {
          document,
        });
        expect(
          document.documentElement.dataset.conferencingInheritanceProof
        ).toBe("pass");

        const path = `.git/conferencing-inheritance-${scene}-${theme}-${width}.html`;
        yield* fs.writeFileString(`../../${path}`, html);

        const hash = Array.from(
          yield* crypto.digest("SHA-256", new TextEncoder().encode(html)),
          (byte) => byte.toString(16).padStart(2, "0")
        ).join("");

        fixtures.push({ path, scene, sha256: hash, theme, width });
      }

      expect(fixtures).toHaveLength(9);
      exported.set(`${theme}-${width}`, fixtures);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect("collects only the 36 inheritance exports emitted by this run", () =>
  Effect.gen(function* collectInheritanceExports() {
    const fs = yield* FileSystem.FileSystem;

    expect(exported.size).toBe(4);

    const fixtures = combinations.flatMap(
      ({ theme, width }) => exported.get(`${theme}-${width}`) ?? []
    );

    expect(fixtures).toHaveLength(36);
    yield* fs.writeFileString(
      "../../.git/conferencing-inheritance-fixtures.json",
      `${JSON.stringify({ fixtures, producer: "Actual root and editor under JSDOM, not browser acceptance", proofAttribute: "data-conferencing-inheritance-proof", proofValue: "pass" }, null, 2)}\n`
    );
  }).pipe(Effect.provide(NodeServices.layer))
);
