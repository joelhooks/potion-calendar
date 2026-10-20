import type { SessionSnapshot } from "@calendar/core/contracts";
import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";

import { hourHeight } from "../../layout/geometry.js";
import { allDaySection, visibleEvents } from "../../layout/presentation.js";
import type { AppModel } from "../app.js";
import { EditorView } from "../editing/editor-model.js";
import { defaultCreationCalendar } from "../settings/update.js";
import { homeZone } from "../time-zones/model.js";
import type { ClipboardGridHost } from "./anchor.js";
import { ClipboardPasteTarget } from "./model.js";
import type { ClipboardAnchor } from "./model.js";
import type { NativeClipboardHost } from "./native.js";
import type { ClipboardConnection } from "./runtime.js";

const clipboardSession = (
  model: AppModel
): NonNullable<typeof SessionSnapshot.Type> | undefined => {
  const session = Option.getOrUndefined(AsyncData.getData(model.session));

  if (
    session === undefined ||
    session === null ||
    !Option.contains(model.person, session.user.id) ||
    model.action !== "idle" ||
    !Predicate.isTagged(model.route, "Calendar") ||
    !EditorView.guards.Closed(model.editing.view)
  ) {
    return undefined;
  }

  return session;
};

export const clipboardGridHost = (
  model: AppModel,
  document: Document
): ClipboardGridHost | undefined => {
  const session = clipboardSession(model);

  if (
    session === undefined ||
    document.querySelector("dialog[open]") !== null
  ) {
    return undefined;
  }

  const month = model.calendar.navigation.mode === "month";

  const root = document.querySelector<HTMLElement>(
    month ? ".month-view" : "#gesture-host"
  );

  if (root === null) {
    return undefined;
  }

  const scale = month
    ? 1
    : hourHeight(
        model.calendar.zoom,
        model.calendar.viewport,
        allDaySection(model).height
      );

  return {
    key: JSON.stringify([
      session.user.id,
      model.calendar.navigation,
      model.calendar.zone,
      scale,
    ]),
    mode: month ? "month" : "time",
    root,
    scale,
    zone: model.calendar.zone,
  };
};

export const clipboardNativeHost = (
  model: AppModel,
  connection: ClipboardConnection,
  anchor: typeof ClipboardAnchor.Type | undefined,
  document: Document
): NativeClipboardHost | undefined => {
  const session = clipboardSession(model);

  if (
    session === undefined ||
    connection.personId !== session.user.id ||
    !connection.canReceive() ||
    document.querySelector("dialog[open]") !== null
  ) {
    return undefined;
  }

  const calendar = defaultCreationCalendar(model);
  const selected = visibleEvents(model).find((event) => event.selected);

  return {
    anchor,
    copied: connection.copied(),
    personId: session.user.id,
    selected: selected?.source,
    selfEmails: [
      session.user.email,
      ...session.accounts.map((account) => account.email),
    ],
    sessionId: connection.sessionId,
    target:
      calendar === undefined
        ? undefined
        : ClipboardPasteTarget.make({
            calendar,
            navigation: model.calendar.navigation,
            primaryZone: homeZone(model),
            selection: model.calendar.selected,
          }),
  };
};

export const clipboardCutEvents = (model: AppModel) => [
  ...model.calendar.reads.flatMap((read) =>
    Option.match(AsyncData.getData(read.events), {
      onNone: () => [],
      onSome: (data) => data.events,
    })
  ),
  ...visibleEvents(model).flatMap((event) =>
    event.copies.map((copy) => copy.source)
  ),
];
