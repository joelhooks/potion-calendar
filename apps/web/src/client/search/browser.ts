import { Stream } from "effect";

import { Message } from "../message.js";

export const searchInteractions = () =>
  Stream.suspend(() =>
    Stream.merge(
      Stream.fromEventListener<MouseEvent>(document, "click").pipe(
        Stream.map((event) => {
          const row =
            event.target instanceof Element
              ? event.target.closest("[data-search-event]")
              : null;

          const key =
            row instanceof HTMLElement ? row.dataset.searchEvent : undefined;

          return key === null || key === undefined
            ? Message.SearchContextClose()
            : Message.SearchSelect({ goTo: event.altKey, key });
        })
      ),
      Stream.fromEventListener<FocusEvent>(document, "focusout").pipe(
        Stream.filter(
          (event) =>
            event.target instanceof Element &&
            event.target.id === "search-query" &&
            !(
              event.relatedTarget instanceof Element &&
              event.relatedTarget.id === "search-clear"
            )
        ),
        Stream.map(() => Message.SearchBlur())
      )
    )
  );
