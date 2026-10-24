import { Stream } from "effect";

import { Message } from "../message.js";

export const nearSearchTop = (viewport: HTMLElement): boolean =>
  viewport.clientHeight > 0 && viewport.scrollTop <= viewport.clientHeight;

export const nearSearchBottom = (viewport: HTMLElement): boolean =>
  viewport.clientHeight > 0 &&
  viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
    viewport.clientHeight;

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
      Stream.merge(
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
        ),
        Stream.fromEventListener<Event>(document, "scroll", {
          capture: true,
          passive: true,
        }).pipe(
          Stream.filter(
            (event) =>
              event.target instanceof HTMLElement &&
              event.target.id === "search-results"
          ),
          Stream.flatMap((event) => {
            const viewport = event.target;

            if (!(viewport instanceof HTMLElement)) {
              return Stream.empty;
            }

            if (
              viewport.dataset.searchRestoredPosition ===
              String(viewport.scrollTop)
            ) {
              return Stream.empty;
            }

            viewport.dataset.searchRestoredPosition = "";

            return Stream.fromIterable([
              ...(nearSearchTop(viewport) ? [Message.SearchOlder()] : []),
              ...(nearSearchBottom(viewport) ? [Message.SearchMore()] : []),
            ]);
          })
        )
      )
    )
  );
