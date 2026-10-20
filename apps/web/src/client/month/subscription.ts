import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import { Effect, Option, Queue, Stream } from "effect";
import { Render } from "foldkit";

import {
  MonthWindowFrame,
  monthScrollLimits,
  settledMonthAnchor,
} from "../../layout/month-window.js";
import { monthGeometry, monthWeeks } from "../../layout/month.js";
import type { AppModel } from "../app.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import { bindMonthScroll } from "./events.js";
import { applyMonthRebase, retainMonthFocus } from "./frame.js";
import { monthHostKey } from "./host.js";
import { MonthNotice } from "./model.js";
import { MonthRuntime } from "./runtime.js";
import { monthScrollMachine } from "./scroll-machine.js";
import type { MonthRebaseRequest } from "./scroll-machine.js";

export const waitForMonthFrame = (
  viewport: HTMLElement,
  request: typeof MonthRebaseRequest.Type
) =>
  Effect.callback<boolean>((resume) => {
    const ready = () => {
      if (
        viewport.isConnected &&
        viewport.dataset.monthFirstWeek ===
          String(request.position.firstWeek) &&
        viewport.dataset.monthRebaseId === String(request.id)
      ) {
        resume(Effect.succeed(true));
      }
    };

    const observer = new MutationObserver(ready);
    observer.observe(viewport, {
      attributeFilter: ["data-month-first-week", "data-month-rebase-id"],
    });
    ready();

    return Effect.sync(() => {
      observer.disconnect();
    });
  });

const monthNoticeEmitter =
  (queue: Queue.Enqueue<AppMessage>) => (notice: typeof MonthNotice.Type) => {
    Queue.offerUnsafe(queue, Message.ReceivedMonth({ notice }));
  };

