import { promptChannels, promptWire } from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { DateTime, Match, Schema } from "effect";
import type { ElectronApplication, Page } from "playwright-core";

const title =
  '<img src=x onerror="document.documentElement.dataset.executed=1">';

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const fixturePath = "/__desktop-proof/native";

// @effect-diagnostics-next-line asyncFunction:off -- This proof reads the real renderer document to reject an active hosted publication source.
const assertQuiescentFixture = async (main: Page) => {
  const state = await main.evaluate(() => ({
    bridge: window.potionDesktop !== undefined,
    fixture:
      document.documentElement.dataset.desktopNativeProof === "quiescent",
    scripts: document.scripts.length,
    sourceRequests: performance
      .getEntriesByType("resource")
      .filter(
        (entry) =>
          entry instanceof PerformanceResourceTiming &&
          ["script", "fetch", "xmlhttprequest"].includes(entry.initiatorType)
      ).length,
  }));

  assert(
    state.bridge &&
      state.fixture &&
      state.scripts === 0 &&
      state.sourceRequests === 0,
    "Native prompt proof requires its script-free fixture with no hosted scripts, fetches or upcoming refresh source"
  );
};

// @effect-diagnostics-next-line asyncFunction:off -- A new same-origin document destroys the hosted program and its subscriptions without changing product behavior.
const prepareQuiescentFixture = async (main: Page) => {
  const { origin } = new URL(main.url());
  await main.route(
    (url) => url.origin === origin && url.pathname === fixturePath,
    // @effect-diagnostics-next-line asyncFunction:off -- Playwright fulfills only this owned proof document and never contacts the dev server for it.
    async (route) => {
      await route.fulfill({
        body: '<!doctype html><html lang="en" data-desktop-native-proof="quiescent"><head><meta charset="utf-8"><title>Native bridge proof</title></head><body><h1>Native bridge proof</h1></body></html>',
        contentType: "text/html",
        headers: {
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; script-src 'none'; connect-src 'none'",
        },
        status: 200,
      });
    }
  );
  await main.goto(`${origin}${fixturePath}`, { waitUntil: "load" });
  await assertQuiescentFixture(main);
  await main.evaluate(() => {
    const bridge = window.potionDesktop;

    if (bridge === undefined) {
      throw new Error("Native fixture bridge is missing");
    }

    bridge.publishAgenda({ events: [] });
    bridge.onAction((action) => {
      if ("key" in action) {
        const target = new URL(location.href);
        target.searchParams.set(
          "shown",
          `${action.key.accountId}/${action.key.calendarId}/${action.key.eventId}`
        );
        location.assign(target.href);
      }
    });
  });
};

