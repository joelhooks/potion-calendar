import { setupEffect } from "@xstate/effect";
import { Schema } from "effect";
import { initialTransition, transition } from "xstate";

export const liveAdmissionMachine = setupEffect({
  schemas: {
    events: {
      Pause: Schema.Struct({}),
      Resume: Schema.Struct({}),
    },
  },
}).createMachine({
  initial: "running",
  states: {
    paused: { on: { Resume: { target: "running" } } },
    running: { on: { Pause: { target: "paused" } } },
  },
});

export const liveAdmission = () => {
  let [snapshot] = initialTransition(liveAdmissionMachine);

  return {
    accepts: () => snapshot.matches("running"),
    pause: () => {
      const admitted = snapshot.matches("running");
      [snapshot] = transition(liveAdmissionMachine, snapshot, {
        type: "Pause",
      });

      return admitted;
    },
    resume: () => {
      [snapshot] = transition(liveAdmissionMachine, snapshot, {
        type: "Resume",
      });
    },
  };
};

export type LiveAdmission = ReturnType<typeof liveAdmission>;
