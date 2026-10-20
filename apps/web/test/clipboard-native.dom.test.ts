import { Calendar } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, Stream } from "effect";
import { vi } from "vitest";

import { clipboardMarker } from "../src/client/clipboard/identity.js";
import {
  ClipboardAnchor,
  NativeClipboardNotice,
} from "../src/client/clipboard/model.js";
import {
  nativeClipboardEvents,
  nativeClipboardReceiver,
  observeNativeClipboard,
} from "../src/client/clipboard/native.js";
import type { NativeClipboardHost } from "../src/client/clipboard/native.js";
import { keyboardMessage } from "../src/client/keyboard/input.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { clipboardSource } from "./clipboard-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";

const host = (): NativeClipboardHost => ({
  anchor: ClipboardAnchor.cases.Timed.make({
    date: "2026-10-19",
    instant: 1_792_429_200_000,
  }),
  copied: { id: "opaque-native.1", personId: "person-A" },
  personId: "person-A",
  selected: clipboardSource,
  selfEmails: ["owner@example.test"],
  sessionId: "opaque-native",
  target: {
    calendar: Calendar.make({
      accessRole: "owner",
      accountId: "work",
      calendarId: "primary",
      primary: true,
      timeZone: "America/Los_Angeles",
      title: "Work",
    }),
    navigation: initialNavigation(dayFromIso("2026-10-19")),
    primaryZone: "America/Los_Angeles",
    selection: Option.none(),
  },
});

const nativeEvent = (text = "", target: EventTarget | null = document.body) => {
  let prevented = false;
  const contents = new Map([["text/plain", text]]);

  const clearData = vi.fn(() => {
    contents.clear();
  });

  const getData = vi.fn((kind: string) => contents.get(kind) ?? "");

  const setData = vi.fn((kind: string, value: string) => {
    contents.set(kind, value);
  });

  const event = {
    clipboardData: { clearData, getData, setData },
    get defaultPrevented() {
      return prevented;
    },
    isTrusted: true,
    preventDefault: vi.fn(() => {
      prevented = true;
    }),
    target,
  };

  return { clearData, contents, event, getData, setData };
};

it.effect.each(["copy", "cut"] as const)(
  "trusted native %s writes only the opaque marker and emits one owned copy",
  (operation) =>
    Effect.sync(() => {
      const fixture = nativeEvent();
      fixture.contents.set(
        "text/html",
        "<p>Event content stays in tab memory</p>"
      );

      const notice = Option.getOrThrow(
        observeNativeClipboard(
          host(),
          fixture.event,
          operation,
          1,
          document,
          false
        )
      );

      expect(NativeClipboardNotice.guards.Copied(notice)).toBe(true);
      expect(fixture.setData).toHaveBeenCalledExactlyOnceWith(
        "text/plain",
        clipboardMarker("opaque-native.1")
      );
      expect(fixture.event.defaultPrevented).toBe(true);
      expect([...fixture.contents.entries()]).toEqual([
        ["text/plain", clipboardMarker("opaque-native.1")],
      ]);
      expect([...fixture.contents.values()].join(",")).not.toContain(
        clipboardSource.title ?? "Product review"
      );
      expect([...fixture.contents.values()].join(",")).not.toContain(
        "person-A"
      );

      if (NativeClipboardNotice.guards.Copied(notice)) {
        expect(notice.mode).toBe(operation);
        expect(notice.envelope.items[0].source.eventId).toBe(
          clipboardSource.eventId
        );
      }
    })
);

it.effect(
  "a marker match creates one paste intent without reading or queuing arbitrary event text",
  () =>
    Effect.sync(() => {
      const fixture = nativeEvent(clipboardMarker("opaque-native.1"));

      const notice = Option.getOrThrow(
        observeNativeClipboard(
          host(),
          fixture.event,
          "paste",
          2,
          document,
          false
        )
      );

      expect(NativeClipboardNotice.guards.Paste(notice)).toBe(true);
      expect(fixture.getData).toHaveBeenCalledExactlyOnceWith("text/plain");
      expect(fixture.setData).not.toHaveBeenCalled();
      expect(fixture.event.defaultPrevented).toBe(true);
    })
);

it.effect(
  "a clipboard-text mismatch is left native and clears event identity without retaining its raw text",
  () =>
    Effect.sync(() => {
      const privateText = "private synthetic clipboard text, not an event";
      const fixture = nativeEvent(privateText);

      const notice = Option.getOrThrow(
        observeNativeClipboard(
          host(),
          fixture.event,
          "paste",
          2,
          document,
          false
        )
      );

      expect(NativeClipboardNotice.guards.Invalidated(notice)).toBe(true);
      expect(JSON.stringify(notice)).not.toContain(privateText);
      expect(fixture.event.defaultPrevented).toBe(false);
      expect(fixture.setData).not.toHaveBeenCalled();
    })
);

