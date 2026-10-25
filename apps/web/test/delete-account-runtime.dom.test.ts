import { AccountDeletionUnavailable } from "@calendar/core/contracts";
import type { SessionSnapshot } from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Option,
  Predicate,
  Queue,
  Ref,
  Stream,
} from "effect";
import { vi } from "vitest";

import type { AppMessage, AppModel } from "../src/client/app.js";
import type { AccountDeletionPortService } from "../src/client/settings/delete-account/port.js";
import {
  deleteAccountFixture,
  otherDeleteSession,
} from "./delete-account-fixture.js";
import { profileSnapshot } from "./profile-fixture.js";
import {
  mountProfileRuntime,
  profileDomReady,
  profileRuntimeRoot,
} from "./profile-runtime-fixture.js";

const isDeletionCompleted = (message: AppMessage) =>
  Predicate.isTagged(message, "AccountDeletionCompleted");

const isSessionReceived = (message: AppMessage) =>
  Predicate.isTagged(message, "ReceivedSession");

const deletionButton = (id: string) =>
  Option.getOrThrow(
    Option.fromNullishOr(
      profileRuntimeRoot()?.querySelector<HTMLButtonElement>(
        `#delete-account-${id}`
      )
    )
  );

const deletionDialog = () =>
  Option.getOrThrow(
    Option.fromNullishOr(
      profileRuntimeRoot()?.querySelector<HTMLDialogElement>(
        "#delete-account-dialog"
      )
    )
  );

const nextDeletionMessage = (
  messages: Queue.Queue<AppMessage>,
  matches: (message: AppMessage) => boolean
) =>
  Stream.fromQueue(messages).pipe(
    Stream.filter(matches),
    Stream.runHead,
    Effect.map(Option.getOrThrow)
  );

const mountDeletionRuntime = Effect.fn("test.mountDeletionRuntime")(
  function* mountDeletionRuntime(
    initial: AppModel,
    port?: AccountDeletionPortService
  ) {
    const session = yield* Ref.make<typeof SessionSnapshot.Type>(
      profileSnapshot(initial)
    );

    const runtime = yield* mountProfileRuntime(
      initial,
      {
        read: Ref.get(session),
        save: () => Effect.die("Deletion must not write a profile name"),
      },
      port
    );

    return { ...runtime, session };
  }
);

const heldDeletion = Effect.gen(function* heldDeletion() {
  const first = yield* Deferred.make<boolean, AccountDeletionUnavailable>();
  const second = yield* Deferred.make<boolean, AccountDeletionUnavailable>();
  const entered = yield* Queue.unbounded<string>();
  const calls: string[] = [];

  const port: AccountDeletionPortService = {
    remove: Effect.fn("test.heldAccountDeletion")(function* remove(
      proof: string
    ) {
      const result = calls.length === 0 ? first : second;
      calls.push(proof);
      yield* Queue.offer(entered, proof);
      yield* Deferred.await(result);
    }),
  };

  return { calls, entered, first, port, second };
});

const seedDeletionStorage = Effect.fn("test.seedDeletionStorage")(
  function* seedDeletionStorage(first: string, second = "other-person") {
    const entries = [
      [`calendar.visibility.${first}`, "first preferences"],
      [`calendar.reminder-snoozes.v1.${first}`, "first snoozes"],
      [`calendar.visibility.${second}`, "second preferences"],
      [`calendar.reminder-snoozes.v1.${second}`, "second snoozes"],
      ["calendar.unrelated-deletion-fixture", "unrelated value"],
    ] as const;

    const previous = entries.map(
      ([key]) => [key, localStorage.getItem(key)] as const
    );

    for (const [key, value] of entries) {
      localStorage.setItem(key, value);
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const [key, value] of previous) {
          if (value === null) {
            localStorage.removeItem(key);
          } else {
            localStorage.setItem(key, value);
          }
        }
      })
    );

    return {
      firstPreferences: entries[0][0],
      firstSnoozes: entries[1][0],
      secondPreferences: entries[2][0],
      secondSnoozes: entries[3][0],
      unrelated: entries[4][0],
    };
  }
);

const openDeletion = Effect.gen(function* openDeletion() {
  deletionButton("open").click();
  yield* profileDomReady(
    () =>
      profileRuntimeRoot()?.querySelector<HTMLDialogElement>(
        "#delete-account-dialog"
      )?.open === true
  );
});

