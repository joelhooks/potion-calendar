import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { Effect, Option, Queue, Stream } from "effect";

import {
  captureSelectionClipboard,
  SelectionClipboardCapture,
} from "../../layout/selection-clipboard.js";
import type { SelectionClipboardCandidate } from "../../layout/selection-clipboard.js";
import type { SelectionSetValue } from "../../layout/selection-set.js";
import { captureClipboardItem } from "./capture.js";
import { nativeClipboardFocusAllowed } from "./focus.js";
import { clipboardMarker, matchesClipboardEnvelope } from "./identity.js";
import {
  ClipboardCaptureResult,
  ClipboardEnvelope,
  ClipboardInputFailure,
  ClipboardRange,
  NativeClipboardNotice,
} from "./model.js";
import type { ClipboardAnchor, ClipboardPasteTarget } from "./model.js";

export type NativeClipboardOperation = "copy" | "cut" | "paste";

export interface NativeClipboardHost {
  readonly anchor: typeof ClipboardAnchor.Type | undefined;
  readonly copied:
    | Pick<typeof ClipboardEnvelope.Type, "id" | "personId">
    | undefined;
  readonly personId: string;
  readonly group?:
    | {
        readonly candidates: readonly (typeof SelectionClipboardCandidate.Type)[];
        readonly selection: SelectionSetValue;
      }
    | undefined;
  readonly selected: CalendarEventValue | undefined;
  readonly selfEmails: readonly string[];
  readonly sessionId: string;
  readonly target: typeof ClipboardPasteTarget.Type | undefined;
}

export interface NativeClipboardEvent {
  readonly clipboardData: Pick<
    DataTransfer,
    "clearData" | "getData" | "setData"
  > | null;
  readonly defaultPrevented: boolean;
  readonly isTrusted: boolean;
  readonly target: EventTarget | null;
  readonly preventDefault: () => void;
}

const refusal = (
  host: NativeClipboardHost,
  operation: NativeClipboardOperation,
  sequence: number,
  failure: ClipboardInputFailure
) =>
  NativeClipboardNotice.cases.Refused.make({
    failure,
    operation,
    personId: host.personId,
    sequence,
    sessionId: host.sessionId,
  });

const copy = (
  host: NativeClipboardHost,
  event: NativeClipboardEvent,
  data: NonNullable<NativeClipboardEvent["clipboardData"]>,
  operation: "copy" | "cut",
  sequence: number
): Option.Option<typeof NativeClipboardNotice.Type> => {
  let envelope: typeof ClipboardEnvelope.Type;

  if (host.group === undefined) {
    if (host.selected === undefined) {
      return Option.none();
    }

    const captured = captureClipboardItem(host.selected, host.selfEmails);

    if (ClipboardCaptureResult.guards.Refused(captured)) {
      event.preventDefault();

      return Option.some(refusal(host, operation, sequence, captured.failure));
    }

    envelope = ClipboardEnvelope.make({
      id: `${host.sessionId}.${sequence}`,
      items: [captured.item],
      personId: host.personId,
      version: 1,
    });
  } else {
    const captured = captureSelectionClipboard({
      ...host.group,
      copyId: `${host.sessionId}.${sequence}`,
      personId: host.personId,
      selfEmails: host.selfEmails,
    });

    if (SelectionClipboardCapture.guards.Refused(captured)) {
      event.preventDefault();

      return Option.some(
        refusal(
          host,
          operation,
          sequence,
          new ClipboardInputFailure({
            message: captured.issues
              .map((issue) => `${issue.title}: ${issue.message}`)
              .join("\n"),
            reason: "incompleteSelection",
          })
        )
      );
    }

    const [first, ...rest] = captured.snapshot.members;
    const allDay = ClipboardRange.guards.AllDay(first.item.range);

    if (
      rest.some(
        (member) => ClipboardRange.guards.AllDay(member.item.range) !== allDay
      )
    ) {
      event.preventDefault();

      return Option.some(
        refusal(
          host,
          operation,
          sequence,
          new ClipboardInputFailure({
            message: `Copy timed and all-day events separately. Nothing was ${operation === "cut" ? "cut" : "copied"}.`,
            reason: "mixedRanges",
          })
        )
      );
    }

    envelope = ClipboardEnvelope.make({
      id: captured.snapshot.copyId,
      items: [first.item, ...rest.map((member) => member.item)],
      personId: host.personId,
      selectionKeys: [first.key, ...rest.map((member) => member.key)],
      version: 1,
    });
  }

  data.clearData();
  data.setData("text/plain", clipboardMarker(envelope.id));
  event.preventDefault();

  return Option.some(
    NativeClipboardNotice.cases.Copied.make({
      envelope,
      mode: operation,
      personId: host.personId,
      selfEmails: host.selfEmails,
      sequence,
      sessionId: host.sessionId,
    })
  );
};