it.effect("a mismatched person refuses before reading clipboard contents", () =>
  Effect.sync(() => {
    const fixture = nativeEvent("private text");
    const model = { ...host(), personId: "person-B" };

    const notice = Option.getOrThrow(
      observeNativeClipboard(model, fixture.event, "paste", 2, document, false)
    );

    expect(NativeClipboardNotice.guards.Refused(notice)).toBe(true);
    expect(fixture.getData).not.toHaveBeenCalled();
  })
);

it.effect.each(["copy", "cut", "paste"] as const)(
  "focused text and its native %s roles remain untouched even if the event target is body",
  (operation) =>
    Effect.gen(function* focusedNativeText() {
      const input = document.createElement("input");
      input.value = "native text";
      document.body.append(input);
      input.focus();
      input.setSelectionRange(0, input.value.length);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          input.remove();
        })
      );
      const fixture = nativeEvent();
      expect(
        Option.isNone(
          observeNativeClipboard(
            host(),
            fixture.event,
            operation,
            1,
            document,
            false
          )
        )
      ).toBe(true);
      expect(fixture.event.defaultPrevented).toBe(false);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
      expect(fixture.getData).not.toHaveBeenCalled();
      expect(fixture.setData).not.toHaveBeenCalled();
    })
);

it.effect.each(["copy", "cut", "paste"] as const)(
  "page-text selection keeps native %s without clearing or changing the selection",
  (operation) =>
    Effect.gen(function* pageText() {
      const text = document.createElement("span");
      text.textContent = "selected page text";
      document.body.append(text);
      const selection = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(text);
      selection?.removeAllRanges();
      selection?.addRange(range);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          selection?.removeAllRanges();
          text.remove();
        })
      );
      const fixture = nativeEvent();
      expect(
        Option.isNone(
          observeNativeClipboard(
            host(),
            fixture.event,
            operation,
            1,
            document,
            false
          )
        )
      ).toBe(true);
      expect(selection?.toString()).toBe("selected page text");
      expect(fixture.event.defaultPrevented).toBe(false);
      expect(fixture.getData).not.toHaveBeenCalled();
      expect(fixture.setData).not.toHaveBeenCalled();
    })
);

it.effect.each(["textarea", "select", "editable", "textbox"] as const)(
  "a target inside %s remains native even when that target is not focused",
  (kind) =>
    Effect.gen(function* editableAncestor() {
      const parent = document.createElement(
        kind === "textarea" || kind === "select" ? kind : "div"
      );

      if (kind === "editable") {
        parent.setAttribute("contenteditable", "true");
      }

      if (kind === "textbox") {
        parent.setAttribute("role", "textbox");
      }

      const child = document.createElement("span");
      parent.append(child);
      document.body.append(parent);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          parent.remove();
        })
      );
      const fixture = nativeEvent("", child);
      expect(
        Option.isNone(
          observeNativeClipboard(
            host(),
            fixture.event,
            "copy",
            1,
            document,
            false
          )
        )
      ).toBe(true);
      expect(fixture.setData).not.toHaveBeenCalled();
      expect(fixture.event.defaultPrevented).toBe(false);
    })
);

it.effect(
  "untrusted, already prevented and composing events cannot touch the event clipboard",
  () =>
    Effect.sync(() => {
      for (const kind of ["untrusted", "prevented", "composing"] as const) {
        const fixture = nativeEvent();

        if (kind === "untrusted") {
          fixture.event.isTrusted = false;
        }

        if (kind === "prevented") {
          fixture.event.preventDefault();
        }

        const notices = observeNativeClipboard(
          host(),
          fixture.event,
          "copy",
          1,
          document,
          kind === "composing"
        );

        expect(Option.isNone(notices)).toBe(true);
        expect(fixture.getData).not.toHaveBeenCalled();
        expect(fixture.setData).not.toHaveBeenCalled();
      }
    })
);

it.effect(
  "a failed native marker write cannot report Copied or start Cut",
  () =>
    Effect.sync(() => {
      const fixture = nativeEvent();
      fixture.setData.mockImplementation(() => {
        throw new DOMException("Refused", "NotAllowedError");
      });

      const notice = Option.getOrThrow(
        observeNativeClipboard(host(), fixture.event, "cut", 1, document, false)
      );

      expect(NativeClipboardNotice.guards.Refused(notice)).toBe(true);
      expect(NativeClipboardNotice.guards.Copied(notice)).toBe(false);
    })
);

