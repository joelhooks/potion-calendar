import { Effect, Schema } from "effect";

export const rpcDocument = Effect.fn("rpcDocument")(function* rpcDocument(
  backend: (request: Request) => Promise<Response>,
  tag: string,
  payload: Schema.Json = {},
  headers: Headers = new Headers()
) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("content-type", "application/json");

  if (!requestHeaders.has("origin")) {
    requestHeaders.set("origin", "http://calendar.test");
  }

  const request = new Request("http://calendar.test/rpc", {
    body: `{"_tag":"Request","headers":[],"id":"1","tag":${JSON.stringify(tag)},"payload":${JSON.stringify(payload)}}`,
    headers: requestHeaders,
    method: "POST",
  });

  const response = yield* Effect.promise(backend.bind(undefined, request));
  const body: unknown = yield* Effect.promise(response.json.bind(response));

  return body;
});

export const rpcValue = <A>(schema: Schema.Codec<A>) =>
  Schema.toCodecJson(
    Schema.NonEmptyArray(
      Schema.Struct({ exit: Schema.Struct({ value: schema }) })
    )
  );

export const rpcFailure = <A>(schema: Schema.Codec<A>) =>
  Schema.toCodecJson(
    Schema.NonEmptyArray(
      Schema.Struct({
        exit: Schema.Struct({
          cause: Schema.NonEmptyArray(Schema.Struct({ error: schema })),
        }),
      })
    )
  );
