import type { ClipboardEnvelope } from "./model.js";

export const clipboardMarker = (id: string): string =>
  `calendar-event:v1:${id}`;

export const matchesClipboardEnvelope = (
  envelope: Pick<typeof ClipboardEnvelope.Type, "id" | "personId">,
  personId: string,
  text: string
): boolean =>
  envelope.personId === personId && text === clipboardMarker(envelope.id);