const paste = (
  host: NativeClipboardHost,
  event: NativeClipboardEvent,
  data: NonNullable<NativeClipboardEvent["clipboardData"]>,
  sequence: number
): Option.Option<typeof NativeClipboardNotice.Type> => {
  const { copied } = host;

  if (copied === undefined) {
    return Option.none();
  }

  if (copied.personId !== host.personId) {
    event.preventDefault();

    return Option.some(
      refusal(
        host,
        "paste",
        sequence,
        new ClipboardInputFailure({
          message:
            "Copy an event for the current signed-in person before pasting.",
          reason: "personMismatch",
        })
      )
    );
  }

  const text = data.getData("text/plain");

  if (!matchesClipboardEnvelope(copied, host.personId, text)) {
    return Option.some(
      NativeClipboardNotice.cases.Invalidated.make({
        copyId: copied.id,
        personId: host.personId,
        sequence,
        sessionId: host.sessionId,
      })
    );
  }

  event.preventDefault();

  if (host.anchor === undefined) {
    return Option.some(
      refusal(
        host,
        "paste",
        sequence,
        new ClipboardInputFailure({
          message: "Choose a calendar slot before pasting the copied event.",
          reason: "missingTime",
        })
      )
    );
  }

  if (host.target === undefined) {
    return Option.some(
      refusal(
        host,
        "paste",
        sequence,
        new ClipboardInputFailure({
          message: "Choose a writable default calendar before pasting.",
          reason: "noWritableCalendar",
        })
      )
    );
  }

  return Option.some(
    NativeClipboardNotice.cases.Paste.make({
      anchor: host.anchor,
      copyId: copied.id,
      personId: host.personId,
      sequence,
      sessionId: host.sessionId,
      target: host.target,
    })
  );
};

export const observeNativeClipboard = (
  host: NativeClipboardHost | undefined,
  event: NativeClipboardEvent,
  operation: NativeClipboardOperation,
  sequence: number,
  document: Document,
  composing: boolean
): Option.Option<typeof NativeClipboardNotice.Type> => {
  if (
    host === undefined ||
    !nativeClipboardFocusAllowed(event, document, composing)
  ) {
    return Option.none();
  }

  if (
    (operation === "paste" && host.copied === undefined) ||
    (operation !== "paste" &&
      host.selected === undefined &&
      host.group === undefined)
  ) {
    return Option.none();
  }

  if (event.clipboardData === null) {
    event.preventDefault();

    return Option.some(
      refusal(
        host,
        operation,
        sequence,
        new ClipboardInputFailure({
          message:
            "This browser could not provide the native clipboard operation.",
          reason: "nativeUnavailable",
        })
      )
    );
  }

  try {
    return operation === "paste"
      ? paste(host, event, event.clipboardData, sequence)
      : copy(host, event, event.clipboardData, operation, sequence);
  } catch {
    event.preventDefault();

    return Option.some(
      refusal(
        host,
        operation,
        sequence,
        new ClipboardInputFailure({
          message:
            "The native clipboard operation was refused. Try it again while the app is focused.",
          reason: "nativeUnavailable",
        })
      )
    );
  }
};

export const nativeClipboardReceiver = (
  document: Document,
  sessionId: string,
  readHost: () => NativeClipboardHost | undefined,
  emit: (notice: typeof NativeClipboardNotice.Type) => void
) => {
  let sequence = 0;
  let composing = false;

  const handle = (
    operation: NativeClipboardOperation,
    event: NativeClipboardEvent
  ) => {
    const host = readHost();

    if (host?.sessionId !== sessionId) {
      return;
    }

    sequence += 1;

    const notice = observeNativeClipboard(
      host,
      event,
      operation,
      sequence,
      document,
      composing
    );

    if (Option.isSome(notice)) {
      emit(notice.value);
    }
  };

  return {
    copy: (event: NativeClipboardEvent) => {
      handle("copy", event);
    },
    cut: (event: NativeClipboardEvent) => {
      handle("cut", event);
    },
    endComposition: () => {
      composing = false;
    },
    paste: (event: NativeClipboardEvent) => {
      handle("paste", event);
    },
    startComposition: () => {
      composing = true;
    },
  };
};

export const nativeClipboardEvents = (
  document: Document,
  sessionId: string,
  readHost: () => NativeClipboardHost | undefined
): Stream.Stream<typeof NativeClipboardNotice.Type> =>
  Stream.callback((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const receiver = nativeClipboardReceiver(
          document,
          sessionId,
          readHost,
          (notice) => {
            Queue.offerUnsafe(queue, notice);
          }
        );

        for (const operation of ["copy", "cut", "paste"] as const) {
          document.addEventListener(operation, receiver[operation]);
        }

        document.addEventListener(
          "compositionstart",
          receiver.startComposition
        );
        document.addEventListener("compositionend", receiver.endComposition);

        return receiver;
      }),
      (receiver) =>
        Effect.sync(() => {
          for (const operation of ["copy", "cut", "paste"] as const) {
            document.removeEventListener(operation, receiver[operation]);
          }

          document.removeEventListener(
            "compositionstart",
            receiver.startComposition
          );
          document.removeEventListener(
            "compositionend",
            receiver.endComposition
          );
        })
    )
  );
