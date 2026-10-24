import { Effect, Option, Schema } from "effect";
import { Command, Mount, Render } from "foldkit";

import { Message } from "../message.js";
import { CalendarSearchClient, SearchPrefetch } from "./client.js";
import { SearchTask } from "./model.js";
import {
  SearchDirection,
  SearchPageNotice,
  SearchPageTask,
  SearchScrollAnchor,
} from "./page-model.js";
import { SearchRuntime } from "./runtime.js";
import { measureSearchAnchor, restoreSearchAnchor } from "./scroll-anchor.js";
import { searchTaskScope } from "./source.js";

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

export const DispatchSearchPage = Command.define("DispatchSearchPage", {
  args: { direction: SearchDirection, page: SearchPageTask },
  execute: ({ direction, page }) =>
    SearchRuntime.use((runtime) => runtime.dispatchPage(direction, page)).pipe(
      Effect.match({
        onFailure: (problem) =>
          Message.ReceivedSearchPage({
            notice: SearchPageNotice.cases.Failed.make({
              direction,
              page,
              problem,
            }),
          }),
        onSuccess: () => Message.Navigated(),
      })
    ),
  messages: [Message.Navigated, Message.ReceivedSearchPage],
});

export const CaptureSearchPage = Command.define("CaptureSearchPage", {
  args: { notice: SearchPageNotice.cases.Ready },
  execute: ({ notice }) =>
    Effect.gen(function* captureSearchPage() {
      yield* Render.afterCommit;

      return yield* Effect.sync(() =>
        Message.ApplySearchPage({
          anchor: Option.fromUndefinedOr(measureSearchAnchor(document)),
          notice,
        })
      );
    }),
  messages: [Message.ApplySearchPage],
});

export const RestoreSearchAnchor = Command.define("RestoreSearchAnchor", {
  args: { anchor: Schema.Option(SearchScrollAnchor), task: SearchTask },
  execute: ({ anchor, task }) =>
    Effect.gen(function* restoreSearchPageAnchor() {
      yield* Render.afterCommit;

      return yield* Effect.sync(() => {
        const panel = document.querySelector<HTMLElement>("#search-panel");

        if (
          panel?.dataset.searchScope === searchTaskScope(task) &&
          panel.dataset.searchRevision === String(task.revision)
        ) {
          restoreSearchAnchor(document, Option.getOrUndefined(anchor));
        }

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
