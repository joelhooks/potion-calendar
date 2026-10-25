import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Option, Predicate, Queue, Stream } from "effect";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppMessage } from "../src/client/app.js";
import { ProfileFailure } from "../src/client/settings/profile/port.js";
import { SettingsRoute } from "../src/layout/route.js";
import { profileFixture, profileSnapshot } from "./profile-fixture.js";
import {
  editProfileInput,
  mountProfileRuntime,
  profileButton,
  profileDomReady,
  profileInput,
  profileRuntimeRoot,
} from "./profile-runtime-fixture.js";

const nextMessage = (
  messages: Queue.Queue<AppMessage>,
  matches: (message: AppMessage) => boolean
) =>
  Stream.fromQueue(messages).pipe(
    Stream.filter(matches),
    Stream.runHead,
    Effect.map(Option.getOrThrow)
  );

const enterProfile = Effect.fn("test.enterProfile")(function* enterProfile(
  width: number
) {
  const base = profileFixture("pristine", width);

  const initial = update(
    base,
    Message.RequestedRoute({
      replace: false,
      route: SettingsRoute.make({ page: "general" }),
    })
  ).model;

  const snapshot = profileSnapshot(base);

  const runtime = yield* mountProfileRuntime(initial, {
    read: Effect.succeed({
      ...snapshot,
      user: { ...snapshot.user, name: "Persisted Person" },
    }),
    save: Effect.succeed,
  });

  const anchor = profileRuntimeRoot()?.querySelector<HTMLAnchorElement>(
    '.settings-nav a[href="/settings/profile"]'
  );

  expect(anchor).not.toBeNull();
  anchor?.click();
  yield* nextMessage(runtime.messages, (message) =>
    Predicate.isTagged(message, "ProfileCompleted")
  );
  yield* profileDomReady(
    () =>
      profileRuntimeRoot()?.querySelector<HTMLInputElement>("#profile-name")
        ?.disabled === false
  );

  return runtime;
});

it.effect.each([900, 390])(
  "the actual Profile anchor pushes once and its real read actor supplies persisted identity at %s px",
  (width) =>
    Effect.gen(function* profileAnchorRecipient() {
      const base = profileFixture("pristine", width);

      const initial = update(
        base,
        Message.RequestedRoute({
          replace: false,
          route: SettingsRoute.make({ page: "general" }),
        })
      ).model;

      const snapshot = profileSnapshot(base);

      const runtime = yield* mountProfileRuntime(initial, {
        read: Effect.succeed({
          ...snapshot,
          user: { ...snapshot.user, name: "Persisted Person" },
        }),
        save: Effect.succeed,
      });

      const push = vi.spyOn(window.history, "pushState");
      const replace = vi.spyOn(window.history, "replaceState");

      const anchor = profileRuntimeRoot()?.querySelector<HTMLAnchorElement>(
        '.settings-nav a[href="/settings/profile"]'
      );

      expect(anchor).not.toBeNull();
      anchor?.click();
      yield* nextMessage(runtime.messages, (message) =>
        Predicate.isTagged(message, "ProfileCompleted")
      );
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector<HTMLInputElement>("#profile-name")
            ?.disabled === false
      );
      expect(profileInput().value).toBe("Persisted Person");
      expect(profileSnapshot(runtime.current()).user.name).toBe(
        "Persisted Person"
      );
      expect(push.mock.calls.map((call) => call[2])).toEqual([
        "/settings/profile",
      ]);
      expect(replace).not.toHaveBeenCalled();
      expect(profileRuntimeRoot()?.querySelector("img")).toBeNull();

      if (width === 390) {
        expect(
          profileRuntimeRoot()?.querySelector<HTMLDialogElement>(
            "#phone-settings-dialog"
          )?.open
        ).toBe(true);
      }
    })
);

