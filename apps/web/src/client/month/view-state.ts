import { Effect, Queue, Stream } from "effect";
import type { Mount } from "foldkit";

interface MonthViewSnapshot {
  readonly revision: number;
  readonly state: Mount.ViewState;
}

const monthViewListener =
  (queue: Queue.Enqueue<MonthViewSnapshot>) =>
  (snapshot: MonthViewSnapshot) => {
    Queue.offerUnsafe(queue, snapshot);
  };

export const monthViewRegistry = () => {
  let current: MonthViewSnapshot = { revision: 0, state: "Paused" };
  let sequence = 0;
  const listeners = new Set<(snapshot: MonthViewSnapshot) => void>();

  const publish = (snapshot: MonthViewSnapshot) => {
    current = snapshot;

    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  return {
    changes: Stream.callback<MonthViewSnapshot>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const listener = monthViewListener(queue);
          listeners.add(listener);
          listener(current);

          return listener;
        }),
        (listener) =>
          Effect.sync(() => {
            listeners.delete(listener);
          })
      )
    ),
    register: () => {
      sequence += 1;
      const revision = sequence;
      publish({ revision, state: "Paused" });

      return {
        release: () => {
          if (current.revision === revision) {
            sequence += 1;
            publish({ revision: sequence, state: "Paused" });
          }
        },
        set: (state: Mount.ViewState) => {
          if (current.revision === revision) {
            publish({ revision, state });
          }
        },
      };
    },
  };
};

export type MonthViewRegistry = ReturnType<typeof monthViewRegistry>;
