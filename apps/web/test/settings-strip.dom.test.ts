import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";

import { attachSettingsStrip } from "../src/client/settings/strip.js";
import { profileFixture, profileSnapshot } from "./profile-fixture.js";
import {
  editProfileInput,
  mountProfileRuntime,
  profileDomReady,
  profileRuntimeRoot,
} from "./profile-runtime-fixture.js";

interface ScrollCall {
  readonly element: HTMLElement;
  readonly options: boolean | ScrollIntoViewOptions | undefined;
}

const scrollRecorder = (calls: ScrollCall[]) =>
  function record(
    this: HTMLElement,
    options?: boolean | ScrollIntoViewOptions
  ): void {
    calls.push({ element: this, options });
  };

const recordScroll = Effect.fn("test.recordSettingsStripScroll")(
  function* recordScroll() {
    const calls: ScrollCall[] = [];

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const descriptor = Object.getOwnPropertyDescriptor(
          HTMLElement.prototype,
          "scrollIntoView"
        );

        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: scrollRecorder(calls),
        });

        return descriptor;
      }),
      (descriptor) =>
        Effect.sync(() => {
          if (descriptor === undefined) {
            Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
          } else {
            Object.defineProperty(
              HTMLElement.prototype,
              "scrollIntoView",
              descriptor
            );
          }
        })
    );

    return calls;
  }
);

const mutationTurn = Effect.callback<boolean>((resume) => {
  queueMicrotask(() => {
    resume(Effect.succeed(true));
  });
});

const expectedOptions = {
  behavior: "instant",
  block: "nearest",
  inline: "nearest",
};

it.effect.each([390, 430])(
  "the actual phone root scrolls on settings open and page change, not unrelated profile renders at %s px",
  (width) =>
    Effect.gen(function* actualPhoneStrip() {
      const calls = yield* recordScroll();
      const base = profileFixture("pristine", width);

      const runtime = yield* mountProfileRuntime(base, {
        read: Effect.succeed(profileSnapshot(base)),
        save: Effect.succeed,
      });

      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector<HTMLDialogElement>(
            "#phone-settings-dialog"
          )?.open === true
      );
      yield* mutationTurn;
      expect(calls.map((call) => call.element.getAttribute("href"))).toEqual([
        "/settings/profile",
      ]);
      expect(calls[0]?.options).toEqual(expectedOptions);
      editProfileInput("Unrelated draft render");
      yield* profileDomReady(
        () => runtime.current().profile.mode === "editing"
      );
      yield* mutationTurn;
      editProfileInput(base.profile.savedName);
      yield* profileDomReady(
        () => runtime.current().profile.mode === "pristine"
      );
      yield* mutationTurn;
      expect(calls).toHaveLength(1);

      const conferencing = Option.getOrThrow(
        Option.fromNullishOr(
          profileRuntimeRoot()?.querySelector<HTMLAnchorElement>(
            '.settings-nav a[href="/settings/conferencing"]'
          )
        )
      );

      conferencing.click();
      yield* profileDomReady(
        () => conferencing.getAttribute("aria-current") === "page"
      );
      yield* mutationTurn;
      expect(calls.map((call) => call.element.getAttribute("href"))).toEqual([
        "/settings/profile",
        "/settings/conferencing",
      ]);
      expect(calls[1]?.options).toEqual(expectedOptions);
    })
);

it.effect.each([900, 1440])(
  "the actual desktop root leaves the settings sidebar untouched at %s px",
  (width) =>
    Effect.gen(function* desktopStripUnchanged() {
      const calls = yield* recordScroll();
      const base = profileFixture("pristine", width);

      yield* mountProfileRuntime(base, {
        read: Effect.succeed(profileSnapshot(base)),
        save: Effect.succeed,
      });

      const conferencing = Option.getOrThrow(
        Option.fromNullishOr(
          profileRuntimeRoot()?.querySelector<HTMLAnchorElement>(
            '.settings-nav a[href="/settings/conferencing"]'
          )
        )
      );

      conferencing.click();
      yield* profileDomReady(
        () => conferencing.getAttribute("aria-current") === "page"
      );
      yield* mutationTurn;
      expect(calls).toEqual([]);
      expect(
        profileRuntimeRoot()?.querySelector("#phone-settings-dialog")
      ).toBeNull();
    })
);

const History = Schema.Array(
  Schema.Literals(["open", "close", "profile", "conferencing", "unrelated"])
).check(Schema.isMinLength(1), Schema.isMaxLength(24));

it.effect.prop(
  "generated phone strip histories scroll once per open or page change, preserve focus and stop after disposal",
  { history: Arbitrary.schema(History) },
  ({ history }) =>
    Effect.gen(function* stripHistories() {
      const calls = yield* recordScroll();
      const root = document.createElement("div");
      const sheet = document.createElement("dialog");
      sheet.id = "phone-settings-dialog";
      const strip = document.createElement("nav");
      strip.className = "settings-nav";
      const focus = document.createElement("button");
      const profile = document.createElement("a");
      profile.href = "/settings/profile";
      profile.setAttribute("aria-current", "page");
      const conferencing = document.createElement("a");
      conferencing.href = "/settings/conferencing";
      conferencing.setAttribute("aria-current", "false");
      strip.append(profile, conferencing);
      sheet.append(strip);
      root.append(focus, sheet);

      const dispose = yield* Effect.acquireRelease(
        Effect.sync(() => {
          document.body.append(root);
          focus.focus();

          return attachSettingsStrip(root);
        }),
        (release) =>
          Effect.sync(() => {
            release();
            root.remove();
          })
      );

      let open = false;
      let selected = "profile";
      const expected: string[] = [];

      const steps = [
        "open",
        "conferencing",
        "unrelated",
        "close",
        "open",
        ...history,
      ];

      for (const step of steps) {
        const wasOpen = open;
        const previous = selected;

        if (step === "open" || step === "close") {
          open = step === "open";
          sheet.open = open;
        } else if (step === "unrelated") {
          focus.textContent = `${expected.length} unrelated renders`;
        } else {
          selected = step;
          profile.setAttribute(
            "aria-current",
            step === "profile" ? "page" : "false"
          );
          conferencing.setAttribute(
            "aria-current",
            step === "conferencing" ? "page" : "false"
          );
        }

        if (open && (!wasOpen || selected !== previous)) {
          expected.push(`/settings/${selected}`);
        }

        yield* mutationTurn;
        expect(
          calls.map((call) => call.element.getAttribute("href")),
          step
        ).toEqual(expected);
        expect(calls.map((call) => call.options)).toEqual(
          expected.map(() => expectedOptions)
        );
        expect(document.activeElement).toBe(focus);
      }

      dispose();
      sheet.open = false;
      yield* mutationTurn;
      sheet.open = true;
      profile.setAttribute("aria-current", "page");
      conferencing.setAttribute("aria-current", "false");
      yield* mutationTurn;
      expect(calls).toHaveLength(expected.length);
    })
);
