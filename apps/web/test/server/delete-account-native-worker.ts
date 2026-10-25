import type { DurableObjectState } from "@cloudflare/workers-types";
import { Schema } from "effect";

import type { CalendarEnvironment } from "../../src/server/calendar-environment.js";
import { calendarWorker } from "../../src/server/calendar-worker.js";
import { calendarLiveClass } from "../../src/server/live-object.js";

const NativeCalendarLive = calendarLiveClass("development");

export class CalendarLive extends NativeCalendarLive {
  private readonly inspectState: DurableObjectState;

  constructor(state: DurableObjectState, environment: CalendarEnvironment) {
    super(state, environment);
    this.inspectState = state;
  }

  // @effect-diagnostics-next-line asyncFunction:off -- This test-only Worker projection seeds and reads actual owner storage; production imports neither this entrypoint nor its inspection routes.
  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const { storage } = this.inspectState;

    if (path === "/__seed-delete-account" && request.method === "POST") {
      const due = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Int))(
        request.headers.get("x-test-due-at")
      );

      storage.transactionSync(() => {
        storage.sql.exec(
          "INSERT INTO live_job (job_key, generation, payload, due_at, attempts) VALUES ('fixture-job', 'fixture-generation', '{\"_tag\":\"Inventory\"}', ?, 0)",
          due
        );
        storage.sql.exec(
          "INSERT INTO live_result (job_key, payload) VALUES ('fixture-result', '{\"_tag\":\"Inventory\"}')"
        );
        storage.sql.exec(
          "INSERT INTO live_message (channel_id, message_number) VALUES ('fixture-channel', '1')"
        );
      });
      await storage.put("watch-cooldown:fixture", { status: 403, until: due });
      await storage.setAlarm(due);

      return Response.json({ seeded: true });
    }

    if (path === "/__fail-delete-cleanup" && request.method === "POST") {
      storage.sql.exec(
        "CREATE TRIGGER refuse_owner_cleanup BEFORE DELETE ON live_owner BEGIN SELECT RAISE(ABORT, 'local derived cleanup failure'); END"
      );

      return Response.json({ installed: true });
    }

    if (path === "/__restore-delete-cleanup" && request.method === "POST") {
      storage.sql.exec("DROP TRIGGER refuse_owner_cleanup");

      return Response.json({ restored: true });
    }

    if (path === "/__inspect-delete-account") {
      const counts = Object.fromEntries(
        ["live_owner", "live_job", "live_result", "live_message"].map(
          (table) => [
            table,
            storage.sql.exec(`SELECT count(*) AS count FROM ${table}`).one()
              .count,
          ]
        )
      );

      const cooldowns = await storage.list({
        limit: 100,
        prefix: "watch-cooldown:",
      });

      return Response.json({
        alarm: await storage.getAlarm(),
        cooldowns: cooldowns.size,
        counts,
        inventory: (await storage.get("calendar-inventory")) !== undefined,
        sockets: this.inspectState
          .getWebSockets()
          .map((socket) => socket.readyState),
      });
    }

    return await super.fetch(request);
  }
}

export default calendarWorker("development");
