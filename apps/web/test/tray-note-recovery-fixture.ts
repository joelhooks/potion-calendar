import { CalendarEvent } from "@calendar/calendar/contracts";
import type {
  CalendarEventValue,
  RsvpInput,
} from "@calendar/calendar/contracts";
import {
  DesktopAction,
  TrayRsvpNote,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import { Effect, Layer, Option, Queue, Schema, Stream } from "effect";
import { AsyncData } from "foldkit";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { BulkExecution, BulkView } from "../src/client/bulk/model.js";
import { bulkPlanFor } from "../src/client/bulk/selection.js";
import { DesktopNotice } from "../src/client/desktop/model.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeleteCommand } from "../src/client/editing/deletion-session.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PrepareGestures } from "../src/client/editing/gesture-mount.js";
import { RsvpIntent } from "../src/client/editing/rsvp-machine.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { PrepareTimeGrid } from "../src/client/grid-mount.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import { PrepareSelection } from "../src/client/selection/mount.js";
import { PrepareZoneDrag } from "../src/client/zone-drag/mount.js";
import { view } from "../src/features/app.js";
import { BulkReceipt, BulkUndo } from "../src/layout/bulk-plans.js";
import { bulkRootFixture } from "./bulk-root-fixture.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingPerson,
} from "./upcoming-fixture.js";

export const recoveryEvent: CalendarEventValue = {
  ...savedUpcomingEvent,
  attendees: [
    { email: "self@example.test", responseStatus: "needsAction", self: true },
  ],
  eventId: "series_20261021T090000Z",
  recurringEventId: "series",
};

export const recoveryStart = Date.parse("2026-10-21T09:00:00Z");

export const recoveryEnd = Date.parse("2026-10-21T10:00:00Z");

export const recoveryIntent = TrayRsvpNote.make({
  key: {
    accountId: recoveryEvent.accountId,
    calendarId: recoveryEvent.calendarId,
    eventId: recoveryEvent.eventId,
  },
  lease: "lease",
  personId: upcomingPerson,
  response: "tentative",
  start: recoveryStart,
});

export const recoveryModel = (
  width = 1280,
  events: readonly CalendarEventValue[] = [recoveryEvent]
): AppModel => {
  const base = upcomingFixture();

  const upcoming = update(
    base,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: base.upcoming.request,
      result: { events, versions: [] },
    })
  ).model;

  const settings = update(
    upcoming,
    Message.ReceivedDesktop({
      notice: DesktopNotice.cases.Settings.make({
        settings: {
          issues: [],
          openAtLogin: false,
          preferences: defaultDesktopPreferences(),
          revision: 1,
          runtime: { notificationLease: "lease", prompt: true, tray: true },
        },
      }),
    })
  ).model;

  const rows = update(
    settings,
    Message.ReceivedEvents({
      accountId: recoveryEvent.accountId,
      request: settings.calendar.rangeRequest,
      result: { events, versions: [] },
    })
  ).model;

  return {
    ...rows,
    calendar: { ...rows.calendar, viewportWidth: width },
    phoneShell: { ...rows.phoneShell, viewportWidth: width },
  };
};

export const recoveryInteraction = (
  model: AppModel,
  action: "type" | "click",
  value: string
): Option.Option<AppMessage> => {
  let captured: Option.Option<AppMessage> = Option.none();

  const zone =
    (model.phoneShell.viewportWidth ?? 1280) > 640
      ? [
          Scene.Mount.resolve(
            PrepareZoneDrag,
            Message.PreparedZoneDragHost({ hostKey: "" })
          ),
        ]
      : [];

  Scene.scene(
    {
      update: (current: AppModel, message: AppMessage) => {
        captured = Option.some(message);

        return { model: current };
      },
      view,
    },
    Scene.given(model),
    Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
    Scene.Mount.resolve(PrepareSelection, Message.PreparedSelection()),
    ...zone,
    Scene.Mount.resolve(
      PrepareTimeGrid,
      Message.MeasuredViewport({
        gutter: 0,
        height: 700,
        width: model.calendar.viewportWidth,
      })
    ),
    Scene.Mount.resolve(
      PrepareEditingDialogs,
      Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
    ),
    Scene.Mount.resolve(
      PrepareGestures,
      Message.PreviewedGesture({
        personId: upcomingPerson,
        preview: Option.none(),
      })
    ),
    Scene.tap(() => {
      captured = Option.none();
    }),
    action === "type"
      ? Scene.type(Scene.selector("#rsvp-note"), value)
      : Scene.click(Scene.role("button", { name: value }))
  );

  return captured;
};

export const recoveryAdmission = (intent = recoveryIntent) =>
  Message.ReceivedDesktop({
    notice: DesktopNotice.cases.Action.make({
      action: DesktopAction.cases.PrepareRsvpNote.make(intent),
    }),
  });

export const RecoveryBusy = Schema.Literals([
  "rsvp",
  "bulk-running",
  "bulk-undoing",
]);

