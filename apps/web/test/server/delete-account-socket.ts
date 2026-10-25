import { Effect, Schema } from "effect";

class ObserverConnectionError extends Schema.TaggedError<ObserverConnectionError>()(
  "ObserverConnectionError",
  {}
) {}

const NativeSocket = Schema.instanceOf(WebSocket);

export const deletionObserver = Effect.fn("test.deletionObserver")(
  function* deletionObserver(
    address: URL,
    cookie: string,
    origin: string,
    closed: (code: number) => void
  ) {
    const url = new URL("/live", address);
    url.protocol = "ws:";

    const socket = yield* Effect.acquireRelease(
      Effect.suspend(() =>
        Schema.decodeUnknownEffect(NativeSocket)(
          Reflect.construct(WebSocket, [url, { headers: { cookie, origin } }])
        )
      ),
      (current) =>
        Effect.sync(() => {
          current.close();
        })
    );

    socket.addEventListener("close", (event) => {
      closed(event.code);
    });
    yield* Effect.callback<boolean, ObserverConnectionError>((resume) => {
      const opened = () => {
        resume(Effect.succeed(true));
      };

      const failed = () => {
        resume(Effect.fail(new ObserverConnectionError()));
      };

      socket.addEventListener("open", opened, { once: true });
      socket.addEventListener("error", failed, { once: true });

      return Effect.sync(() => {
        socket.removeEventListener("open", opened);
        socket.removeEventListener("error", failed);
      });
    });

    return socket;
  }
);
