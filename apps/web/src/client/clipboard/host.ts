import type { SessionSnapshot } from "@calendar/core/contracts";
import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";

import { resolvedAppLocale } from "../../layout/app-locale.js";
import { visibleEvents } from "../../layout/presentation.js";
import { primarySelection } from "../../layout/selection-set.js";
import { resolvedTimeFormat } from "../../layout/time-format.js";
import type { AppModel } from "../app.js";
import { BulkView } from "../bulk/model.js";
import { editorConferencingContext } from "../conferencing/editor-context.js";
import { EditorView } from "../editing/editor-model.js";
import { defaultCreationCalendar } from "../settings/update.js";
import { timeGridGeometry } from "../time-blocks/grid.js";
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
    !EditorView.guards.Closed(model.editing.view) ||
    BulkView.guards.Running(model.editing.bulk) ||
    BulkView.guards.Undoing(model.editing.bulk)
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

  const projection = month ? undefined : timeGridGeometry(model);
  const scale = projection?.scale ?? 1;

  const host: ClipboardGridHost = {
    key: JSON.stringify([
      session.user.id,
      model.calendar.navigation,
      model.calendar.zone,
      scale,
      ...(projection === undefined || projection.grid.hidden.length === 0
        ? []
        : [projection.grid.hidden]),
    ]),
    mode: month ? "month" : "time",
    root,
    scale,
    zone: model.calendar.zone,
  };

  return projection === undefined ? host : { ...host, grid: projection.grid };
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

  const selected = visibleEvents(model).find((event) =>
    Option.contains(primarySelection(model.calendar.selected), event.key)
  );

  const refusalPresentation = {
    locale: resolvedAppLocale(model),
    timeFormat: resolvedTimeFormat(model),
  };

  let target =
    calendar === undefined
      ? undefined
      : ClipboardPasteTarget.make({
          calendar,
          conferencingContext: editorConferencingContext(model),
          navigation: model.calendar.navigation,
          primaryZone: homeZone(model),
          selection: primarySelection(model.calendar.selected),
        });

  if (
    target !== undefined &&
    (refusalPresentation.locale !== "en-US" ||
      refusalPresentation.timeFormat !== "12")
  ) {
    target = ClipboardPasteTarget.make({ ...target, refusalPresentation });
  }

  return {
    anchor,
    copied: connection.copied(),
    group:
      model.calendar.selected.length > 1
        ? {
            candidates: visibleEvents(model).map((item) => ({
              event: item.source,
              key: item.key,
            })),
            selection: model.calendar.selected,
          }
        : undefined,
    personId: session.user.id,
    selected:
      model.calendar.selected.length === 1 ? selected?.source : undefined,
    selfEmails: [
      session.user.email,
      ...session.accounts.map((account) => account.email),
    ],
    sessionId: connection.sessionId,
    target,
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
