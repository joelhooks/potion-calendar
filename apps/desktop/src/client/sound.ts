import type {
  PlayablePromptSound,
  PromptSoundReply,
  PromptSoundRequest,
} from "@calendar/core/desktop-bridge";
import { Predicate } from "effect";

export interface ResumableAudio {
  readonly state: AudioContextState;
  readonly resume: () => Promise<void>;
}

interface OwnedAudio {
  context: AudioContext | undefined;
}

interface ToneEnvelope {
  readonly duration: number;
  readonly frequency: number;
  readonly gain: number;
  readonly wave: OscillatorType;
}

const tones = {
  bell: { duration: 0.7, frequency: 880, gain: 0.12, wave: "sine" },
  blip: { duration: 0.12, frequency: 1320, gain: 0.1, wave: "sine" },
  tap: { duration: 0.025, frequency: 240, gain: 0.09, wave: "triangle" },
} satisfies Record<typeof PlayablePromptSound.Type, ToneEnvelope>;

export const toneEnvelope = (sound: typeof PlayablePromptSound.Type) =>
  tones[sound];

// @effect-diagnostics-next-line asyncFunction:off -- Web Audio resume is a native renderer Promise; the main Effect lifecycle bounds its readiness wait.
export const prepareAudio = async (
  context: ResumableAudio
): Promise<boolean> => {
  try {
    if (context.state !== "running") {
      await context.resume();
    }

    return context.state === "running";
  } catch {
    return false;
  }
};

export const createToneAudio = () => {
  const owned: OwnedAudio = { context: undefined };

  return {
    // @effect-diagnostics-next-line asyncFunction:off -- The isolated local prompt owns Web Audio and reports rejected or still-suspended resume through its readiness reply.
    load: async (): Promise<boolean> => {
      try {
        owned.context ??= new AudioContext({ latencyHint: "interactive" });

        return await prepareAudio(owned.context);
      } catch {
        return false;
      }
    },
    play: (sound: typeof PlayablePromptSound.Type): boolean => {
      const { context } = owned;

      if (context === undefined || context.state !== "running") {
        return false;
      }

      try {
        const tone = toneEnvelope(sound);
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        const now = context.currentTime;
        oscillator.type = tone.wave;
        oscillator.frequency.setValueAtTime(tone.frequency, now);
        envelope.gain.setValueAtTime(0.0001, now);
        envelope.gain.exponentialRampToValueAtTime(tone.gain, now + 0.004);
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + tone.duration);
        oscillator.connect(envelope);
        envelope.connect(context.destination);
        oscillator.addEventListener(
          "ended",
          () => {
            oscillator.disconnect();
            envelope.disconnect();
          },
          { once: true }
        );
        oscillator.start(now);
        oscillator.stop(now + tone.duration + 0.005);

        return true;
      } catch {
        return false;
      }
    },
  };
};

export interface ToneAudioPort {
  readonly load: () => Promise<boolean>;
  readonly play: (sound: typeof PlayablePromptSound.Type) => boolean;
}

interface SoundPreparation {
  readonly phase: "loading" | "ready";
  readonly sound: typeof PlayablePromptSound.Type;
}

export const createSoundReceiver = (
  audio: ToneAudioPort,
  reply: (result: typeof PromptSoundReply.Type) => void
) => {
  const requests = new Map<number, SoundPreparation>();

  // @effect-diagnostics-next-line asyncFunction:off -- The isolated renderer consumes typed IPC; cancellation and deadlines remain in the main Effect actor.
  return async (request: typeof PromptSoundRequest.Type): Promise<void> => {
    if (Predicate.isTagged(request, "Cancel")) {
      requests.delete(request.request);

      return;
    }

    if (Predicate.isTagged(request, "Play")) {
      const prepared = requests.get(request.request);
      requests.delete(request.request);

      const ready =
        prepared?.phase === "ready" &&
        prepared.sound === request.sound &&
        audio.play(request.sound);

      reply({ phase: "play", ready, request: request.request });

      return;
    }

    if (requests.has(request.request)) {
      return;
    }

    const loading = { phase: "loading", sound: request.sound } as const;
    requests.set(request.request, loading);
    const ready = await audio.load();

    if (requests.get(request.request) !== loading) {
      return;
    }

    if (ready) {
      requests.set(request.request, { phase: "ready", sound: request.sound });
    } else {
      requests.delete(request.request);
    }

    reply({ phase: "load", ready, request: request.request });
  };
};
