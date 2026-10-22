import { DateTime, Effect, Option, Schema } from "effect";

import { dragPrecision, snapMinute } from "../../layout/edit-time.js";
import { editorDate, editorLocalTime } from "../../layout/editor-time.js";
import { gridGeometry, yToMinute } from "../../layout/geometry.js";
import type { TimeGridGeometry } from "../../layout/geometry.js";
import { ClipboardAnchor } from "./model.js";

export interface ClipboardGridHost {
  readonly key: string;
  readonly mode: "month" | "time";
  readonly root: HTMLElement;
  readonly scale: number;
  readonly grid?: TimeGridGeometry;
  readonly zone: string;
}

export interface ClipboardPointer {
  readonly alt: boolean;
  readonly key: string;
  readonly shift: boolean;
  readonly x: number;
  readonly y: number;
}

const contains = (rect: DOMRect, point: ClipboardPointer): boolean =>
  point.x >= rect.left &&
  point.x < rect.right &&
  point.y >= rect.top &&
  point.y < rect.bottom;

const dateAtDay = (day: number): Option.Option<string> =>
  DateTime.make(day * 86_400_000).pipe(
    Option.map(DateTime.formatIsoDateUtc),
    Option.filter((date) => Option.isSome(editorDate(date)))
  );

const cellLayout = (host: ClipboardGridHost, foreground: Element) => {
  if (host.mode === "month") {
    return {
      dateOnly: true,
      region: ".month-cell[data-day]",
      selector: ".month-cell[data-day]",
    };
  }

  if (foreground.closest(".all-day") !== null) {
    return {
      dateOnly: true,
      region: ".all-day",
      selector: ".all-day-cell[data-day]",
    };
  }

  return {
    dateOnly: false,
    region: ".day-column[data-day]",
    selector: ".day-column[data-day]",
  };
};

export const clipboardAnchorAt = (
  host: ClipboardGridHost,
  point: ClipboardPointer,
  foreground: Element | null
): Option.Option<typeof ClipboardAnchor.Type> => {
  if (
    host.key !== point.key ||
    foreground === null ||
    !host.root.contains(foreground) ||
    !contains(host.root.getBoundingClientRect(), point) ||
    foreground.closest("[data-month-parked]") !== null
  ) {
    return Option.none();
  }

  const layout = cellLayout(host, foreground);
  const region = foreground.closest(layout.region);

  if (region === null) {
    return Option.none();
  }

  const cells = [...host.root.querySelectorAll<HTMLElement>(layout.selector)];

  const cell = cells.find(
    (candidate) =>
      region.contains(candidate) &&
      candidate.closest("[data-month-parked]") === null &&
      contains(candidate.getBoundingClientRect(), point)
  );

  if (cell === undefined) {
    return Option.none();
  }

  const day = Schema.decodeOption(Schema.Int)(Number(cell.dataset.day));

  if (layout.dateOnly) {
    return day.pipe(
      Option.flatMap(dateAtDay),
      Option.map((date) =>
        ClipboardAnchor.cases.AllDay.make({
          date,
          origin: host.mode === "month" ? "month" : undefined,
        })
      )
    );
  }

  if (!Number.isFinite(host.scale) || host.scale <= 0) {
    return Option.none();
  }

  const grid = host.grid ?? gridGeometry(host.scale);
  const y = point.y - cell.getBoundingClientRect().top;

  if (y < 0 || y >= grid.height) {
    return Option.none();
  }

  const raw = yToMinute(grid, y);

  if (raw < 0 || raw >= 1440) {
    return Option.none();
  }

  const minute = snapMinute(raw, dragPrecision(point));
  const offset = Math.floor(minute / 1440);
  const clockMinute = minute % 1440;
  const clock = `${String(Math.floor(clockMinute / 60)).padStart(2, "0")}:${String(clockMinute % 60).padStart(2, "0")}`;

  return day.pipe(
    Option.flatMap((value) => dateAtDay(value + offset)),
    Option.flatMap((date) =>
      editorLocalTime(date, clock, host.zone).pipe(
        Option.map((time) =>
          ClipboardAnchor.cases.Timed.make({
            date,
            instant: DateTime.toEpochMillis(time),
          })
        )
      )
    )
  );
};

export const trackClipboardPointer = (
  document: Document,
  readHost: () => ClipboardGridHost | undefined
) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      let point: ClipboardPointer | undefined;

      const clear = () => {
        point = undefined;
      };

      const read = (): typeof ClipboardAnchor.Type | undefined => {
        const host = readHost();

        if (
          host === undefined ||
          point === undefined ||
          host.key !== point.key
        ) {
          clear();

          return undefined;
        }

        return Option.getOrUndefined(
          clipboardAnchorAt(
            host,
            point,
            document.elementFromPoint(point.x, point.y)
          )
        );
      };

      const observe = (event: PointerEvent) => {
        if (!event.isTrusted) {
          return;
        }

        const host = readHost();

        if (host === undefined) {
          clear();

          return;
        }

        point = {
          alt: event.altKey,
          key: host.key,
          shift: event.shiftKey,
          x: event.clientX,
          y: event.clientY,
        };

        if (read() === undefined) {
          clear();
        }
      };

      const leave = (event: PointerEvent) => {
        if (event.relatedTarget === null) {
          clear();
        }
      };

      document.addEventListener("pointermove", observe, true);
      document.addEventListener("pointerdown", observe, true);
      document.addEventListener("pointerout", leave, true);
      document.defaultView?.addEventListener("blur", clear);

      return {
        read,
        release: () => {
          clear();
          document.removeEventListener("pointermove", observe, true);
          document.removeEventListener("pointerdown", observe, true);
          document.removeEventListener("pointerout", leave, true);
          document.defaultView?.removeEventListener("blur", clear);
        },
      };
    }),
    (tracker) => Effect.sync(tracker.release)
  ).pipe(Effect.map((tracker) => tracker.read));
