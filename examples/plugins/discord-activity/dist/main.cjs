"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// examples/plugins/discord-activity/src/main.ts
var main_exports = {};
__export(main_exports, {
  activate: () => activate,
  deactivate: () => deactivate,
  default: () => DiscordActivityPanel
});
module.exports = __toCommonJS(main_exports);
var import_fs = __toESM(require("fs"));
var import_path2 = __toESM(require("path"));

// examples/plugins/discord-activity/src/discordRpc.ts
var import_net = __toESM(require("net"));
var import_os = __toESM(require("os"));
var import_path = __toESM(require("path"));
var OPCODE_HANDSHAKE = 0;
var OPCODE_FRAME = 1;
var OPCODE_CLOSE = 2;
function isMissingDiscordSocketError(error) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /ENOENT/i.test(message) && /discord-ipc-\d+/i.test(message);
}
function encodeFrame(frame) {
  const payload = Buffer.from(JSON.stringify(frame.payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeInt32LE(frame.op, 0);
  header.writeInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}
function decodeFrame(buffer) {
  const op = buffer.readInt32LE(0);
  const length = buffer.readInt32LE(4);
  const payload = JSON.parse(buffer.subarray(8, 8 + length).toString("utf8"));
  return { op, payload };
}
function createNonce() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function getDiscordIpcCandidatePaths({
  platform = process.platform,
  tempRoots
} = {}) {
  if (platform === "win32") {
    return Array.from({ length: 10 }, (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
  }
  const candidateRoots = (tempRoots ?? [
    process.env.XDG_RUNTIME_DIR,
    process.env.TMPDIR,
    process.env.TMP,
    process.env.TEMP,
    import_os.default.tmpdir()
  ]).filter((value) => typeof value === "string" && value.length > 0);
  const uniqueRoots = [...new Set(candidateRoots)];
  const candidates = [];
  for (const root of uniqueRoots) {
    for (let index = 0; index < 10; index += 1) {
      candidates.push(import_path.default.join(root, `discord-ipc-${index}`));
    }
  }
  return candidates;
}
function createNetSocket(socket) {
  const chunks = [];
  let bufferedBytes = 0;
  let ended = false;
  let pendingRead = null;
  let pendingReject = null;
  function tryConsumeFrame() {
    if (bufferedBytes < 8) {
      return null;
    }
    const combined = Buffer.concat(chunks, bufferedBytes);
    const length = combined.readInt32LE(4);
    const frameLength = 8 + length;
    if (combined.length < frameLength) {
      return null;
    }
    const frame = combined.subarray(0, frameLength);
    const remainder = combined.subarray(frameLength);
    chunks.length = 0;
    bufferedBytes = remainder.length;
    if (remainder.length > 0) {
      chunks.push(remainder);
    }
    return frame;
  }
  function flushRead() {
    if (!pendingRead) {
      return;
    }
    const frame = tryConsumeFrame();
    if (frame) {
      const resolve = pendingRead;
      pendingRead = null;
      pendingReject = null;
      resolve(frame);
      return;
    }
    if (ended) {
      const reject = pendingReject;
      pendingRead = null;
      pendingReject = null;
      reject?.(new Error("Discord RPC socket closed before a full frame was received"));
    }
  }
  socket.on("data", (chunk) => {
    chunks.push(chunk);
    bufferedBytes += chunk.length;
    flushRead();
  });
  socket.on("end", () => {
    ended = true;
    flushRead();
  });
  socket.on("close", () => {
    ended = true;
    flushRead();
  });
  socket.on("error", (error) => {
    const reject = pendingReject;
    pendingRead = null;
    pendingReject = null;
    reject?.(error);
  });
  return {
    write(buffer) {
      return new Promise((resolve, reject) => {
        socket.write(buffer, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    read() {
      return new Promise((resolve, reject) => {
        pendingRead = resolve;
        pendingReject = reject;
        flushRead();
      });
    },
    close() {
      return new Promise((resolve) => {
        if (socket.destroyed) {
          resolve();
          return;
        }
        socket.once("close", () => resolve());
        socket.destroy();
      });
    }
  };
}
async function connectNetSocket(candidatePath) {
  return new Promise((resolve, reject) => {
    const socket = import_net.default.createConnection(candidatePath, () => {
      socket.removeListener("error", reject);
      resolve(createNetSocket(socket));
    });
    socket.once("error", reject);
  });
}
function getDiscordRpcErrorMessage(payload) {
  if (typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message;
  }
  const data = payload.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const message = data.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return null;
}
async function readExpectedFrame(socket, expectedOp) {
  while (true) {
    const frame = decodeFrame(await socket.read());
    if (frame.op === expectedOp) {
      if (frame.payload.evt === "ERROR") {
        throw new Error(getDiscordRpcErrorMessage(frame.payload) ?? "Discord RPC returned an error");
      }
      return frame.payload;
    }
    if (frame.op === OPCODE_CLOSE) {
      const message = typeof frame.payload.message === "string" && frame.payload.message.trim().length > 0 ? frame.payload.message : "Discord RPC closed the IPC connection";
      throw new Error(message);
    }
  }
}
function createDiscordRpcClient({
  connect = connectNetSocket,
  getCandidatePaths = getDiscordIpcCandidatePaths,
  nonce = createNonce,
  pid = process.pid
} = {}) {
  let socket;
  async function sendFrame(frame) {
    if (!socket) {
      throw new Error("Discord RPC client is not connected");
    }
    await socket.write(encodeFrame(frame));
  }
  return {
    async login({ clientId }) {
      let lastError;
      for (const candidatePath of getCandidatePaths()) {
        try {
          socket = await connect(candidatePath);
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!socket) {
        if (isMissingDiscordSocketError(lastError)) {
          throw new Error("Discord is not running");
        }
        throw new Error(lastError instanceof Error ? lastError.message : "Discord IPC socket not found");
      }
      await sendFrame({
        op: OPCODE_HANDSHAKE,
        payload: {
          v: 1,
          client_id: clientId
        }
      });
      const payload = await readExpectedFrame(socket, OPCODE_FRAME);
      if (payload.evt !== "READY") {
        throw new Error("Discord RPC handshake did not return READY");
      }
    },
    async setActivity(activity) {
      await sendFrame({
        op: OPCODE_FRAME,
        payload: {
          cmd: "SET_ACTIVITY",
          args: {
            pid,
            activity
          },
          nonce: nonce()
        }
      });
      await readExpectedFrame(socket, OPCODE_FRAME);
    },
    async clearActivity() {
      if (!socket) {
        return;
      }
      await sendFrame({
        op: OPCODE_FRAME,
        payload: {
          cmd: "SET_ACTIVITY",
          args: {
            pid,
            activity: null
          },
          nonce: nonce()
        }
      });
      await readExpectedFrame(socket, OPCODE_FRAME);
    },
    async disconnect() {
      await socket?.close();
      socket = void 0;
    }
  };
}

// examples/plugins/discord-activity/src/runtime.ts
var DISCORD_ACTIVITY_CLIENT_ID = "1487871166633869342";
var PLUGIN_LOG_PREFIX = "[Plugin] [Discord Activity]";
var DISCORD_ACTIVITY_METADATA = {
  idle: {
    label: "Idle",
    state: "Using mLearn",
    exampleDetails: "Idling",
    getDetails: () => "Idling"
  },
  reader: {
    label: "Reader",
    state: "Reading on mLearn",
    exampleDetails: "Reading page x/y of {work name}",
    getDetails: (activity) => `Reading page ${activity.currentPage}/${activity.totalPages} of ${activity.workName}`
  },
  video: {
    label: "Video",
    state: "Watching on mLearn",
    exampleDetails: "{current time}/{duration} - {work name}",
    getDetails: (activity) => `${formatDuration(activity.currentTimeSeconds)}/${formatDuration(activity.durationSeconds)} - ${activity.workName}`
  },
  flashcards: {
    label: "Flashcards",
    state: "Using mLearn",
    exampleDetails: "Reviewing Flashcards",
    getDetails: () => "Reviewing Flashcards"
  }
};
var DISCORD_ACTIVITY_STATUS_DESCRIPTIONS = [
  {
    label: DISCORD_ACTIVITY_METADATA.idle.label,
    state: DISCORD_ACTIVITY_METADATA.idle.state,
    details: DISCORD_ACTIVITY_METADATA.idle.exampleDetails
  },
  {
    label: DISCORD_ACTIVITY_METADATA.reader.label,
    state: DISCORD_ACTIVITY_METADATA.reader.state,
    details: DISCORD_ACTIVITY_METADATA.reader.exampleDetails
  },
  {
    label: DISCORD_ACTIVITY_METADATA.video.label,
    state: DISCORD_ACTIVITY_METADATA.video.state,
    details: DISCORD_ACTIVITY_METADATA.video.exampleDetails
  },
  {
    label: DISCORD_ACTIVITY_METADATA.flashcards.label,
    state: DISCORD_ACTIVITY_METADATA.flashcards.state,
    details: DISCORD_ACTIVITY_METADATA.flashcards.exampleDetails
  }
];
var RUNTIME_STATUS_KEY = "discord-activity:runtime-status";
function getErrorMessage(error) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Unknown Discord RPC error";
}
async function persistRuntimeStatus(storage, status) {
  await storage.set(RUNTIME_STATUS_KEY, JSON.stringify(status));
}
async function cleanupRpcClient(rpcClient) {
  if (!rpcClient) {
    return;
  }
  try {
    await rpcClient.clearActivity();
  } finally {
    await rpcClient.disconnect();
  }
}
function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds < 0) {
    return "--:--";
  }
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
function isAppActivity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("kind" in value)) {
    return false;
  }
  switch (value.kind) {
    case "idle":
    case "flashcards":
      return true;
    case "reader":
      return typeof value.workName === "string" && typeof value.currentPage === "number" && typeof value.totalPages === "number";
    case "video":
      return typeof value.workName === "string" && typeof value.currentTimeSeconds === "number" && (typeof value.durationSeconds === "number" || value.durationSeconds === null);
    default:
      return false;
  }
}
function getActivityFromEnvelope(envelope) {
  if (!envelope.hasValue || !isAppActivity(envelope.value)) {
    return { kind: "idle" };
  }
  return envelope.value;
}
function getActivitySessionKey(activity) {
  switch (activity.kind) {
    case "idle":
    case "flashcards":
      return activity.kind;
    case "reader":
    case "video":
      return `${activity.kind}:${activity.workName}`;
  }
}
function mapAppActivityToDiscordPresence(activity) {
  switch (activity.kind) {
    case "idle":
      return {
        state: DISCORD_ACTIVITY_METADATA.idle.state,
        details: DISCORD_ACTIVITY_METADATA.idle.getDetails()
      };
    case "reader":
      return {
        state: DISCORD_ACTIVITY_METADATA.reader.state,
        details: DISCORD_ACTIVITY_METADATA.reader.getDetails(activity)
      };
    case "flashcards":
      return {
        state: DISCORD_ACTIVITY_METADATA.flashcards.state,
        details: DISCORD_ACTIVITY_METADATA.flashcards.getDetails()
      };
    case "video":
      return {
        state: DISCORD_ACTIVITY_METADATA.video.state,
        details: DISCORD_ACTIVITY_METADATA.video.getDetails(activity)
      };
  }
}
function normalizeBoolean(value, fallback) {
  if (value === null) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}
async function loadDiscordActivityConfig(storage) {
  const [enabledRaw, showTimestampRaw] = await Promise.all([
    storage.get("discord-activity:enabled"),
    storage.get("discord-activity:showTimestamp")
  ]);
  return {
    enabled: normalizeBoolean(enabledRaw, true),
    showTimestamp: normalizeBoolean(showTimestampRaw, true)
  };
}
function createDiscordActivityRuntime({
  storage,
  pluginBridge,
  createRpcClient,
  now = () => /* @__PURE__ */ new Date()
}) {
  let activeSession;
  let runtimeToken = 0;
  function getTimestamps(session, activity) {
    if (!session.showTimestamp) {
      return void 0;
    }
    const nextSessionKey = getActivitySessionKey(activity);
    if (session.activitySessionKey !== nextSessionKey || session.activitySessionStart === void 0) {
      session.activitySessionKey = nextSessionKey;
      session.activitySessionStart = now().getTime();
    }
    return {
      start: session.activitySessionStart
    };
  }
  async function publishActivity(session, activity) {
    if (activeSession !== session) {
      return;
    }
    if (session.isPublishingActivity) {
      session.pendingActivity = activity;
      return;
    }
    session.isPublishingActivity = true;
    try {
      let nextActivity = activity;
      while (nextActivity && activeSession === session) {
        session.pendingActivity = void 0;
        const presence = mapAppActivityToDiscordPresence(nextActivity);
        const timestamps = getTimestamps(session, nextActivity);
        await session.client.setActivity({
          ...presence,
          ...timestamps ? { timestamps } : {}
        });
        nextActivity = session.pendingActivity;
      }
    } finally {
      session.isPublishingActivity = false;
    }
  }
  async function handleRuntimeError(session, error) {
    const errorMessage = getErrorMessage(error);
    const isCurrentSession = activeSession === session;
    if (isCurrentSession) {
      session.unsubscribeFromPluginValue?.();
      session.unsubscribeFromPluginValue = void 0;
      activeSession = void 0;
    }
    await cleanupRpcClient(session.client);
    if (session.token !== runtimeToken) {
      return;
    }
    console.error(PLUGIN_LOG_PREFIX, errorMessage);
    await persistRuntimeStatus(storage, {
      connected: false,
      lastError: errorMessage
    });
  }
  return {
    async activate() {
      runtimeToken += 1;
      const activationToken = runtimeToken;
      const previousSession = activeSession;
      activeSession = void 0;
      previousSession?.unsubscribeFromPluginValue?.();
      if (previousSession) {
        previousSession.unsubscribeFromPluginValue = void 0;
        await cleanupRpcClient(previousSession.client);
      }
      const config = await loadDiscordActivityConfig(storage);
      if (!config.enabled) {
        await persistRuntimeStatus(storage, {
          connected: false,
          lastError: ""
        });
        return;
      }
      const nextClient = createRpcClient();
      try {
        await nextClient.login({
          clientId: DISCORD_ACTIVITY_CLIENT_ID
        });
        if (activationToken !== runtimeToken) {
          await cleanupRpcClient(nextClient);
          return;
        }
        const session = {
          token: activationToken,
          client: nextClient,
          showTimestamp: config.showTimestamp
        };
        activeSession = session;
        let sawActivityEvent = false;
        session.unsubscribeFromPluginValue = pluginBridge.onPluginValue("app.user.activity", (nextValue) => {
          sawActivityEvent = true;
          void publishActivity(session, getActivityFromEnvelope(nextValue)).catch(async (error) => {
            await handleRuntimeError(session, error);
          });
        });
        const initialActivity = getActivityFromEnvelope(await pluginBridge.getPluginValue("app.user.activity"));
        if (activationToken !== runtimeToken || activeSession !== session) {
          session.unsubscribeFromPluginValue?.();
          session.unsubscribeFromPluginValue = void 0;
          await cleanupRpcClient(nextClient);
          return;
        }
        if (!sawActivityEvent) {
          await publishActivity(session, initialActivity);
        }
        await persistRuntimeStatus(storage, {
          connected: true,
          lastError: ""
        });
      } catch (error) {
        const failedSession = activeSession?.client === nextClient ? activeSession : {
          token: activationToken,
          client: nextClient,
          showTimestamp: config.showTimestamp
        };
        await handleRuntimeError(failedSession, error);
      }
    },
    async deactivate() {
      runtimeToken += 1;
      const previousSession = activeSession;
      activeSession = void 0;
      previousSession?.unsubscribeFromPluginValue?.();
      if (previousSession) {
        previousSession.unsubscribeFromPluginValue = void 0;
        await cleanupRpcClient(previousSession.client);
      }
      await persistRuntimeStatus(storage, {
        connected: false,
        lastError: ""
      });
    }
  };
}

// examples/plugins/discord-activity/src/ui.ts
var SAVE_MESSAGE = "Saved. Disable and re-enable the plugin to apply Discord changes.";
var LOAD_ERROR_PREFIX = "Failed to load Discord activity settings:";
var SAVE_ERROR_PREFIX = "Failed to save Discord activity settings:";
function getErrorMessage2(error) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Unknown error";
}
function createActivityDescriptionItem(description) {
  const item = document.createElement("li");
  item.textContent = `${description.label}: ${description.state} / ${description.details}`;
  return item;
}
function readRuntimeStatus(value) {
  if (!value) {
    return {
      connected: false,
      lastError: ""
    };
  }
  try {
    const parsed = JSON.parse(value);
    return {
      connected: parsed.connected === true,
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : ""
    };
  } catch {
    return {
      connected: false,
      lastError: "Unable to read Discord runtime status."
    };
  }
}
function DiscordActivityPanel(props) {
  const root = document.createElement("section");
  const heading = document.createElement("h2");
  const intro = document.createElement("p");
  const activityDescription = document.createElement("p");
  const activityList = document.createElement("ul");
  const form = document.createElement("form");
  const enabledLabel = document.createElement("label");
  const enabledInput = document.createElement("input");
  const showTimestampLabel = document.createElement("label");
  const showTimestampInput = document.createElement("input");
  const status = document.createElement("p");
  const runtimeStatus = document.createElement("p");
  const errorStatus = document.createElement("p");
  const saveButton = document.createElement("button");
  root.style.display = "grid";
  root.style.gap = "12px";
  root.style.padding = "16px";
  form.style.display = "grid";
  form.style.gap = "12px";
  heading.textContent = "Discord Rich Presence";
  intro.textContent = "Control the automatic live activity shown by the example Discord plugin.";
  activityDescription.textContent = "The plugin publishes automatic live activity based on what you are doing in mLearn:";
  for (const description of DISCORD_ACTIVITY_STATUS_DESCRIPTIONS) {
    activityList.append(createActivityDescriptionItem(description));
  }
  enabledLabel.textContent = "Enable Discord activity";
  enabledInput.type = "checkbox";
  enabledInput.name = "enabled";
  enabledLabel.append(document.createTextNode(" "), enabledInput);
  showTimestampLabel.textContent = "Show timestamp";
  showTimestampInput.type = "checkbox";
  showTimestampInput.name = "showTimestamp";
  showTimestampLabel.append(document.createTextNode(" "), showTimestampInput);
  saveButton.type = "submit";
  saveButton.textContent = "Save";
  enabledInput.disabled = true;
  showTimestampInput.disabled = true;
  saveButton.disabled = true;
  status.textContent = "Loading Discord activity settings...";
  runtimeStatus.textContent = "Runtime status: Disconnected";
  void (async () => {
    try {
      const [config, runtimeStatusValue] = await Promise.all([
        loadDiscordActivityConfig({
          get: (key) => props.host.kvGet(key),
          set: async () => {
            throw new Error("Config loading does not write to storage");
          }
        }),
        props.host.kvGet("discord-activity:runtime-status")
      ]);
      enabledInput.checked = config.enabled;
      showTimestampInput.checked = config.showTimestamp;
      const currentStatus = readRuntimeStatus(runtimeStatusValue);
      runtimeStatus.textContent = currentStatus.connected ? "Runtime status: Connected" : "Runtime status: Disconnected";
      errorStatus.textContent = currentStatus.lastError ? `Last error: ${currentStatus.lastError}` : "";
      enabledInput.disabled = false;
      showTimestampInput.disabled = false;
      saveButton.disabled = false;
      status.textContent = "Ready to save Discord activity settings.";
    } catch (error) {
      enabledInput.disabled = true;
      showTimestampInput.disabled = true;
      saveButton.disabled = true;
      status.textContent = `${LOAD_ERROR_PREFIX} ${getErrorMessage2(error)}`;
    }
  })();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (saveButton.disabled) {
      return;
    }
    void (async () => {
      try {
        await props.host.kvSet("discord-activity:enabled", String(enabledInput.checked));
        await props.host.kvSet("discord-activity:showTimestamp", String(showTimestampInput.checked));
        status.textContent = SAVE_MESSAGE;
        props.host.closeWindow();
      } catch (error) {
        status.textContent = `${SAVE_ERROR_PREFIX} ${getErrorMessage2(error)}`;
      }
    })();
  });
  form.append(enabledLabel, showTimestampLabel, saveButton);
  root.append(heading, intro, activityDescription, activityList, form, runtimeStatus, errorStatus, status);
  return root;
}

// examples/plugins/discord-activity/src/main.ts
var pluginRoot = import_path2.default.resolve(__dirname, "..");
var kvPath = import_path2.default.join(pluginRoot, ".kv.json");
function loadPluginStore() {
  try {
    if (!import_fs.default.existsSync(kvPath)) {
      return {};
    }
    const parsed = JSON.parse(import_fs.default.readFileSync(kvPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry) => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}
function savePluginStore(store) {
  import_fs.default.mkdirSync(pluginRoot, { recursive: true });
  import_fs.default.writeFileSync(kvPath, JSON.stringify(store, null, 2), "utf-8");
}
function getPluginBus() {
  const pluginBus = globalThis.__mlearnPluginBus;
  if (!pluginBus) {
    throw new Error("Main-process plugin bus is not available");
  }
  return pluginBus;
}
var runtime = createDiscordActivityRuntime({
  storage: {
    get: async (key) => loadPluginStore()[key] ?? null,
    set: async (key, value) => {
      const store = loadPluginStore();
      store[key] = value;
      savePluginStore(store);
    }
  },
  pluginBridge: {
    getPluginValue: (channel) => getPluginBus().getPluginValue(channel),
    onPluginValue: (channel, callback) => getPluginBus().onPluginValue(channel, callback)
  },
  createRpcClient: () => createDiscordRpcClient()
});
async function activate() {
  await runtime.activate();
}
async function deactivate() {
  await runtime.deactivate();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