it.effect.each(["cancel", "settings", "back", "escape"] as const)(
  "the actual dirty %s exit opens the real discard mount before any navigation",
  (exit) =>
    Effect.gen(function* guardedNativeExit() {
      const runtime = yield* enterProfile(390);
      editProfileInput("Unsaved Person");
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector<HTMLButtonElement>(
            'button[type="submit"]'
          )?.disabled === false
      );
      const push = vi.spyOn(window.history, "pushState");
      const replace = vi.spyOn(window.history, "replaceState");

      const requestExit = () => {
        if (exit === "settings") {
          profileRuntimeRoot()
            ?.querySelector<HTMLAnchorElement>(
              '.settings-nav a[href="/settings/general"]'
            )
            ?.click();
        } else if (exit === "escape") {
          profileInput().dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "Escape",
            })
          );
        } else {
          profileButton(exit === "cancel" ? "Cancel" : "← Calendar").click();
        }
      };

      requestExit();
      yield* nextMessage(runtime.messages, (message) =>
        Predicate.isTagged(message, "ProfileDialogReady")
      );
      expect(runtime.current().profile.mode).toBe("confirming");
      expect(
        profileRuntimeRoot()?.querySelector<HTMLDialogElement>(
          "#profile-discard-dialog"
        )?.open
      ).toBe(true);
      expect(document.activeElement?.id).toBe("profile-continue");
      expect(window.location.pathname).toBe("/settings/profile");
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      profileButton("Continue editing").click();
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector("#profile-discard-dialog") ===
          null
      );
      expect(profileInput().value).toBe("Unsaved Person");
      expect(runtime.current().profile.mode).toBe("editing");
      requestExit();
      yield* nextMessage(runtime.messages, (message) =>
        Predicate.isTagged(message, "ProfileDialogReady")
      );
      profileButton("Discard").click();
      yield* nextMessage(
        runtime.messages,
        (message) =>
          Predicate.isTagged(message, "BrowserUrlChanged") &&
          message.url.pathname !== "/settings/profile"
      );
      expect(window.location.pathname).toBe(
        exit === "escape" ? "/" : "/settings/general"
      );
      expect(runtime.current().profile.mode).toBe("idle");
    })
);

it.effect.each(["success", "failure"] as const)(
  "the real save actor's %s response preserves the correct form and shared name",
  (outcome) =>
    Effect.gen(function* profileSaveRecipient() {
      const base = profileFixture();
      const completion = yield* Deferred.make<string, ProfileFailure>();
      const entered = yield* Queue.unbounded<string>();

      const runtime = yield* mountProfileRuntime(base, {
        read: Effect.succeed(profileSnapshot(base)),
        save: (name) =>
          Queue.offer(entered, name).pipe(
            Effect.andThen(Deferred.await(completion))
          ),
      });

      editProfileInput("  Submitted Person  ");
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector<HTMLButtonElement>(
            'button[type="submit"]'
          )?.disabled === false
      );
      const form = profileRuntimeRoot()?.querySelector("form");
      expect(form).not.toBeNull();
      const submit = new Event("submit", { bubbles: true, cancelable: true });
      form?.dispatchEvent(submit);
      expect(yield* Queue.take(entered)).toBe("Submitted Person");
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()
            ?.querySelector("form")
            ?.getAttribute("aria-busy") === "true"
      );
      expect(profileInput().disabled).toBe(true);
      expect(profileButton("Update").disabled).toBe(true);
      expect(profileButton("Cancel").disabled).toBe(false);
      expect(submit.defaultPrevented).toBe(true);
      profileButton("Update").click();
      expect(yield* Queue.size(entered)).toBe(0);

      yield* outcome === "failure"
        ? Deferred.fail(completion, new ProfileFailure())
        : Deferred.succeed(completion, "Submitted Person");

      yield* nextMessage(runtime.messages, (message) =>
        Predicate.isTagged(message, "ProfileCompleted")
      );
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()
            ?.querySelector("form")
            ?.getAttribute("aria-busy") === "false"
      );
      expect(profileInput().disabled).toBe(false);
      expect(profileInput().value).toBe(
        outcome === "success" ? "Submitted Person" : "  Submitted Person  "
      );
      expect(runtime.current().profile.mode).toBe(
        outcome === "success" ? "pristine" : "editing"
      );
      expect(profileSnapshot(runtime.current()).user.name).toBe(
        outcome === "success"
          ? "Submitted Person"
          : profileSnapshot(base).user.name
      );

      if (outcome === "failure") {
        expect(
          profileRuntimeRoot()?.querySelector('[role="alert"]')?.textContent
        ).toContain("changes are still here");
      }
    })
);

