import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Effect, FileSystem, Ref } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { createTypeLabels } from "../src/client/editing/create-type-choices.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { projectEditor } from "../src/client/editing/editor-machine.js";
import { currentConversion } from "../src/client/editing/editor-model.js";
import { view } from "../src/features/app.js";
import {
  commandTypeActor,
  commandTypeFixture,
} from "./command-type-fixture.js";
import {
  commandTypeProof,
  executeCommandTypeProofWithStandInBoxes,
} from "./command-type-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

for (const source of ["default", "focusTime", "outOfOffice"] as const) {
  for (const size of [
    { theme: "light", width: 1440 },
    { theme: "dark", width: 900 },
  ] as const) {
    it.effect(
      `exports Type ${source} menu, conversion and Undo at ${size.width} ${size.theme}`,
      () =>
        Effect.gen(function* commandTypeExports() {
          const { actor, writes } = yield* commandTypeActor();

          if (source !== "default") {
            yield* send(actor, {
              action: EditorAction.cases.EventTypeSelected.make({
                value: source,
              }),
              type: "ACTION",
            });
            yield* waitFor(
              actor,
              (snapshot) =>
                snapshot.matches("editing") &&
                snapshot.context.session?.draft.eventType === source
            ).pipe(Effect.orDie);
          }

          const beforeDraft = actor.getSnapshot().context.session?.draft;
          const before = projectEditor(actor.getSnapshot());

          const menu = update(
            commandTypeFixture(before, size.theme),
            Message.KeyboardAction({ id: "event-type" })
          ).model;

          const target = (
            {
              default: "focusTime",
              focusTime: "outOfOffice",
              outOfOffice: "default",
            } as const
          )[source];

          const sessionId = actor.getSnapshot().context.session?.id;
          expect(sessionId).toBeDefined();

          if (sessionId === undefined) {
            return;
          }

          yield* send(actor, {
            action: EditorAction.cases.ConvertType.make({
              sessionId,
              value: target,
            }),
            type: "ACTION",
          });
          yield* waitFor(
            actor,
            (snapshot) =>
              snapshot.matches("editing") &&
              snapshot.context.session?.draft.eventType === target &&
              snapshot.context.conversion !== undefined
          ).pipe(Effect.orDie);
          const converted = projectEditor(actor.getSnapshot());
          const receipt = currentConversion(converted);
          expect(receipt).toBeDefined();

          if (receipt === undefined) {
            return;
          }

          yield* send(actor, {
            action: EditorAction.cases.UndoConversion.make({ id: receipt.id }),
            type: "ACTION",
          });
          yield* waitFor(
            actor,
            (snapshot) =>
              snapshot.matches("editing") &&
              snapshot.context.conversion === undefined
          ).pipe(Effect.orDie);
          const restored = projectEditor(actor.getSnapshot());
          expect(restored).toMatchObject({ draft: beforeDraft });
          expect(yield* Ref.get(writes)).toEqual([]);
          const fs = yield* FileSystem.FileSystem;
          const css = yield* fs.readFileString("src/client/style.css");

          for (const stage of ["menu", "converted", "restored"] as const) {
            const base =
              stage === "menu"
                ? menu
                : commandTypeFixture(
                    stage === "converted" ? converted : restored,
                    size.theme
                  );

            const model = {
              ...base,
              calendar: {
                ...base.calendar,
                viewport: 755,
                viewportWidth: size.width - 245,
              },
              keyboard: {
                ...base.keyboard,
                screen:
                  stage === "menu"
                    ? ("event-type" as const)
                    : ("closed" as const),
              },
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const root = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            expect(root.querySelector("[data-conversion-undo]") !== null).toBe(
              stage === "converted"
            );

            if (stage === "menu") {
              expect(
                root.querySelectorAll('button[id^="command-type-"]')
              ).toHaveLength(2);
              expect(root.querySelector(`#command-type-${source}`)).toBeNull();
            }

            const evidence = {
              ...size,
              label: createTypeLabels[target],
              source,
              stage,
              target,
            };

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${size.width}x900"><title>Type ${source} ${stage}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="command-type-evidence">${JSON.stringify(evidence)}</script><script data-command-type-proof>${commandTypeProof}</script></body></html>`;

            const proofDocument = new DOMParser().parseFromString(
              html,
              "text/html"
            );

            executeCommandTypeProofWithStandInBoxes(
              proofDocument,
              size.width,
              900
            );
            expect(proofDocument.documentElement.dataset.commandTypeProof).toBe(
              "pass"
            );

            if (stage !== "menu") {
              expect(
                proofDocument
                  .querySelector("#event-editor-dialog")
                  ?.hasAttribute("open"),
                "converted and restored proofs must open the real editor"
              ).toBe(true);
            }

            if (stage !== "menu") {
              const wrongTypeDocument = new DOMParser().parseFromString(
                html,
                "text/html"
              );

              const type =
                wrongTypeDocument.querySelector<HTMLSelectElement>(
                  "#event-type"
                );

              expect(type).not.toBeNull();

              if (type !== null) {
                const expected = stage === "converted" ? target : source;
                type.value = expected === "default" ? "focusTime" : "default";
              }

              expect(() => {
                executeCommandTypeProofWithStandInBoxes(
                  wrongTypeDocument,
                  size.width,
                  900
                );
              }, "both converted and restored proofs reject the wrong draft type").toThrow(
                "Creation draft type is wrong"
              );
            }

            const path = `../../.git/command-type-${source}-${stage}-${size.theme}-${size.width}-fixture.html`;
            yield* publishFixtureArtifact(path, html);
            expect(yield* fs.readFileString(path)).toBe(html);
          }
        }).pipe(Effect.provide(NodeServices.layer))
    );
  }
}
