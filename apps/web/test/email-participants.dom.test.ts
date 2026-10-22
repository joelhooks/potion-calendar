import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import type { AppModel, AppMessage } from "../src/client/app.js";
import { Message, update } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { selectedParticipantEmail } from "../src/client/email-participants.js";
import { observeKeyboard } from "../src/client/keyboard/input.js";
import { keyboardRegistry } from "../src/client/keyboard/registry.js";
import { FollowRouteRequest } from "../src/client/routing.js";
import { view } from "../src/features/app.js";
import { detailPanel } from "../src/features/calendar.js";
import { emailFixture, emailScenes } from "./email-participants-fixture.js";
import {
  hiddenParticipantProofScript,
  participantProofScript,
  prepareParticipantProofWithStandInBoxes,
} from "./email-participants-proof.js";

const detailsView = (model: AppModel, h: HtmlBuilder<AppMessage>) =>
  h.div([], detailPanel(model, h));

const press = (
  model: ReturnType<typeof emailFixture>,
  now: number
): ReturnType<typeof update> =>
  Option.match(
    observeKeyboard(
      model,
      new KeyboardEvent("keydown", {
        cancelable: true,
        code: "KeyE",
        key: "e",
      }),
      now
    ),
    {
      onNone: () => ({ model }),
      onSome: (message) => update(model, message),
    }
  );

it.effect(
  "the actual details button dispatches the safe external workflow, while hidden/solo/omitted native sequences stay inert",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update, view: detailsView },
        Scene.given(emailFixture("button")),
        Scene.click(Scene.role("button", { name: "Email participants" })),
        Scene.Command.expectHas(FollowRouteRequest),
        Scene.Command.resolve(FollowRouteRequest, Message.Navigated())
      );

      for (const scene of ["hidden", "solo", "omitted"] as const) {
        const before = emailFixture(scene);
        const first = press(before, 100);
        const second = press(first.model, 101);
        expect(second.commands ?? []).toEqual([]);
        expect(second.model.calendar).toEqual(before.calendar);
        expect(second.model.editing).toEqual(before.editing);
        expect(selectedParticipantEmail(before).kind).toBe("disabled");
      }
    })
);

