// examples/plugins/discord-activity/src/runtime.ts
var DEFAULT_DETAILS = "Studying with mLearn";
var DEFAULT_STATE = "In a focused session";
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
function normalizeString(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : fallback;
}
async function loadDiscordActivityConfig(storage) {
  const [enabledRaw, detailsRaw, stateRaw, showTimestampRaw] = await Promise.all([
    storage.get("discord-activity:enabled"),
    storage.get("discord-activity:details"),
    storage.get("discord-activity:state"),
    storage.get("discord-activity:showTimestamp")
  ]);
  return {
    enabled: normalizeBoolean(enabledRaw, true),
    details: normalizeString(detailsRaw, DEFAULT_DETAILS),
    state: normalizeString(stateRaw, DEFAULT_STATE),
    showTimestamp: normalizeBoolean(showTimestampRaw, true)
  };
}

// examples/plugins/discord-activity/src/ui.ts
var SAVE_MESSAGE = "Saved. Disable and re-enable the plugin to apply Discord changes.";
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
  const form = document.createElement("form");
  const enabledLabel = document.createElement("label");
  const enabledInput = document.createElement("input");
  const detailsLabel = document.createElement("label");
  const detailsInput = document.createElement("input");
  const stateLabel = document.createElement("label");
  const stateInput = document.createElement("input");
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
  intro.textContent = "Update the example Discord activity config saved in plugin KV storage.";
  enabledLabel.textContent = "Enable Discord activity";
  enabledInput.type = "checkbox";
  enabledInput.name = "enabled";
  enabledLabel.append(document.createTextNode(" "), enabledInput);
  detailsLabel.textContent = "Details";
  detailsInput.type = "text";
  detailsInput.name = "details";
  detailsLabel.append(document.createElement("br"), detailsInput);
  stateLabel.textContent = "State";
  stateInput.type = "text";
  stateInput.name = "state";
  stateLabel.append(document.createElement("br"), stateInput);
  showTimestampLabel.textContent = "Show timestamp";
  showTimestampInput.type = "checkbox";
  showTimestampInput.name = "showTimestamp";
  showTimestampLabel.append(document.createTextNode(" "), showTimestampInput);
  saveButton.type = "submit";
  saveButton.textContent = "Save";
  status.textContent = "Loading Discord activity settings...";
  runtimeStatus.textContent = "Runtime status: Disconnected";
  void (async () => {
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
    detailsInput.value = config.details;
    stateInput.value = config.state;
    showTimestampInput.checked = config.showTimestamp;
    const currentStatus = readRuntimeStatus(runtimeStatusValue);
    runtimeStatus.textContent = currentStatus.connected ? "Runtime status: Connected" : "Runtime status: Disconnected";
    errorStatus.textContent = currentStatus.lastError;
    status.textContent = "Ready to save Discord activity settings.";
  })();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      await props.host.kvSet("discord-activity:enabled", String(enabledInput.checked));
      await props.host.kvSet("discord-activity:details", detailsInput.value.trim());
      await props.host.kvSet("discord-activity:state", stateInput.value.trim());
      await props.host.kvSet("discord-activity:showTimestamp", String(showTimestampInput.checked));
      status.textContent = SAVE_MESSAGE;
      props.host.closeWindow();
    })();
  });
  form.append(enabledLabel, detailsLabel, stateLabel, showTimestampLabel, saveButton);
  root.append(heading, intro, form, runtimeStatus, errorStatus, status);
  return root;
}
export {
  DiscordActivityPanel as default
};
