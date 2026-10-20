// @effect-diagnostics-next-line nodeBuiltinImport:off -- State is generated in the main process with the OS CSPRNG.
import { randomBytes } from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The main process owns a one-shot loopback HTTP listener; no Node APIs enter the page.
import { createServer } from "node:http";

import { Effect, Option, Schema } from "effect";

import { parseCallback } from "./callback.js";
import { DesktopError } from "./config.js";

const Address = Schema.Struct({ port: Schema.Int });

export const waitForSignIn = (
  origin: string,
  open: (url: string) => Promise<void>
) =>
  Effect.callback<string, DesktopError>((resume) => {
    const state = randomBytes(32).toString("hex");

    const server = createServer((request, response) => {
      const address = Schema.decodeUnknownOption(Address)(server.address());

      if (Option.isNone(address)) {
        response.writeHead(400).end();

        return;
      }

      const host = `127.0.0.1:${address.value.port}`;

      const token =
        request.method === "GET" && request.headers.host === host
          ? parseCallback(request.url ?? "", host, state)
          : null;

      if (token === null) {
        response
          .writeHead(400, {
            "cache-control": "no-store",
            "content-type": "text/plain",
          })
          .end(
            "Sign-in refused. Return to Potion Calendar and choose Try again.",
            () => {
              resume(
                Effect.fail(
                  new DesktopError({ message: "Desktop callback refused" })
                )
              );
            }
          );

        return;
      }

      response
        .writeHead(200, {
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; frame-ancestors 'none'",
          "content-type": "text/html; charset=utf-8",
          "referrer-policy": "no-referrer",
        })
        .end(
          '<!doctype html><html lang="en"><meta charset="utf-8"><title>Potion Calendar</title><h1>Return to Potion Calendar</h1><p>You can close this tab.</p></html>',
          () => {
            server.close();
            resume(Effect.succeed(token));
          }
        );
    });

    server.on("error", () => {
      resume(
        Effect.fail(
          new DesktopError({ message: "Could not start desktop sign-in" })
        )
      );
    });
    server.listen(0, "127.0.0.1", () => {
      const address = Schema.decodeUnknownOption(Address)(server.address());

      if (Option.isNone(address)) {
        resume(
          Effect.fail(
            new DesktopError({ message: "Could not start desktop sign-in" })
          )
        );

        return;
      }

      const url = new URL("/desktop/sign-in", origin);
      url.searchParams.set("port", String(address.value.port));
      url.searchParams.set("state", state);
      // oxlint-disable-next-line promise/prefer-await-to-then -- The Node listening callback settles the Effect callback when the native browser opener rejects.
      open(url.href).catch(() => {
        resume(
          Effect.fail(
            new DesktopError({ message: "Could not open the system browser" })
          )
        );
      });
    });

    return Effect.sync(() => {
      server.close();
      server.closeAllConnections();
    });
  }).pipe(Effect.timeoutOption("2 minutes"));