it.effect.each([900, 390])(
  "the %s root mounts a separate informed confirmation, focuses Cancel and shields its Escape from the settings sheet",
  (width) =>
    Effect.gen(function* cancelDeletionDialog() {
      const initial = deleteAccountFixture("section", width);
      const runtime = yield* mountDeletionRuntime(initial);
      expect(deletionButton("open").closest("form")).toBeNull();
      yield* openDeletion;
      expect(document.activeElement).toBe(deletionButton("cancel"));
      const dialog = deletionDialog();
      expect(dialog.getAttribute("aria-describedby")).toBe(
        "delete-account-retention"
      );
      expect(dialog.textContent).toContain(
        "Calendars and contacts stored with Google are not deleted."
      );
      expect(dialog.textContent).toContain(
        "Potion Calendar will still appear in your Google account's third-party access list until you remove it there."
      );
      let escaped = 0;

      const outerEscape = () => {
        escaped += 1;
      };

      window.addEventListener("keydown", outerEscape);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          window.removeEventListener("keydown", outerEscape);
        })
      );
      deletionButton("cancel").dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
      );
      expect(escaped).toBe(0);
      const cancel = new Event("cancel", { cancelable: true });
      dialog.dispatchEvent(cancel);
      expect(cancel.defaultPrevented).toBe(true);
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector("#delete-account-dialog") === null
      );
      expect(runtime.current().accountDeletion.mode).toBe("closed");
      expect(runtime.current().route).toEqual(initial.route);

      if (width === 390) {
        expect(
          profileRuntimeRoot()?.querySelector<HTMLDialogElement>(
            "#phone-settings-dialog"
          )?.open
        ).toBe(true);
      }
    })
);

it.effect(
  "the real declared Command admits once, disables both controls, ignores pending Escape and permits an explicit failure retry",
  () =>
    Effect.gen(function* deletionFailureAndRetry() {
      const initial = deleteAccountFixture();
      const held = yield* heldDeletion;
      const runtime = yield* mountDeletionRuntime(initial, held.port);

      const keys = yield* seedDeletionStorage(
        Option.getOrThrow(initial.person)
      );

      yield* openDeletion;
      deletionButton("confirm").click();
      expect(yield* Queue.take(held.entered)).toBe(
        profileSnapshot(initial).accountDeletionProof
      );
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector<HTMLButtonElement>(
            "#delete-account-confirm"
          )?.disabled === true
      );
      const { sequence } = runtime.current().accountDeletion;
      expect(deletionButton("cancel").disabled).toBe(true);
      expect(deletionButton("confirm").textContent).toBe("Deleting…");
      deletionButton("confirm").click();
      deletionButton("cancel").click();
      const cancel = new Event("cancel", { cancelable: true });
      deletionDialog().dispatchEvent(cancel);
      yield* nextDeletionMessage(
        runtime.messages,
        (message) =>
          Predicate.isTagged(message, "ChangedAccountDeletion") &&
          Predicate.isTagged(message.change, "Cancel")
      );
      expect(cancel.defaultPrevented).toBe(true);
      expect(runtime.current().accountDeletion.sequence).toBe(sequence);
      expect(runtime.current().accountDeletion.mode).toBe("deleting");
      expect(held.calls).toHaveLength(1);
      yield* Deferred.fail(held.first, new AccountDeletionUnavailable());
      yield* nextDeletionMessage(runtime.messages, isDeletionCompleted);
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector("#delete-account-error")
            ?.isConnected === true
      );
      expect(
        Option.contains(
          runtime.current().person,
          Option.getOrThrow(initial.person)
        )
      ).toBe(true);
      expect(deletionButton("confirm").disabled).toBe(false);
      expect(localStorage.getItem(keys.firstPreferences)).toBe(
        "first preferences"
      );
      expect(localStorage.getItem(keys.firstSnoozes)).toBe("first snoozes");
      deletionButton("confirm").click();
      yield* Queue.take(held.entered);
      expect(held.calls).toHaveLength(2);
      expect(runtime.current().accountDeletion.sequence).toBeGreaterThan(
        sequence
      );
      yield* Deferred.succeed(held.second, true);
      yield* nextDeletionMessage(runtime.messages, isDeletionCompleted);
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector("#account-deleted-notice")
            ?.textContent === "Your account was deleted."
      );
    })
);

