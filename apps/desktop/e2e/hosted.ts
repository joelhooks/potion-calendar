import { desktopWire } from "@calendar/core/desktop-bridge";
import { DateTime, Option, Schema } from "effect";
import type { ElectronApplication, Page } from "playwright-core";

import { hostedFailureTrace } from "./hosted-diagnostics.ts";
import { observeHostedAgenda } from "./hosted-observer.ts";
import type { DesktopStateCapture } from "./state-capture.ts";

const timestamp = () => DateTime.toEpochMillis(DateTime.nowUnsafe());

// @effect-diagnostics-next-line asyncFunction:off -- The Mac proof observes real hosted IPC and buffers only whitelisted fake-data diagnostics until failure.
export const proveHostedPublication = async (
  application: ElectronApplication,
  page: Page,
  capture: DesktopStateCapture
) => {
  const now = timestamp();
  const start = Math.floor((now + 20 * 60_000) / 60_000) * 60_000;
  const end = start + 30 * 60_000;
  const title = `Desktop upcoming proof ${now}`;
  const startIso = DateTime.formatIso(DateTime.makeUnsafe(start));
  const endIso = DateTime.formatIso(DateTime.makeUnsafe(end));
  const { states } = capture;
  const milestones: { kind: string; timestamp: number }[] = [];
  let savedAt: number | undefined;
  let reloadAt = now;

  const observer = await observeHostedAgenda(application, page, title);

  try {
    reloadAt = timestamp();
    milestones.push({ kind: "reload-requested", timestamp: reloadAt });
    await page.reload({ waitUntil: "load" });
    milestones.push({ kind: "reload-loaded", timestamp: timestamp() });
    await page.locator(".calendar-toggle").first().waitFor();

    const environment = await page.evaluate(() => ({
      development:
        ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
        [...document.scripts].some(
          (script) =>
            script.src.length > 0 &&
            new URL(script.src).pathname === "/@vite/client"
        ),
      documentEpoch: performance.timeOrigin,
    }));

    if (
      environment.development &&
      !states.some((state) => state.documentEpoch === environment.documentEpoch)
    ) {
      throw new Error(
        "Loopback development proof requires a current-document model observer; no state was received after the calendar rendered"
      );
    }

    await page.getByRole("button", { exact: true, name: "Create" }).click();
    const editor = page.locator("#event-editor-dialog");
    await editor.waitFor();
    await editor.locator("#event-timeZone").click();
    await page.locator("#keyboard-query").fill("UTC");
    await page.locator("#command-UTC").click();
    await page.locator("#keyboard-command-dialog").waitFor({ state: "hidden" });
    await editor.locator("#event-startDate").fill(startIso.slice(0, 10));
    await editor.locator("#event-startTime").fill(startIso.slice(11, 16));
    await editor.locator("#event-endDate").fill(endIso.slice(0, 10));
    await editor.locator("#event-endTime").fill(endIso.slice(11, 16));
    await editor.locator("#event-title").fill(title);
    milestones.push({ kind: "save-clicked", timestamp: timestamp() });
    await editor.getByRole("button", { exact: true, name: "Save" }).click();

    await editor.waitFor({ state: "hidden" });
    savedAt = capture.acknowledged(title);
    const modelAcknowledged = savedAt !== undefined;

    if (environment.development && !modelAcknowledged) {
      throw new Error(
        "Loopback development proof requires the matching model save acknowledgement; editor-close fallback is not permitted"
      );
    }

    savedAt ??= timestamp();
    milestones.push(
      {
        kind: modelAcknowledged
          ? "save-model-acknowledged"
          : "save-editor-closed-without-model-ack",
        timestamp: savedAt,
      },
      {
        kind: "publication-deadline-armed",
        timestamp: timestamp(),
      }
    );
    await observer.arm(savedAt);
    const published = await observer.received;
    const decoded = Schema.decodeOption(desktopWire.agenda)(published.payload);

    if (!published.delivered) {
      const titles = Option.match(decoded, {
        onNone: () => "(no valid agenda)",
        onSome: (agenda) =>
          JSON.stringify(agenda.events.map((event) => event.title)),
      });

      throw new Error(
        `Hosted upcoming publication did not deliver the run-relative saved proof meeting within 30 seconds after save acknowledgement. Last received agenda titles: ${titles}`
      );
    }

    if (Option.isNone(decoded)) {
      throw new Error("Hosted publication delivered an invalid native agenda");
    }

    const meeting = decoded.value.events.find((event) => event.title === title);

    if (
      meeting === undefined ||
      meeting.key.accountId === "" ||
      meeting.key.calendarId === "" ||
      meeting.key.eventId === "" ||
      meeting.start !== start ||
      meeting.end !== end
    ) {
      throw new Error(
        "The native main process must receive the fake provider's saved meeting key and title from the real hosted program"
      );
    }

    const cleared = application.evaluate(
      // @effect-diagnostics-next-line asyncFunction:off -- The proof waits for the actual signed-out hosted document to publish an empty agenda.
      async ({ app }) => {
        const { EventEmitter: NativeEvents } =
          process.getBuiltinModule("node:events");

        const values: readonly unknown[] = await NativeEvents.once(
          app,
          "desktop-proof-hosted-empty",
          { signal: AbortSignal.timeout(30_000) }
        );

        return String(values[0]);
      }
    );

    if (
      (await application.evaluate(({ app }) =>
        app.listenerCount("desktop-proof-hosted-empty")
      )) !== 1
    ) {
      throw new Error(
        "Sign-out publication observer must be installed before the real sign-out action"
      );
    }

    const [empty] = await Promise.all([
      cleared,
      page.getByRole("button", { exact: true, name: "Sign out" }).click(),
    ]);

    await page
      .getByRole("button", { exact: true, name: "Sign in with Google" })
      .waitFor();

    if (Schema.decodeSync(desktopWire.agenda)(empty).events.length !== 0) {
      throw new Error(
        "Sign out must leave no previously received native meetings"
      );
    }

    process.stdout.write(
      `${JSON.stringify({ cleared: true, key: meeting.key, kind: "desktop-hosted-publication", title: meeting.title })}\n`
    );
  } catch (error) {
    let trace: Awaited<ReturnType<typeof observer.trace>> = Option.none();

    try {
      trace = await observer.trace();
    } catch {
      trace = Option.none();
    }

    process.stderr.write(
      `${JSON.stringify({ ...hostedFailureTrace(trace, states, reloadAt, savedAt), ...capture.stats(), kind: "desktop-hosted-failure", milestones })}\n`
    );
    throw error;
  } finally {
    await observer.close();
  }
};