it.effect(
  "the live native producer reads the latest provider reference and deactivates old person/session delivery",
  () =>
    Effect.sync(() => {
      let current: NativeClipboardHost | undefined = host();
      const emitted: (typeof NativeClipboardNotice.Type)[] = [];

      const receiver = nativeClipboardReceiver(
        document,
        "opaque-native",
        () => current,
        (notice) => {
          emitted.push(notice);
        }
      );

      const first = nativeEvent();
      receiver.copy(first.event);
      receiver.copy(first.event);
      expect(emitted).toHaveLength(1);
      current = {
        ...host(),
        selected: {
          ...clipboardSource,
          accountId: "personal",
          calendarId: "another",
          eventId: "new-reference",
        },
      };
      receiver.copy(nativeEvent().event);
      expect(emitted).toHaveLength(2);
      const last = emitted.at(-1);

      if (last !== undefined && NativeClipboardNotice.guards.Copied(last)) {
        expect(last.envelope.items[0].source).toEqual({
          accountId: "personal",
          calendarId: "another",
          eventId: "new-reference",
        });
      }

      current = {
        ...host(),
        personId: "person-B",
        sessionId: "different-person-session",
      };
      receiver.copy(nativeEvent().event);
      current = undefined;
      receiver.copy(nativeEvent().event);
      expect(emitted).toHaveLength(2);
    })
);

it.effect(
  "the scoped native stream registers one listener per operation and removes the same handlers",
  () =>
    Effect.gen(function* nativeScope() {
      const ready = yield* Deferred.make<boolean>();
      const observed = new Set<string>();
      const original = document.addEventListener.bind(document);

      const registered = vi
        .spyOn(document, "addEventListener")
        .mockImplementation((type, listener, options) => {
          original(type, listener, options);

          if (
            [
              "copy",
              "cut",
              "paste",
              "compositionstart",
              "compositionend",
            ].includes(type)
          ) {
            observed.add(type);

            if (observed.size === 5) {
              Deferred.doneUnsafe(ready, Effect.succeed(true));
            }
          }
        });

      const removed = vi.spyOn(document, "removeEventListener");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          registered.mockRestore();
          removed.mockRestore();
        })
      );

      const waiting = yield* Effect.forkChild(
        nativeClipboardEvents(document, "opaque-native", host).pipe(
          Stream.runDrain
        )
      );

      yield* Deferred.await(ready);
      yield* Fiber.interrupt(waiting);

      for (const operation of [
        "copy",
        "cut",
        "paste",
        "compositionstart",
        "compositionend",
      ]) {
        const added = registered.mock.calls.filter(
          ([type]) => type === operation
        );

        const released = removed.mock.calls.filter(
          ([type]) => type === operation
        );

        expect(added).toHaveLength(1);
        expect(released).toHaveLength(1);
        expect(released[0]?.[1]).toBe(added[0]?.[1]);
      }

      expect(registered.mock.calls.some(([type]) => type === "keydown")).toBe(
        false
      );
    })
);

it.effect(
  "native composition and renewed listener leases cannot reuse an opaque copy identity",
  () =>
    Effect.sync(() => {
      const output: (typeof NativeClipboardNotice.Type)[] = [];
      const current = host();

      const receiver = nativeClipboardReceiver(
        document,
        current.sessionId,
        () => current,
        (notice) => {
          output.push(notice);
        }
      );

      receiver.startComposition();
      receiver.copy(nativeEvent().event);
      expect(output).toHaveLength(0);
      receiver.endComposition();
      receiver.copy(nativeEvent().event);
      const renewed = { ...host(), sessionId: "fresh-opaque-native-lease" };
      nativeClipboardReceiver(
        document,
        renewed.sessionId,
        () => renewed,
        (notice) => {
          output.push(notice);
        }
      ).copy(nativeEvent().event);

      const ids = output.flatMap((notice) =>
        NativeClipboardNotice.guards.Copied(notice) ? [notice.envelope.id] : []
      );

      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    })
);

it.effect("focused text inside an open shadow root remains native", () =>
  Effect.gen(function* shadowTextFocus() {
    const element = document.createElement("div");
    const shadow = element.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    shadow.append(input);
    document.body.append(element);
    input.focus();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        element.remove();
      })
    );
    expect(document.activeElement).toBe(element);
    const fixture = nativeEvent();
    expect(
      Option.isNone(
        observeNativeClipboard(
          host(),
          fixture.event,
          "copy",
          1,
          document,
          false
        )
      )
    ).toBe(true);
    expect(fixture.setData).not.toHaveBeenCalled();
  })
);

it.effect.each(["c", "x", "v"] as const)(
  "Mod-%s is not intercepted as an app key in addition to its native event",
  (key) =>
    Effect.sync(() => {
      for (const [platform, modifier] of [
        ["MacIntel", { metaKey: true }],
        ["Win32", { ctrlKey: true }],
      ] as const) {
        const event = new KeyboardEvent("keydown", {
          ...modifier,
          cancelable: true,
          key,
        });

        expect(
          Option.isNone(keyboardMessage(keyboardFixture(), event, 1, platform))
        ).toBe(true);
        expect(event.defaultPrevented).toBe(false);
      }
    })
);