it.effect(
  "successful deletion clears only A's two keys and renders the signed-out notice through the actual root",
  () =>
    Effect.gen(function* scopedBrowserCleanup() {
      const initial = deleteAccountFixture();
      const held = yield* heldDeletion;
      const runtime = yield* mountDeletionRuntime(initial, held.port);

      const keys = yield* seedDeletionStorage(
        Option.getOrThrow(initial.person)
      );

      yield* openDeletion;
      deletionButton("confirm").click();
      yield* Queue.take(held.entered);
      yield* Deferred.succeed(held.first, true);
      yield* nextDeletionMessage(runtime.messages, isDeletionCompleted);
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector("#account-deleted-notice")
            ?.isConnected === true
      );
      expect(Option.isNone(runtime.current().person)).toBe(true);
      expect(localStorage.getItem(keys.firstPreferences)).toBeNull();
      expect(localStorage.getItem(keys.firstSnoozes)).toBeNull();
      expect(localStorage.getItem(keys.secondPreferences)).toBe(
        "second preferences"
      );
      expect(localStorage.getItem(keys.secondSnoozes)).toBe("second snoozes");
      expect(localStorage.getItem(keys.unrelated)).toBe("unrelated value");
    })
);

it.effect(
  "unavailable browser storage cannot turn an acknowledged deletion into an error",
  () =>
    Effect.gen(function* unavailableBrowserCleanup() {
      const initial = deleteAccountFixture();
      const held = yield* heldDeletion;
      const runtime = yield* mountDeletionRuntime(initial, held.port);

      const keys = yield* seedDeletionStorage(
        Option.getOrThrow(initial.person)
      );

      const original = Storage.prototype.removeItem.bind(localStorage);

      const denied = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation((key: string): void => {
          if (key === keys.firstPreferences || key === keys.firstSnoozes) {
            throw new DOMException(
              "Local fixture storage is unavailable",
              "SecurityError"
            );
          }

          original(key);
        });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          denied.mockRestore();
        })
      );
      yield* openDeletion;
      deletionButton("confirm").click();
      yield* Queue.take(held.entered);
      yield* Deferred.succeed(held.first, true);
      yield* nextDeletionMessage(runtime.messages, isDeletionCompleted);
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector("#account-deleted-notice")
            ?.isConnected === true
      );
      expect(runtime.current().accountDeletion.mode).toBe("deleted");
      expect(Option.isNone(runtime.current().person)).toBe(true);
      expect(localStorage.getItem(keys.secondPreferences)).toBe(
        "second preferences"
      );
    })
);

it.effect(
  "a session-null notice before the deletion reply does not lose the admitted completion",
  () =>
    Effect.gen(function* sessionInvalidatedFirst() {
      const initial = deleteAccountFixture();
      const held = yield* heldDeletion;
      const runtime = yield* mountDeletionRuntime(initial, held.port);
      yield* openDeletion;
      deletionButton("confirm").click();
      yield* Queue.take(held.entered);
      yield* Ref.set(runtime.session, null);
      yield* runtime.receiveSession(null);
      yield* nextDeletionMessage(runtime.messages, isSessionReceived);
      expect(Option.isNone(runtime.current().person)).toBe(true);
      expect(runtime.current().accountDeletion.mode).toBe("deleting");
      yield* Deferred.succeed(held.first, true);
      yield* nextDeletionMessage(runtime.messages, isDeletionCompleted);
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector("#account-deleted-notice")
            ?.isConnected === true
      );
    })
);

it.effect(
  "A's late acknowledged reply cannot sign B out or clear B's browser keys",
  () =>
    Effect.gen(function* switchedBrowserPerson() {
      const initial = deleteAccountFixture();
      const held = yield* heldDeletion;
      const runtime = yield* mountDeletionRuntime(initial, held.port);
      const other = otherDeleteSession(initial);

      const keys = yield* seedDeletionStorage(
        Option.getOrThrow(initial.person),
        other.user.id
      );

      yield* openDeletion;
      deletionButton("confirm").click();
      yield* Queue.take(held.entered);
      yield* Ref.set(runtime.session, other);
      yield* runtime.receiveSession(other);
      yield* nextDeletionMessage(runtime.messages, isSessionReceived);
      yield* profileDomReady(
        () =>
          profileRuntimeRoot()?.querySelector("#delete-account-dialog") === null
      );
      yield* Deferred.succeed(held.first, true);
      yield* nextDeletionMessage(runtime.messages, isDeletionCompleted);
      expect(Option.contains(runtime.current().person, other.user.id)).toBe(
        true
      );
      expect(profileSnapshot(runtime.current()).user.id).toBe(other.user.id);
      expect(runtime.current().accountDeletion.mode).toBe("closed");
      expect(
        profileRuntimeRoot()?.querySelector("#account-deleted-notice")
      ).toBeNull();
      expect(localStorage.getItem(keys.firstPreferences)).toBeNull();
      expect(localStorage.getItem(keys.secondPreferences)).toBe(
        "second preferences"
      );
      expect(localStorage.getItem(keys.secondSnoozes)).toBe("second snoozes");
      expect(held.calls).toEqual([
        profileSnapshot(initial).accountDeletionProof,
      ]);
    })
);
