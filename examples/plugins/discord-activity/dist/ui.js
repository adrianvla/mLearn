// examples/plugins/discord-activity/src/runtime.ts
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
function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds < 0) {
    return "--:--";
  }
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
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

// examples/plugins/discord-activity/src/ui.ts
var SAVE_MESSAGE = "Saved. Disable and re-enable the plugin to apply Discord changes.";
var LOAD_ERROR_PREFIX = "Failed to load Discord activity settings:";
var SAVE_ERROR_PREFIX = "Failed to save Discord activity settings:";
function getErrorMessage(error) {
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
      status.textContent = `${LOAD_ERROR_PREFIX} ${getErrorMessage(error)}`;
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
        status.textContent = `${SAVE_ERROR_PREFIX} ${getErrorMessage(error)}`;
      }
    })();
  });
  form.append(enabledLabel, showTimestampLabel, saveButton);
  root.append(heading, intro, activityDescription, activityList, form, runtimeStatus, errorStatus, status);
  return root;
}
export {
  DiscordActivityPanel as default
};
