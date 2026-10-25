import type { SavedProfile } from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Option, Queue } from "effect";

import { ProfileFailure } from "../src/client/settings/profile/port.js";
import type { ProfileSaveContext } from "../src/client/settings/profile/port.js";
import { primaryAccountFixture } from "./primary-account-fixture.js";
import { profileSnapshot } from "./profile-fixture.js";
import {
  editProfileInput,
  mountProfileRuntime,
  profileButton,
  profileDomReady,
  profileRuntimeRoot,
} from "./profile-runtime-fixture.js";

const selectPrimary = (id: string) => {
  const select = Option.getOrThrow(
    Option.fromNullishOr(
      profileRuntimeRoot()?.querySelector<HTMLSelectElement>(
        "#profile-primary-account"
      )
    )
  );

  select.value = id;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

const submit = () =>
  profileRuntimeRoot()
    ?.querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

it.effect.each(["success", "failure"] as const)(
  "the real primary control and declared actor keep both drafts atomic through %s and retry",
  (outcome) =>
    Effect.gen(function* mountedPrimarySave() {
      const base = primaryAccountFixture();
      const before = profileSnapshot(base);

      const completion = yield* Deferred.make<
        typeof SavedProfile.Type,
        ProfileFailure
      >();

      const entered = yield* Queue.unbounded<{
        readonly name: string;
        readonly context: ProfileSaveContext;
      }>();

      let calls = 0;

      const runtime = yield* mountProfileRuntime(base, {
        read: Effect.succeed(before),
        save: (name, context) =>
          Effect.gen(function* mountedSavePort() {
            calls += 1;
            yield* Queue.offer(entered, { context, name });

            return calls === 1
              ? yield* Deferred.await(completion)
              : { name, primaryAccountId: context.primaryAccountId ?? null };
          }),
      });

      editProfileInput("  Both Saved  ");
      selectPrimary("personal");
      yield* profileDomReady(() => !profileButton("Update").disabled);
      const dirty = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(dirty);
      expect(dirty.defaultPrevented).toBe(true);
      submit();
      const sent = yield* Queue.take(entered);
      expect(sent).toEqual({
        context: { primaryAccountId: "personal", proof: "a".repeat(64) },
        name: "Both Saved",
      });
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()
            ?.querySelector("form")
            ?.getAttribute("aria-busy") === "true"
      );
      expect(
        profileRuntimeRoot()?.querySelector<HTMLSelectElement>(
          "#profile-primary-account"
        )?.disabled
      ).toBe(true);
      expect(profileButton("Cancel").disabled).toBe(false);
      expect(profileSnapshot(runtime.current())).toEqual(before);
      submit();
      expect(calls).toBe(1);

      yield* outcome === "failure"
        ? Deferred.fail(completion, new ProfileFailure())
        : Deferred.succeed(completion, {
            name: "Both Saved",
            primaryAccountId: "personal",
          });
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()
            ?.querySelector("form")
            ?.getAttribute("aria-busy") === "false"
      );
      expect(
        profileRuntimeRoot()?.querySelector<HTMLSelectElement>(
          "#profile-primary-account"
        )?.value
      ).toBe("personal");
      expect(
        Option.getOrUndefined(runtime.current().profile.draftPrimaryAccountId)
      ).toBe("personal");

      if (outcome === "failure") {
        expect(profileSnapshot(runtime.current())).toEqual(before);
        expect(
          profileRuntimeRoot()?.querySelector('[role="alert"]')?.textContent
        ).toContain("could not be confirmed");
        expect(profileButton("Update").disabled).toBe(false);
        submit();
        expect(yield* Queue.take(entered)).toEqual(sent);
        yield* profileDomReady(
          () =>
            profileButton("Update").disabled &&
            profileRuntimeRoot()
              ?.querySelector("form")
              ?.getAttribute("aria-busy") === "false"
        );
      }

      expect(profileSnapshot(runtime.current()).user).toMatchObject({
        email: before.user.email,
        id: before.user.id,
        name: "Both Saved",
        primaryAccountId: "personal",
      });
      expect(profileButton("Update").disabled).toBe(true);
    })
);
