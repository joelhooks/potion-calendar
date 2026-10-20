import { Effect, Option, Schema } from "effect";
import { Command, Mount, Render } from "foldkit";

import { Message } from "../message.js";
import { CalendarSearchClient, SearchPrefetch } from "./client.js";

const focusInput = (root: ParentNode): void => {
  root
    .querySelector<HTMLInputElement>("#search-query")
    ?.focus({ preventScroll: true });
};

const restoreScroll = (
  root: ParentNode,
  position: Option.Option<number>
): void => {
  const viewport = root.querySelector<HTMLElement>("#search-results");
  const today = viewport?.querySelector<HTMLElement>("#search-today");

  if (viewport !== null) {
    viewport.scrollTop = Option.isSome(position)
      ? position.value
      : Math.max(
          0,
          (today?.offsetTop ?? viewport.offsetTop) - viewport.offsetTop
        );
  }
};

export const PrepareSearch = Mount.define("PrepareSearch", {
  args: { position: Schema.Option(Schema.Finite) },
  execute: ({ element, position }) =>
    Effect.sync(() => {
      focusInput(element);
      restoreScroll(element, position);

      return Message.Navigated();
    }),
  messages: [Message.Navigated],
});

export const FocusSearch = Command.define("FocusSearch", {
  execute: Effect.gen(function* focusSearch() {
    yield* Render.afterCommit;

    return yield* Effect.sync(() => {
      focusInput(document);

      return Message.Navigated();
    });
  }),
  messages: [Message.Navigated],
});

export const BlurSearch = Command.define("BlurSearch", {
  execute: Effect.sync(() => {
    document.querySelector<HTMLInputElement>("#search-query")?.blur();

    return Message.Navigated();
  }),
  messages: [Message.Navigated],
});

export const RestoreSearchScroll = Command.define("RestoreSearchScroll", {
  args: { position: Schema.Option(Schema.Finite) },
  execute: ({ position }) =>
    Effect.gen(function* restoreSearchScroll() {
      yield* Render.afterCommit;

      return yield* Effect.sync(() => {
        restoreScroll(document, position);

        return Message.Navigated();
      });
    }),
  messages: [Message.Navigated],
});

export const PrefetchSearchDate = Command.define("PrefetchSearchDate", {
  args: {
    personId: Schema.String,
    prefetch: SearchPrefetch,
    revision: Schema.Int,
  },
  execute: ({ prefetch, personId, revision }) =>
    CalendarSearchClient.use((client) => client.prefetch(prefetch)).pipe(
      Effect.match({
        onFailure: (problem) =>
          Message.SearchPrefetchFailed({ personId, problem, revision }),
        onSuccess: () => Message.Navigated(),
      })
    ),
  messages: [Message.SearchPrefetchFailed, Message.Navigated],
});