const liveMonthScrollStream = (
  initial: AppModel,
  readModel: () => AppModel
): Stream.Stream<AppMessage, never, MonthRuntime> => {
  const host = monthHostKey(initial);

  if (Option.isNone(host)) {
    return Stream.empty;
  }

  const hostKey = host.value;

  return Stream.callback<AppMessage, never, MonthRuntime>((queue) =>
    Effect.gen(function* monthScrollLifecycle() {
      yield* Render.afterCommit;
      const viewport = document.querySelector<HTMLElement>("#month-viewport");

      if (
        viewport === null ||
        !Option.contains(monthHostKey(readModel()), hostKey)
      ) {
        return;
      }

      const { rowHeight } = monthGeometry(
        initial.calendar.viewport,
        initial.settings.showWeekNumbers
      );

      const [first] = monthWeeks(initial.calendar.navigation);

      const saved = Option.getOrUndefined(initial.month.settled);

      const position =
        saved !== undefined && saved.session.hostKey === hostKey
          ? saved.position
          : undefined;

      const actor = yield* createEffectActor(monthScrollMachine, {
        input: {
          covered: Option.none(),
          hostKey,
          position,
          rowHeight,
          visibleWeek: first?.start ?? initial.calendar.navigation.anchor,
        },
      });

      yield* watchActor("calendar.monthScroll", actor);

      const session = yield* MonthRuntime.use((runtime) =>
        runtime.bind(hostKey, actor)
      );

      const emit = monthNoticeEmitter(queue);

      emit(
        MonthNotice.cases.Frame.make({
          frame: MonthWindowFrame.make({
            firstWeek: actor.getSnapshot().context.position.firstWeek,
            pinnedWeek:
              Option.getOrUndefined(initial.month.frame)?.frame.pinnedWeek ??
              Option.none(),
            revision: 0,
          }),
          session,
        })
      );
      yield* waitForMonthFrame(viewport, {
        id: 0,
        pinnedWeek: Option.none(),
        position: actor.getSnapshot().context.position,
        rows: 0,
      });
      viewport.scrollTop = actor.getSnapshot().context.position.scrollTop;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          bindMonthScroll({
            actor,
            limits: monthScrollLimits(
              initial.calendar.navigation.weekStartsOn ?? 0
            ),
            readHost: () => Option.getOrUndefined(monthHostKey(readModel())),
            viewport,
          })
        ),
        (release) => Effect.sync(release)
      );
      yield* snapshots(actor).pipe(
        Stream.map((snapshot) => snapshot.context),
        Stream.changesWith(
          (left, right) =>
            Option.getOrUndefined(left.pendingRebase)?.id ===
              Option.getOrUndefined(right.pendingRebase)?.id &&
            left.position.firstWeek === right.position.firstWeek &&
            left.sequence === right.sequence
        ),
        Stream.switchMap((context) => {
          const pending = context.pendingRebase;

          if (Option.isNone(pending)) {
            return Stream.fromEffect(
              Effect.sync(() => {
                emit(
                  MonthNotice.cases.Frame.make({
                    frame: MonthWindowFrame.make({
                      firstWeek: context.position.firstWeek,
                      pinnedWeek:
                        Option.getOrUndefined(readModel().month.frame)?.frame
                          .pinnedWeek ?? Option.none(),
                      revision: context.sequence,
                    }),
                    session,
                  })
                );
              })
            );
          }

          const request = pending.value;

          return Stream.fromEffect(
            Effect.acquireUseRelease(
              Effect.sync(() => retainMonthFocus(viewport)),
              (lease) =>
                Effect.gen(function* commitMonthFrame() {
                  emit(
                    MonthNotice.cases.Frame.make({
                      frame: MonthWindowFrame.make({
                        firstWeek: request.position.firstWeek,
                        pinnedWeek: request.pinnedWeek,
                        revision: request.id,
                      }),
                      session,
                    })
                  );
                  yield* waitForMonthFrame(viewport, request);

                  if (!Option.contains(monthHostKey(readModel()), hostKey)) {
                    return;
                  }

                  const applied = applyMonthRebase(
                    viewport,
                    request,
                    rowHeight
                  );

                  if (Option.isSome(applied)) {
                    lease.pipe(Option.map((focus) => focus.restore()));
                    yield* send(actor, {
                      ...applied.value,
                      id: request.id,
                      type: "APPLIED",
                    });
                  }
                }),
              (lease) =>
                Effect.sync(() => {
                  if (Option.isSome(lease)) {
                    lease.value.release();
                  }
                })
            )
          );
        }),
        Stream.runDrain,
        Effect.forkScoped
      );
      yield* snapshots(actor).pipe(
        Stream.map((snapshot) => snapshot.context.request),
        Stream.changesWith(
          (left, right) =>
            Option.getOrUndefined(left)?.id === Option.getOrUndefined(right)?.id
        ),
        Stream.runForEach((request) =>
          Effect.sync(() => {
            if (Option.isSome(request)) {
              emit(
                MonthNotice.cases.Read.make({ request: request.value, session })
              );
            }
          })
        ),
        Effect.forkScoped
      );
      yield* snapshots(actor).pipe(
        Stream.filter((snapshot) => snapshot.matches("idle")),
        Stream.map((snapshot) => ({
          anchor: settledMonthAnchor(snapshot.context.position, rowHeight),
          position: snapshot.context.position,
        })),
        Stream.changesWith(
          (left, right) =>
            left.position.firstWeek === right.position.firstWeek &&
            left.position.scrollTop === right.position.scrollTop
        ),
        Stream.runForEach(({ anchor, position: settledPosition }) =>
          Effect.sync(() => {
            emit(
              MonthNotice.cases.Settled.make({
                anchor,
                position: settledPosition,
                session,
              })
            );
          })
        ),
        Effect.forkScoped
      );
      yield* send(actor, { type: "SETTLED" });
    })
  );
};

export const monthScrollStream = (
  initial: AppModel,
  readModel: () => AppModel
): Stream.Stream<AppMessage, never, MonthRuntime> =>
  Option.isNone(monthHostKey(initial))
    ? Stream.empty
    : Stream.unwrap(
        MonthRuntime.use((runtime) =>
          Effect.succeed(
            runtime.viewChanges.pipe(
              Stream.changesWith(
                (left, right) =>
                  left.revision === right.revision && left.state === right.state
              ),
              Stream.switchMap((snapshot) =>
                snapshot.state === "Live"
                  ? liveMonthScrollStream(readModel(), readModel)
                  : Stream.empty
              )
            )
          )
        )
      );