export const recoveryBusyMessage = (
  model: AppModel,
  kind: typeof RecoveryBusy.Type,
  busy: boolean
): AppMessage => {
  if (kind === "rsvp") {
    return Message.ReceivedEditing({
      notice: EditingNotice.cases.Rsvp.make({
        view: {
          ...model.editing.rsvp,
          saving: busy
            ? Option.some(
                RsvpIntent.make({
                  event: recoveryEvent,
                  id: 1,
                  request: {
                    ...recoveryIntent.key,
                    response: "tentative",
                    sendUpdates: "none",
                  },
                })
              )
            : Option.none(),
        },
      }),
      personId: upcomingPerson,
    });
  }

  const base = bulkRootFixture();
  const selection = base.keys.slice(0, 2);

  const plan = bulkPlanFor(
    {
      ...base.model,
      calendar: { ...base.model.calendar, selected: selection },
    },
    "delete"
  );

  const execution = BulkExecution.make({
    id: "unrelated-bulk",
    mutations: [],
    plan,
    receipts: plan.steps.map((step) =>
      BulkReceipt.cases.Succeeded.make({
        key: step.key,
        undo: BulkUndo.cases.Available.make({
          request: DeleteCommand.cases.Undo.make({ id: step.key }),
        }),
      })
    ),
    selection,
  });

  const active =
    kind === "bulk-running"
      ? BulkView.cases.Running.make({ id: execution.id, plan, selection })
      : BulkView.cases.Undoing.make({ execution });

  return Message.ReceivedEditing({
    notice: EditingNotice.cases.Bulk.make({
      view: busy ? active : BulkView.cases.Idle.make({}),
    }),
    personId: upcomingPerson,
  });
};

export const recoveryHost = Effect.fn("RecoveryTest.host")(
  function* recoveryHost(initial: AppModel) {
    const calls: (typeof RsvpInput.Type)[] = [];
    const notices = yield* Queue.unbounded<typeof EditingNotice.Type>();
    const unexpected = Effect.die("Recovery reached an unrelated writer");

    const services = Layer.merge(
      Layer.succeed(
        CalendarEditingClient,
        CalendarEditingClient.of({
          createEvent: () => unexpected,
          deleteEvent: () => unexpected,
          getEvent: () => unexpected,
          moveAndRetimeSeries: () => unexpected,
          moveEvent: () => unexpected,
          moveSupport: "notAvailable",
          rsvp: (input) =>
            Effect.sync(() => {
              calls.push(input);

              return recoveryEvent;
            }),
          updateEvent: () => unexpected,
        })
      ),
      Layer.succeed(
        DeletionWriter,
        DeletionWriter.of({ commit: () => unexpected })
      )
    );

    const context = yield* Layer.build(
      EditingRuntime.layer.pipe(Layer.provide(services))
    );

    const runtime = yield* Effect.service(EditingRuntime).pipe(
      Effect.provide(context)
    );

    const stream = yield* runtime.connect(upcomingPerson);
    yield* stream.pipe(
      Stream.runForEach((notice) => Queue.offer(notices, notice)),
      Effect.forkScoped
    );
    let model = initial;
    const effects: string[] = [];

    const apply = Effect.fn("RecoveryTest.apply")(function* apply(
      message: AppMessage
    ) {
      const next = update(model, message);
      ({ model } = next);
      let dispatches = 0;

      for (const command of next.commands ?? []) {
        effects.push(command.name);

        if (command.name === "DispatchEditing") {
          const args = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ command: EditingCommand, personId: Schema.String })
          )(command.args);

          const result = yield* DispatchEditing(args).effect.pipe(
            Effect.provideService(EditingRuntime, runtime)
          );

          ({ model } = update(model, result));
          dispatches += 1;
        } else if (command.name === "ReadEvents") {
          const args = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ accountId: Schema.String, request: Schema.Int })
          )(command.args);

          const events = initial.calendar.reads
            .filter((row) => row.accountId === args.accountId)
            .flatMap((row) =>
              AsyncData.getData(row.events).pipe(
                Option.map((data) =>
                  data.events.filter(
                    (event) => event.accountId === args.accountId
                  )
                ),
                Option.getOrElse(() => [])
              )
            );

          ({ model } = update(
            model,
            Message.ReceivedEvents({
              ...args,
              result: { events, versions: [] },
            })
          ));
        } else if (command.name === "ReadEventAttachments") {
          const args = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              original: CalendarEvent,
              personId: Schema.String,
              requestId: Schema.Int,
            })
          )(command.args);

          ({ model } = update(
            model,
            Message.ReceivedEventAttachments({
              result: { ...args, event: Option.some(args.original) },
            })
          ));
        } else if (
          command.name !== "NavigateRoute" &&
          command.name !== "FocusRsvpNote"
        ) {
          return yield* Effect.die(
            `Recovery root produced an unhandled command: ${command.name}`
          );
        }
      }

      return dispatches;
    });

    const receive = Effect.fn("RecoveryTest.receive")(function* receive() {
      while (true) {
        const notice = yield* Queue.take(notices);
        yield* apply(
          Message.ReceivedEditing({ notice, personId: upcomingPerson })
        );

        if (EditingNotice.guards.Rsvp(notice)) {
          return notice.view;
        }
      }
    });

    yield* receive();

    return { apply, calls, effects, model: () => model, receive };
  }
);

export const recoveryScenario = Effect.fn("RecoveryTest.scenario")(
  function* recoveryScenario(
    width: number,
    response: (typeof TrayRsvpNote.Type)["response"]
  ) {
    const h = yield* recoveryHost(recoveryModel(width));
    yield* h.apply(recoveryAdmission({ ...recoveryIntent, response }));
    yield* h.receive();
    yield* h.apply(
      Message.EditingAction({
        action: EditorAction.cases.RsvpNoteEdited.make({
          value: "Ready to discuss the timing.",
        }),
      })
    );
    yield* h.receive();
    yield* h.receive();
    yield* h.apply(Message.Ticked({ now: recoveryEnd }));
    yield* h.receive();

    return h;
  }
);
