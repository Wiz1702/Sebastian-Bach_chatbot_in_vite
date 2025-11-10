var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/src/index.ts
var SYSTEM_PROMPT = `You are Johann Sebastian Bach helping modern music students prepare for theory and history exams.
Respond with the warmth of a mentor, sprinkle in short Baroque metaphors, and emphasize how concepts connect to real compositions.
Keep answers focused, cite relevant works when possible, and suggest short exercises students can try at the keyboard.`;
var MODEL_NAME = "@cf/meta/llama-3.1-8b-instruct";
var HISTORY_LIMIT = 12;
function createCorsHeaders(request) {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return headers;
}
__name(createCorsHeaders, "createCorsHeaders");
function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)])
  );
}
__name(parseCookies, "parseCookies");
function buildSessionCookie(id, url) {
  const expires = new Date(Date.now() + 1e3 * 60 * 60 * 24 * 30).toUTCString();
  const parts = [
    `bach_session=${encodeURIComponent(id)}`,
    "Path=/",
    "SameSite=Lax",
    `Expires=${expires}`
  ];
  if (url.protocol === "https:") {
    parts.push("Secure");
  }
  return `${parts.join("; ")}`;
}
__name(buildSessionCookie, "buildSessionCookie");
function extractAiText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  const tryRead = /* @__PURE__ */ __name((obj) => {
    if (!obj) return void 0;
    if (typeof obj === "string") return obj;
    if (Array.isArray(obj)) {
      for (const entry of obj) {
        const value = tryRead(entry);
        if (value) return value;
      }
      return void 0;
    }
    if (typeof obj === "object") {
      if (obj.text && typeof obj.text === "string") return obj.text;
      if (obj.content && Array.isArray(obj.content)) {
        const text = obj.content.map((piece) => piece.text ?? "").join(" ").trim();
        if (text) return text;
      }
      if (obj.response) return tryRead(obj.response);
      if (obj.output) return tryRead(obj.output);
      if (obj.result) return tryRead(obj.result);
      if (obj.results) return tryRead(obj.results);
    }
    return void 0;
  }, "tryRead");
  return tryRead(result) ?? "I am momentarily lost in counterpoint. Please try again.";
}
__name(extractAiText, "extractAiText");
function errorResponse(request, message, status = 400) {
  const headers = createCorsHeaders(request);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ error: message }), { status, headers });
}
__name(errorResponse, "errorResponse");
async function handleOptions(request) {
  const headers = createCorsHeaders(request);
  return new Response(null, { status: 204, headers });
}
__name(handleOptions, "handleOptions");
async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
__name(readBody, "readBody");
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env, url);
    }
    if (url.pathname === "/api/history" && request.method === "GET") {
      return handleHistory(request, env, url);
    }
    return new Response("Not found", { status: 404 });
  }
};
async function handleChat(request, env, url) {
  const body = await readBody(request);
  if (!body.message || !body.message.trim()) {
    return errorResponse(request, "Please include a message.");
  }
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionId = cookies["bach_session"] ?? crypto.randomUUID();
  const stub = env.CHAT_MEMORY.get(env.CHAT_MEMORY.idFromName(sessionId));
  const resp = await stub.fetch("https://memory/chat", {
    method: "POST",
    body: JSON.stringify({ message: body.message, topic: body.topic ?? null })
  });
  const payload = await resp.json();
  const headers = createCorsHeaders(request);
  headers.set("Content-Type", "application/json");
  if (!cookies["bach_session"]) {
    headers.append("Set-Cookie", buildSessionCookie(sessionId, url));
  }
  return new Response(JSON.stringify(payload), {
    status: resp.status,
    headers
  });
}
__name(handleChat, "handleChat");
async function handleHistory(request, env, url) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionId = cookies["bach_session"] ?? crypto.randomUUID();
  const stub = env.CHAT_MEMORY.get(env.CHAT_MEMORY.idFromName(sessionId));
  const resp = await stub.fetch("https://memory/chat", { method: "GET" });
  const payload = await resp.json();
  const headers = createCorsHeaders(request);
  headers.set("Content-Type", "application/json");
  if (!cookies["bach_session"]) {
    headers.append("Set-Cookie", buildSessionCookie(sessionId, url));
  }
  return new Response(JSON.stringify(payload), {
    status: resp.status,
    headers
  });
}
__name(handleHistory, "handleHistory");
var ConversationMemory = class {
  static {
    __name(this, "ConversationMemory");
  }
  #state;
  #env;
  #history = [];
  #init;
  constructor(state, env) {
    this.#state = state;
    this.#env = env;
    this.#init = state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get("history");
      this.#history = stored ?? [];
    });
  }
  async fetch(request) {
    await this.#init;
    if (request.method === "GET") {
      return Response.json({ history: this.#history });
    }
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    const { message, topic } = await request.json();
    if (!message) {
      return Response.json({ error: "Missing message" }, { status: 400 });
    }
    const trimmedHistory = this.#history.slice(-(HISTORY_LIMIT - 2));
    const topicLine = topic ? `The student is currently studying ${topic}.` : "";
    const messages = [
      { role: "system", content: `${SYSTEM_PROMPT}
${topicLine}`.trim() },
      ...trimmedHistory.map(({ role, content }) => ({ role, content })),
      { role: "user", content: message }
    ];
    const mockEnabled = (this.#env.MOCK_AI ?? "").toLowerCase() === "true";
    let reply;
    if (mockEnabled) {
      reply = buildMockReply(message, topic);
    } else {
      try {
        const aiResult = await this.#env.AI.run(MODEL_NAME, {
          messages,
          temperature: 0.35,
          max_tokens: 512
        });
        reply = extractAiText(aiResult).trim();
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        console.error("Workers AI call failed", details);
        return Response.json(
          {
            error: "Workers AI failed to generate a response. If you are running locally, start the worker with `wrangler dev --remote` so the AI binding is available, or set MOCK_AI=true in .dev.vars for an offline mock.",
            details
          },
          { status: 502 }
        );
      }
    }
    const now = Date.now();
    const updatedHistory = [
      ...trimmedHistory,
      { role: "user", content: message, timestamp: now },
      { role: "assistant", content: reply, timestamp: now }
    ].slice(-HISTORY_LIMIT);
    this.#history = updatedHistory;
    await this.#state.storage.put("history", this.#history);
    return Response.json({
      reply,
      history: this.#history
    });
  }
};
function buildMockReply(question, topic) {
  const focus = topic ? ` while focusing on ${topic}` : "";
  return [
    "\u{1F3BB} *Mock Bach Reply*",
    `You asked${focus}: "${question}"`,
    "Imagine I referenced a related invention, pointed you to a chorale, and gave you two short keyboard drills.",
    "Enable Workers AI (or deploy) to hear the full Baroque treatment."
  ].join("\n\n");
}
__name(buildMockReply, "buildMockReply");

// worker/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// .wrangler/tmp/bundle-S5z7AP/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default
];
var middleware_insertion_facade_default = src_default;

// worker/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-S5z7AP/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  ConversationMemory,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
