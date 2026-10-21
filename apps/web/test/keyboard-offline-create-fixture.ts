import { Effect, Option, Ref } from "effect";
import { vi } from "vitest";

import { update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import type { EditingCommand } from "../src/client/editing/runtime.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { observeKeyboard } from "../src/client/keyboard/input.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

export const offlineKeyboardFixture = Effect.fn("offlineKeyboardFixture")(
  function* offlineKeyboardFixture(initial: AppModel = keyboardFixture()) {
    const online = vi.spyOn(navigator, "onLine", "get");
    const platform = vi.spyOn(navigator, "platform", "get");
    const host = document.createElement("main");
    const input = document.createElement("input");
    const dialog = document.createElement("dialog");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");

    editable.setAttribute("contenteditable", "true");
    input.value = "Existing title";
    textarea.value = "Existing description";
    host.append(input, dialog, textarea, editable);
    document.body.append(host);
    online.mockReturnValue(true);
    platform.mockReturnValue("Win32");

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        online.mockRestore();
        platform.mockRestore();
        host.remove();
      })
    );

    const state = yield* Ref.make(initial);

    const dispatched = yield* Ref.make<
      readonly {
        readonly command: typeof EditingCommand.Type;
        readonly personId: string;
      }[]
    >([]);

    const runtime = EditingRuntime.of({
      connect: () =>
        Effect.die("Native key seam must not connect editor actors"),
      dispatch: (personId, command) =>
        Ref.update(dispatched, (previous) => [
          ...previous,
          { command, personId },
        ]),
    });

    const press = Effect.fn("pressOfflineKeyboard")(function* press(
      init: KeyboardEventInit,
      target: HTMLElement = host
    ) {
      const before = yield* Ref.get(state);

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });

      const received: AppMessage[] = [];

      const listener = (native: KeyboardEvent) => {
        const message = observeKeyboard(before, native, before.calendar.now);

        if (Option.isSome(message)) {
          received.push(message.value);
        }
      };

      target.addEventListener("keydown", listener, { once: true });
      target.dispatchEvent(event);

      const message = Option.fromUndefinedOr(received[0]);

      const result = Option.isSome(message)
        ? update(before, message.value)
        : { commands: [], model: before };

      yield* Ref.set(state, result.model);

      for (const command of result.commands ?? []) {
        yield* command.effect.pipe(
          Effect.provide(unusedBrowserLayers),
          Effect.provideService(CalendarSearchClient, unexpectedSearchClient),
          Effect.provideService(EditingRuntime, runtime)
        );
      }

      return { before, event, message, result };
    });

    return {
      dialog,
      dispatched,
      editable,
      host,
      input,
      online,
      platform,
      press,
      state,
      textarea,
    };
  }
);
