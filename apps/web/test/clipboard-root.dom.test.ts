import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { DispatchClipboard } from "../src/client/clipboard/commands.js";
import { PrepareClipboardDialogs } from "../src/client/clipboard/dialog-mount.js";
import { clipboardGuestCount } from "../src/client/clipboard/guest-count.js";
import { ClipboardAction } from "../src/client/clipboard/runtime.js";
import { view } from "../src/features/app.js";
import { clipboardPanel } from "../src/features/clipboard.js";
import { clipboardGuestFixture } from "./clipboard-root-fixture.js";

it.each([
  [0, "0 guests"],
  [1, "1 guest"],
  [2, "2 guests"],
] as const)("guest count %s uses the correct label", (count, label) => {
  expect(clipboardGuestCount(count)).toBe(label);
});

const guestPage = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.div(
    [
      h.OnMount(
        PrepareClipboardDialogs({
          personId: "fixture-person",
          sessionId: "clipboard-connection",
        })
      ),
    ],
    [
      clipboardPanel(h, model.clipboard.view, (action) =>
        Message.ClipboardAction({
          action,
          personId: "fixture-person",
          sessionId: "clipboard-connection",
        })
      ),
    ]
  ),
  title: "Clipboard guest decision",
});

const ready = Scene.Mount.resolve(
  PrepareClipboardDialogs,
  Message.ClipboardAction({
    action: ClipboardAction.cases.DismissToast.make({ id: "absent-toast" }),
    personId: "fixture-person",
    sessionId: "clipboard-connection",
  })
);

it.effect.each(["exclude", "includeAndEmail"] as const)(
  "the mounted guest dialog explicitly labels email and sends only the chosen intent-bound action: %s",
  (choice) =>
    Effect.sync(() => {
      const model = clipboardGuestFixture();

      const action = ClipboardAction.cases.Guests.make({
        choice,
        intentId: "paste-intent",
      });

      Scene.scene(
        { update, view: guestPage },
        Scene.given(model),
        ready,
        Scene.Command.resolve(DispatchClipboard, Message.DispatchedClipboard()),
        Scene.expect(
          Scene.role("dialog", { name: "Paste event" })
        ).toContainText("They'll get an invitation email."),
        Scene.click(
          Scene.role("button", {
            name:
              choice === "exclude"
                ? "Paste without guests"
                : "Invite guests (sends email)",
          })
        ),
        Scene.Command.expectHas(
          DispatchClipboard({
            action,
            personId: "fixture-person",
            sessionId: "clipboard-connection",
          })
        ),
        Scene.Command.resolve(DispatchClipboard, Message.DispatchedClipboard())
      );
    })
);

it.effect(
  "cancel and native dialog cancellation dispatch intent-bound cancellation without an email choice",
  () =>
    Effect.sync(() => {
      const model = clipboardGuestFixture();

      const cancel = Message.ClipboardAction({
        action: ClipboardAction.cases.Cancel.make({ intentId: "paste-intent" }),
        personId: "fixture-person",
        sessionId: "clipboard-connection",
      });

      Scene.scene(
        { update, view: guestPage },
        Scene.given(model),
        ready,
        Scene.Command.resolve(DispatchClipboard, Message.DispatchedClipboard()),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.Command.expectHas(
          DispatchClipboard({
            action: cancel.action,
            personId: cancel.personId,
            sessionId: cancel.sessionId,
          })
        ),
        Scene.Command.resolve(DispatchClipboard, Message.DispatchedClipboard())
      );
      Scene.scene(
        { update, view: guestPage },
        Scene.given(model),
        Scene.Mount.resolve(PrepareClipboardDialogs, cancel),
        Scene.Command.expectHas(
          DispatchClipboard({
            action: cancel.action,
            personId: cancel.personId,
            sessionId: cancel.sessionId,
          })
        ),
        Scene.Command.resolve(DispatchClipboard, Message.DispatchedClipboard())
      );
    })
);

it.effect(
  "default submit excludes guests and incomplete lists cannot invite; the copy can still be pasted without guests",
  () =>
    Effect.gen(function* defaultGuestBoundary() {
      const model = clipboardGuestFixture(false, 0);

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const dom = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(
        dom.querySelector("#clipboard-exclude")?.getAttribute("type")
      ).toBe("submit");
      expect(
        dom.querySelector<HTMLElement>("#clipboard-guests")?.dataset
          .initialFocus
      ).toBe("clipboard-exclude");

      const invite = [...dom.querySelectorAll("button")].find(
        (button) => button.textContent === "Invite guests (sends email)"
      );

      expect(invite?.disabled).toBe(true);
      expect(dom.querySelector("#clipboard-guests")?.textContent).toContain(
        "guest list is incomplete"
      );

      const stale = update(
        model,
        Message.ClipboardAction({
          action: ClipboardAction.cases.Guests.make({
            choice: "includeAndEmail",
            intentId: "paste-intent",
          }),
          personId: "previous-person",
          sessionId: "clipboard-connection",
        })
      );

      expect(stale.commands).toBeUndefined();
      expect(Option.isSome(model.clipboard.sessionId)).toBe(true);
    })
);