it.effect(
  "Cancel during a submitted save leaves without a prompt and its actual late actor result cannot update the departed page",
  () =>
    Effect.gen(function* departedSave() {
      const base = profileFixture();
      const completion = yield* Deferred.make<string, ProfileFailure>();
      const entered = yield* Queue.unbounded<string>();

      const runtime = yield* mountProfileRuntime(base, {
        read: Effect.succeed(profileSnapshot(base)),
        save: (name) =>
          Queue.offer(entered, name).pipe(
            Effect.andThen(Deferred.await(completion))
          ),
      });

      editProfileInput("Submitted Person");
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector<HTMLButtonElement>(
            'button[type="submit"]'
          )?.disabled === false
      );
      profileRuntimeRoot()
        ?.querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        );
      yield* Queue.take(entered);
      profileButton("Cancel").click();
      yield* nextMessage(
        runtime.messages,
        (message) =>
          Predicate.isTagged(message, "BrowserUrlChanged") &&
          message.url.pathname !== "/settings/profile"
      );
      expect(
        profileRuntimeRoot()?.querySelector("#profile-discard-dialog")
      ).toBeNull();
      yield* Deferred.succeed(completion, "Submitted Person");
      yield* nextMessage(runtime.messages, (message) =>
        Predicate.isTagged(message, "ProfileCompleted")
      );
      expect(runtime.current().profile.mode).toBe("idle");
      expect(profileSnapshot(runtime.current()).user.name).toBe(
        profileSnapshot(base).user.name
      );
    })
);

it.effect(
  "the actual dirty subscription installs a synchronous unload guard and removes it after saving",
  () =>
    Effect.gen(function* dirtyUnloadOwner() {
      const enabled = yield* Queue.unbounded<true>();
      const removed = yield* Queue.unbounded<true>();
      const originalAdd = window.addEventListener.bind(window);
      const originalRemove = window.removeEventListener.bind(window);
      vi.spyOn(window, "addEventListener").mockImplementation(
        (type, listener, options) => {
          originalAdd(type, listener, options);

          if (type === "beforeunload") {
            Queue.offerUnsafe(enabled, true);
          }
        }
      );
      vi.spyOn(window, "removeEventListener").mockImplementation(
        (type, listener, options) => {
          originalRemove(type, listener, options);

          if (type === "beforeunload") {
            Queue.offerUnsafe(removed, true);
          }
        }
      );
      const base = profileFixture();

      const runtime = yield* mountProfileRuntime(base, {
        read: Effect.succeed(profileSnapshot(base)),
        save: Effect.succeed,
      });

      const pristine = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(pristine);
      expect(pristine.defaultPrevented).toBe(false);
      editProfileInput("Saved Person");
      yield* Queue.take(enabled);
      const dirty = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(dirty);
      expect(dirty.defaultPrevented).toBe(true);
      profileRuntimeRoot()
        ?.querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        );
      yield* Queue.take(removed);
      yield* nextMessage(runtime.messages, (message) =>
        Predicate.isTagged(message, "ProfileCompleted")
      );
      const saved = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(saved);
      expect(saved.defaultPrevented).toBe(false);
      expect(runtime.current().profile.mode).toBe("pristine");
    })
);