it.effect(
  "exports twenty actual-root mail workflow scenes and checks each exact proof with labelled stand-in geometry",
  () =>
    Effect.gen(function* emailArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const action = keyboardRegistry.find(
        (row) => row.id === "email-participants"
      );

      for (const scene of emailScenes) {
        const base = emailFixture(scene);
        const direct = update(base, Message.RequestedEmailParticipants());
        const keyed = press(press(base, 100).model, 101);

        const href = (result: typeof direct) => {
          const command = result.commands?.find(
            (item) => item.name === "FollowRouteRequest"
          );

          return command === undefined
            ? null
            : Option.match(
                Schema.decodeUnknownOption(
                  Schema.Struct({
                    request: Schema.TaggedStruct("External", {
                      href: Schema.String,
                    }),
                  })
                )(command.args),
                { onNone: () => null, onSome: (value) => value.request.href }
              );
        };

        const [source] = Option.getOrThrow(
          AsyncData.getData(
            Option.getOrThrow(Option.fromUndefinedOr(base.calendar.reads[0]))
              .events
          )
        ).events;

        const session = Option.getOrThrow(
          Option.fromNullishOr(
            Option.getOrThrow(AsyncData.getData(base.session))
          )
        );

        const evidence = {
          availability: action?.availability(base),
          commands:
            (scene === "keyboard" ? keyed : direct).commands?.map(
              (command) => command.name
            ) ?? [],
          directHref: href(direct),
          identity: session.user.email,
          keyHref: href(keyed),
          loaded: base.calendar.reads.some((read) =>
            AsyncData.isSuccess(read.events)
          ),
          navigated: false,
          ownEmails: session.accounts.map((account) => account.email),
          person: Option.getOrUndefined(base.person),
          scene,
          selected: base.calendar.selected,
          source,
        };

        for (const width of [1440, 900]) {
          for (const theme of ["light", "dark"] as const) {
            const model = {
              ...base,
              calendar: {
                ...base.calendar,
                viewport: 844,
                viewportWidth: width - (width === 900 ? 445 : 520),
              },
              settings: { ...base.settings, theme },
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const payload = JSON.stringify(evidence).replaceAll("<", "\\u003c");
            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x960"><title>${scene} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="participant-evidence">${payload}</script><script data-participant-proof>${scene === "hidden" ? hiddenParticipantProofScript : participantProofScript}</script></body></html>`;
            const path = `../../.git/email-participants-${scene}-${theme}-${width}-fixture.html`;
            yield* fs.writeFileString(path, html);
            const exported = yield* fs.readFileString(path);

            const prove = prepareParticipantProofWithStandInBoxes(
              exported,
              width
            );

            const document = prove();
            expect(document.documentElement.dataset.participantEmailProof).toBe(
              "pass"
            );

            const precondition = document.querySelector(
              "#participant-evidence"
            );

            if (precondition === null || precondition.textContent === null) {
              throw new Error("Missing exported participant precondition");
            }

            const original = precondition.textContent;
            precondition.textContent = original.replace(
              '"loaded":true',
              '"loaded":false'
            );

            try {
              expect(() => prove()).toThrow(
                "Missing identity and loaded source preconditions"
              );
              expect(
                document.documentElement.dataset.participantEmailProof
              ).toBeUndefined();
            } finally {
              precondition.textContent = original;
            }

            expect(() => prove("button")).toThrow(
              "Participant button is clipped"
            );

            if (scene === "hidden" || scene === "omitted") {
              expect(() => prove("reason")).toThrow(
                "Participant refusal reason is clipped"
              );
            }

            expect(
              document.documentElement.dataset.participantEmailProof
            ).toBeUndefined();
          }
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect(
  "refusal copy and disabled command rows render without opening a mail workflow",
  () =>
    Effect.gen(function* participantRefusalSurfaces() {
      for (const scene of ["hidden", "solo", "omitted"] as const) {
        const base = emailFixture(scene);

        const model = {
          ...base,
          keyboard: {
            ...base.keyboard,
            query: "Email participants",
            screen: "commands" as const,
          },
        };

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const document = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        expect(
          document
            .querySelector("#command-email-participants")
            ?.getAttribute("disabled")
        ).not.toBeNull();
        expect(
          document
            .querySelector("#command-email-participants")
            ?.getAttribute("aria-disabled")
        ).toBe("true");
        const paragraph = document.querySelector(".email-participants p");
        expect(paragraph?.textContent).toBe(
          {
            hidden: "The organizer has hidden the guest list.",
            omitted: "Google didn't send the full guest list.",
            solo: undefined,
          }[scene]
        );
      }

      const base = emailFixture("button");

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          reads: base.calendar.reads.map((read) => {
            const data = Option.getOrThrow(AsyncData.getData(read.events));

            return {
              ...read,
              events: RemoteEvents.Success({
                data: {
                  ...data,
                  events: data.events.map((event) => ({
                    ...event,
                    title: "x".repeat(2001),
                  })),
                },
              }),
            };
          }),
        },
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(document.querySelector(".email-participants p")?.textContent).toBe(
        "Too many guests to email from here."
      );
      expect(
        document
          .querySelector(".email-participants button")
          ?.getAttribute("disabled")
      ).not.toBeNull();
      expect(press(press(model, 100).model, 101).commands ?? []).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect(
  "the mail action does not hide pre-existing attendee presentation on non-default sources",
  () =>
    Effect.gen(function* preservedParticipantPresentation() {
      for (const eventType of ["fromGmail"] as const) {
        const base = emailFixture("button");

        const model = {
          ...base,
          calendar: {
            ...base.calendar,
            reads: base.calendar.reads.map((read) => {
              const data = Option.getOrThrow(AsyncData.getData(read.events));

              return {
                ...read,
                events: RemoteEvents.Success({
                  data: {
                    ...data,
                    events: data.events.map((event) => ({
                      ...event,
                      eventType,
                    })),
                  },
                }),
              };
            }),
          },
        };

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const document = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        expect(document.querySelector(".detail-panel")?.textContent).toContain(
          "Attendees"
        );
        expect(document.querySelector(".detail-panel")?.textContent).toContain(
          "Casey"
        );
        expect(
          document
            .querySelector(".email-participants button")
            ?.getAttribute("disabled")
        ).not.toBeNull();
      }
    })
);