// @effect-diagnostics-next-line asyncFunction:off -- This Mac-only proof awaits real Electron windows and IPC through Playwright's native Promises.
export const proveNativePrompt = async (
  application: ElectronApplication,
  main: Page
) => {
  await prepareQuiescentFixture(main);

  // @effect-diagnostics-next-line asyncFunction:off -- Each owned card must close before the next native-window proof begins.
  const proveCard = async (
    action: "join" | "show" | "dismiss" | "escape",
    index: number
  ) => {
    const now = DateTime.toEpochMillis(DateTime.nowUnsafe());

    const meeting: AgendaEventValue = {
      allDay: false,
      calendarColor: "#64748b",
      conferenceUrl: "https://meet.example.test/native-proof",
      end: now + 30 * 60_000,
      hasLocation: false,
      hasParticipants: true,
      key: {
        accountId: "native-proof",
        calendarId: "primary",
        eventId: `prompt-${index}`,
      },
      responseStatus: "accepted",
      start: now + 30_000,
      title,
    };

    const opened = application.waitForEvent("window");
    await main.evaluate((event) => {
      window.potionDesktop?.publishAgenda({ events: [event] });
    }, meeting);
    const card = await opened;
    let actionObserved = false;

    try {
      await card.getByRole("heading", { exact: true, name: title }).waitFor();
      assert(
        (await card.locator("img").count()) === 0,
        "Prompt titles must render as literal text, never HTML"
      );
      assert(
        await card
          .getByRole("button", { exact: true, name: "Join" })
          .evaluate((button) => document.activeElement === button),
        "Prompt keyboard focus must start on Join"
      );
      assert(
        (await card.evaluate(() =>
          document
            .querySelector('meta[http-equiv="Content-Security-Policy"]')
            ?.getAttribute("content")
            ?.startsWith("default-src 'none'")
        )) === true,
        "The local prompt must keep its default-deny CSP"
      );

      const previousView = await card.evaluate(
        // @effect-diagnostics-next-line asyncFunction:off -- The proof observes the real preload cache before republishing the same saved meeting key and start.
        async () => await window.potionPrompt?.getView()
      );

      if (previousView === undefined) {
        throw new Error("Prompt view is missing before repeated publication");
      }

      const republished = { ...meeting, end: meeting.end + 60_000 };
      await main.evaluate((event) => {
        window.potionDesktop?.publishAgenda({ events: [event] });
      }, republished);
      await card.waitForFunction(
        // @effect-diagnostics-next-line asyncFunction:off -- A newer real prompt revision acknowledges the repeated agenda without a timing delay.
        async ({ revision, eventId, end }) => {
          const view = await window.potionPrompt?.getView();

          return (
            view !== undefined &&
            view.revision > revision &&
            view.events.some(
              (event) => event.key.eventId === eventId && event.end === end
            )
          );
        },
        {
          end: republished.end,
          eventId: meeting.key.eventId,
          revision: previousView.revision,
        }
      );

      const rejected = card.waitForEvent("console", {
        predicate: (message) =>
          message.text().includes("Rejected local prompt payload"),
      });

      await application.evaluate(({ BrowserWindow }, channel) => {
        const prompt = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().endsWith("/prompt.html")
        );

        if (prompt === undefined) {
          throw new Error("Prompt window is missing");
        }

        prompt.webContents.send(
          channel,
          '{"events":"malformed","revision":999}'
        );
      }, promptChannels.view);
      await rejected;
      assert(
        (await card
          .getByRole("heading", { exact: true, name: title })
          .count()) === 1,
        "A malformed view must not replace the visible card"
      );

      const observed = application.evaluate(
        // @effect-diagnostics-next-line asyncFunction:off -- The serialized observer awaits a real native IPC event and cannot close over the test runtime.
        async ({ app, ipcMain, shell }, channel) => {
          const { EventEmitter } = process.getBuiltinModule("node:events");
          const cancelled = new AbortController();

          const received = EventEmitter.once(
            app,
            "desktop-proof-prompt-action",
            {
              signal: AbortSignal.any([
                cancelled.signal,
                AbortSignal.timeout(30_000),
              ]),
            }
          );

          const original = shell.openExternal.bind(shell);
          // oxlint-disable-next-line typescript/promise-function-async -- This owned native port prevents every external browser launch during the card proof.
          shell.openExternal = function openExternal(url) {
            app.emit("desktop-proof-blocked-open", url);

            return Promise.resolve();
          };

          app.setBadgeCount(0);

          const listener: Parameters<typeof ipcMain.on>[1] = (
            _event,
            value
          ) => {
            app.setBadgeCount(app.getBadgeCount() + 1);
            app.emit("desktop-proof-prompt-action", value);
          };

          ipcMain.on(channel, listener);
          EventEmitter.prototype.once.call(
            app,
            "desktop-proof-prompt-cleanup",
            () => {
              cancelled.abort();
              ipcMain.removeListener(channel, listener);
              shell.openExternal = original;
            }
          );

          try {
            const values: readonly unknown[] = await received;

            return String(values[0]);
          } catch {
            return "";
          }
        },
        promptChannels.action
      );

      assert(
        (await application.evaluate(
          ({ ipcMain }, channel) => ipcMain.listenerCount(channel),
          promptChannels.action
        )) > 1,
        "The native proof observer must be installed before a card action"
      );

      try {
        assert(
          !card.isClosed(),
          `Native ${action} card closed before its intended action`
        );
        const closed = card.waitForEvent("close");

        const shown =
          action === "show"
            ? main.waitForURL(
                (url) =>
                  url.pathname === fixturePath &&
                  url.searchParams.get("shown") ===
                    `${meeting.key.accountId}/${meeting.key.calendarId}/${meeting.key.eventId}`,
                { waitUntil: "load" }
              )
            : undefined;

        // @effect-diagnostics-next-line asyncFunction:off -- The native input and its close, navigation and IPC acknowledgements are awaited together.
        const activate = async () => {
          if (action === "escape") {
            await card.bringToFront();
            await card.keyboard.press("Escape");
          } else {
            const label = Match.value(action).pipe(
              Match.when("join", () => "Join"),
              Match.when("show", () => "Show event"),
              Match.orElse(() => "Dismiss")
            );

            await card
              .getByRole("button", { exact: true, name: label })
              .click();
          }
        };

        const [raw] = await Promise.all([observed, closed, shown, activate()]);
        const message = Schema.decodeSync(promptWire.action)(raw);
        assert(
          message.action === (action === "escape" ? "dismiss" : action),
          "A card action must use its declared typed intent"
        );
        assert(
          message.key.eventId === meeting.key.eventId,
          "A card action must retain the displayed meeting key"
        );
        actionObserved = true;
        await assertQuiescentFixture(main);
        assert(
          (await application.evaluate(({ app }) => app.getBadgeCount())) === 1,
          "Each card action must send exactly one native intent"
        );
      } finally {
        await application.evaluate(({ app }) => {
          app.emit("desktop-proof-prompt-cleanup");
        });
      }
    } catch (error) {
      if (card.isClosed() && !actionObserved) {
        throw new Error(
          `Native prompt proof ${action} (${meeting.key.eventId}): card closed before its intended action completed in the quiescent fixture`,
          { cause: error }
        );
      }

      throw error;
    }
  };

  await proveCard("join", 1);
  await proveCard("show", 2);
  await proveCard("dismiss", 3);
  await proveCard("escape", 4);
  await main.evaluate(() => {
    window.potionDesktop?.publishAgenda({ events: [] });
  });
};
