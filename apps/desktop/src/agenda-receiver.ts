import {
  desktopWire,
  eligiblePromptAttachments,
} from "@calendar/core/desktop-bridge";
import type { AgendaSnapshotValue } from "@calendar/core/desktop-bridge";
import { Option, Schema } from "effect";

export const desktopAgendaReceiver =
  <Event>(
    origin: string,
    port: {
      readonly accepted: (snapshot: AgendaSnapshotValue) => void;
      readonly rejected: () => void;
      readonly trusted: (event: Event) => boolean;
    }
  ) =>
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This registered IPC listener decodes untrusted payloads before invoking the typed recipient.
  (event: Event, value: unknown): void => {
    if (!port.trusted(event)) {
      return;
    }

    const decoded = Schema.decodeUnknownOption(desktopWire.agenda)(value);

    if (Option.isNone(decoded)) {
      port.rejected();

      return;
    }

    port.accepted({
      ...decoded.value,
      events: decoded.value.events.map((item) => ({
        ...item,
        attachments: eligiblePromptAttachments(item.attachments ?? [], origin),
      })),
    });
  };
