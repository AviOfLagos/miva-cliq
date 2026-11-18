/**
 * A fake Moodle behind a stubbed global fetch. Models what the engine relies on:
 *  - /lib/ajax/service.php batches, processed in order and STOPPED at the first
 *    call that errors (as Moodle's service.php does);
 *  - core_courseformat_get_state (data is a JSON string);
 *  - core_completion_get_activities_completion_status (optional, can be "off");
 *  - the manual toggle, which refuses automatic-completion activities;
 *  - view.php GETs that complete view-rule activities and then redirect;
 *  - availability locks (uservisible false until another activity is complete).
 */
export const LMS = "https://lms.miva.university";

export interface FakeCm {
  id: number;
  name: string;
  module: string;
  /** null = no completion tracking. */
  state: 0 | 1 | 2 | 3 | null;
  tracking?: "manual" | "auto";
  /** Rules for automatic completion. Only "completionview" is satisfiable here. */
  rules?: string[];
  /** Locked until this cmid is complete. */
  lockedUntil?: number;
  /** Override the activity URL (e.g. an external link). */
  url?: string | null;
}

export interface FakeOptions {
  /** Completion-status web service unavailable (returns an exception). */
  noStatusCall?: boolean;
  /** Called on every request; e.g. advance a fake clock. */
  onRequest?: () => void;
  /** Return a broken (truncated / junk) response to mark batches. */
  junkMarkResponses?: boolean;
}

export interface FakeMoodle {
  cms: Map<number, FakeCm>;
  requests: { kind: string; methods?: string[]; url: string; redirect?: string }[];
  /** cmids that received a mark call Moodle processed. */
  markCalls: number[];
  /** URLs GET-requested. */
  views: string[];
  restore(): void;
  count(kind: string): number;
}

export const session = { cookies: { MoodleSession: "x" }, sesskey: "sk", userId: 7, name: "T" };

function isDone(cm: FakeCm) {
  return cm.state === 1 || cm.state === 2;
}

export function installFakeMoodle(list: FakeCm[], opts: FakeOptions = {}): FakeMoodle {
  const cms = new Map(list.map((c) => [c.id, { tracking: "manual", ...c } as FakeCm]));
  const requests: FakeMoodle["requests"] = [];
  const markCalls: number[] = [];
  const views: string[] = [];
  const original = globalThis.fetch;

  const visible = (cm: FakeCm) =>
    cm.lockedUntil === undefined || isDone(cms.get(cm.lockedUntil)!);
  const urlOf = (cm: FakeCm) =>
    cm.url !== undefined ? cm.url : `${LMS}/mod/${cm.module}/view.php?id=${cm.id}`;

  const call = (methodname: string, args: any): any => {
    switch (methodname) {
      case "core_courseformat_get_state":
        return {
          error: false,
          data: JSON.stringify({
            section: [{ number: 0, title: "General" }],
            cm: Array.from(cms.values()).map((cm) => ({
              id: String(cm.id),
              name: cm.name,
              module: cm.module,
              sectionnumber: 0,
              uservisible: visible(cm),
              url: visible(cm) ? urlOf(cm) : undefined,
              istrackeduser: cm.state !== null,
              ...(cm.state === null ? {} : { completionstate: cm.state }),
            })),
          }),
        };
      case "core_completion_get_activities_completion_status":
        if (opts.noStatusCall) {
          return { error: true, exception: { message: "Access denied", errorcode: "accessexception" } };
        }
        return {
          error: false,
          data: {
            statuses: Array.from(cms.values())
              .filter((cm) => cm.state !== null)
              .map((cm) => ({
                cmid: cm.id,
                modname: cm.module,
                state: cm.state,
                tracking: cm.tracking === "auto" ? 2 : 1,
                uservisible: visible(cm),
                details: (cm.rules ?? []).map((r) => ({
                  rulename: r,
                  rulevalue: { status: isDone(cm) ? 1 : 0, description: r },
                })),
              })),
            warnings: [],
          },
        };
      case "core_completion_update_activity_completion_status_manually": {
        const cm = cms.get(Number(args.cmid));
        markCalls.push(Number(args.cmid));
        if (!cm || !visible(cm)) {
          return { error: true, exception: { message: "No access", errorcode: "nopermissions" } };
        }
        if (cm.tracking !== "manual" || cm.state === null) {
          return {
            error: true,
            exception: { message: "Cannot manually track", errorcode: "cannotmanualctrack" },
          };
        }
        cm.state = args.completed ? 1 : 0;
        return { error: false, data: { status: true, warnings: [] } };
      }
      default:
        return { error: true, exception: { message: `unknown ${methodname}`, errorcode: "invalidrecord" } };
    }
  };

  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    opts.onRequest?.();
    if (url.startsWith(`${LMS}/lib/ajax/service.php`)) {
      const body = JSON.parse(String(init.body)) as { index: number; methodname: string; args: any }[];
      const methods = body.map((b) => b.methodname);
      const isMark = methods.every((m) => m.endsWith("_manually"));
      requests.push({ kind: isMark ? "mark" : "state", methods, url });
      const out: any[] = [];
      for (const b of body) {
        const r = call(b.methodname, b.args);
        out.push(r);
        if (r.error) break; // Moodle's service.php: "Do not process the remaining requests."
      }
      if (isMark && opts.junkMarkResponses) {
        return new Response(JSON.stringify([{ nonsense: true }]), { status: 200 });
      }
      return new Response(JSON.stringify(out), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.startsWith(`${LMS}/mod/`)) {
      requests.push({ kind: "view", url, redirect: init.redirect });
      views.push(url);
      const id = Number(new URL(url).searchParams.get("id"));
      const cm = cms.get(id);
      if (cm && visible(cm) && cm.tracking === "auto" && (cm.rules ?? []).every((r) => r === "completionview")) {
        cm.state = 1;
      }
      return new Response("big page", { status: 303, headers: { location: "https://example.org/x" } });
    }
    requests.push({ kind: "external", url });
    throw new Error(`fake moodle: unexpected request to ${url}`);
  }) as typeof fetch;

  return {
    cms,
    requests,
    markCalls,
    views,
    restore: () => {
      globalThis.fetch = original;
    },
    count: (kind) => requests.filter((r) => r.kind === kind).length,
  };
}

/** n manual-completion pages with cmids start..start+n-1. */
export function pages(n: number, start = 1): FakeCm[] {
  return Array.from({ length: n }, (_, i) => ({
    id: start + i,
    name: `Page ${start + i}`,
    module: "page",
    state: 0 as const,
    tracking: "manual" as const,
  }));
}
