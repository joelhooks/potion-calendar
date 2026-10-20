import { Match, Option, Predicate } from "effect";
import { AsyncData } from "foldkit";
import type { Runtime } from "foldkit";

import type { AppMessage, AppModel } from "../app.js";
import { upcomingSelection } from "../upcoming/update.js";
import { agendaSnapshot } from "./snapshot.js";

const triggerFor = (message: AppMessage): string =>
  Match.value(message).pipe(
    Match.tag("ReceivedSession", () => "ReceivedSession"),
    Match.tag("ReceivedPreferences", () => "ReceivedPreferences"),
    Match.tag("ReceivedCalendars", () => "ReceivedCalendars"),
    Match.tag("FailedCalendars", () => "FailedCalendars"),
    Match.tag("ReceivedUpcoming", () => "ReceivedUpcoming"),
    Match.tag("FailedUpcoming", () => "FailedUpcoming"),
    Match.tag("ReceivedDesktop", () => "ReceivedDesktop"),
    Match.tag("ReceivedEditing", () => "ReceivedEditing"),
    Match.tag("ReceivedLive", () => "ReceivedLive"),
    Match.tag("Ticked", () => "Ticked"),
    Match.tag("ClickedSignOut", () => "ClickedSignOut"),
    Match.orElse(() => "Other")
  );

const phase = (state: AsyncData.AsyncData<unknown, unknown>): string =>
  AsyncData.match(state, {
    onFailure: () => "Failure",
    onIdle: () => "Idle",
    onLoading: () => "Loading",
    onRefreshing: () => "Refreshing",
    onStale: () => "Stale",
    onSuccess: () => "Success",
  });

const upcomingState = (model: AppModel) => {
  const data = Option.getOrUndefined(AsyncData.getData(model.upcoming.data));
  const query = Option.getOrUndefined(model.upcoming.query);

  return {
    deferred: Option.getOrUndefined(model.upcoming.deferredRefresh) ?? null,
    eventCount: data?.events.length ?? 0,
    eventTimes:
      data?.events.map((event) => ({
        end: event.end ?? null,
        start: event.start ?? null,
        title: event.title ?? "",
      })) ?? [],
    queryCount: query?.calendars.length ?? 0,
    queryPersonMatches:
      query === undefined
        ? null
        : Option.contains(model.person, query.personId),
    queryRange: query?.range ?? null,
    request: model.upcoming.request,
    upcomingPhase: phase(model.upcoming.data),
  };
};

const desktopState = (model: AppModel) => {
  const settings = Option.getOrUndefined(
    AsyncData.getData(model.desktop.settings)
  );

  return {
    bridge: model.desktop.availability,
    desktopPhase: phase(model.desktop.settings),
    desktopRevision: settings?.revision ?? null,
    includeAllDay: settings?.preferences.includeAllDay ?? null,
    includeDays: settings?.preferences.includeDays ?? null,
    includeWithoutConferencingOrLocation:
      settings?.preferences.includeWithoutConferencingOrLocation ?? null,
    includeWithoutParticipants:
      settings?.preferences.includeWithoutParticipants ?? null,
    menuBar: settings?.preferences.menuBar ?? null,
    projectedCount:
      settings === undefined
        ? 0
        : agendaSnapshot(model, settings.preferences).events.length,
  };
};

const acknowledgedWrite = (model: AppModel, previous?: AppModel) => {
  const write = Option.getOrUndefined(model.editing.write);

  const acknowledged =
    previous !== undefined &&
    write !== undefined &&
    Option.isSome(write.afterRead) &&
    Option.getOrUndefined(previous.editing.handledMutation) !==
      Option.getOrUndefined(model.editing.handledMutation);

  const ref = write?.plan.session.draft;
  const query = Option.getOrUndefined(model.upcoming.query);

  return {
    acknowledgedTitle: acknowledged ? write.plan.session.draft.title : null,
    saveAcknowledged: acknowledged,
    writeInQuery:
      ref === undefined
        ? null
        : (query?.calendars.some(
            (calendar) =>
              calendar.accountId === ref.accountId &&
              calendar.calendarId === ref.calendarId
          ) ?? false),
    writeSelected:
      ref === undefined
        ? null
        : upcomingSelection(model).some(
            (calendar) =>
              calendar.accountId === ref.accountId &&
              calendar.calendarId === ref.calendarId
          ),
  };
};

export const desktopProofState = (
  model: AppModel,
  timestamp: number,
  previous?: AppModel,
  trigger = "View",
  documentEpoch = 0
) => ({
  ...acknowledgedWrite(model, previous),
  ...desktopState(model),
  ...upcomingState(model),
  calendarCount: model.calendar.calendars.length,
  documentEpoch,
  hasPerson: Option.isSome(model.person),
  indexPhase: phase(model.calendar.index),
  keyboardPrefix: model.keyboard.prefix,
  keyboardScreen: model.keyboard.screen,
  now: model.calendar.now,
  routeTag: Match.value(model.route).pipe(
    Match.tag("Calendar", () => "Calendar"),
    Match.tag("Search", () => "Search"),
    Match.tag("Settings", () => "Settings"),
    Match.tag("Shortcuts", () => "Shortcuts"),
    Match.exhaustive
  ),
  selectedCount: upcomingSelection(model).length,
  timestamp,
  trigger,
});

export type DesktopProofState = ReturnType<typeof desktopProofState>;

declare global {
  interface Window {
    readonly __calendarDesktopProof?: (state: DesktopProofState) => void;
  }
}

export const desktopProofObserver = (
  emit: (state: DesktopProofState) => void
): Runtime.SlowConfig<AppModel, AppMessage> => ({
  measuredPhases: ["Update", "View"],
  onSlow: (context) => {
    if (Predicate.isTagged(context, "Update")) {
      emit(
        desktopProofState(
          context.nextModel,
          context.nextModel.calendar.now,
          context.previousModel,
          triggerFor(context.message),
          performance.timeOrigin
        )
      );

      return;
    }

    if (Predicate.isTagged(context, "View")) {
      emit(
        desktopProofState(
          context.model,
          context.model.calendar.now,
          undefined,
          "View",
          performance.timeOrigin
        )
      );
    }
  },
  show: "Development",
  thresholdOverrides: { Update: -1, View: -1 },
});
