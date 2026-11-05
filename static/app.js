import { PianoPlayer, scoreDuration, tempoValue } from "./piano.js";
import { reinterpretStaff } from "./score.js";

const $ = (id) => document.getElementById(id);
const state = {
  result: null,
  originals: null,
  selected: 0,
  fullPage: false,
  file: null,
  busy: false,
  exporting: false,
  request: 0,
  soundAction: 0,
  loop: false,
  changed: new Set(),
  controller: null,
};
const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const keyNames = [
  "C♭ / A♭ minor",
  "G♭ / E♭ minor",
  "D♭ / B♭ minor",
  "A♭ / F minor",
  "E♭ / C minor",
  "B♭ / G minor",
  "F / D minor",
  "C / A minor",
  "G / E minor",
  "D / B minor",
  "A / F♯ minor",
  "E / C♯ minor",
  "B / G♯ minor",
  "F♯ / D♯ minor",
  "C♯ / A♯ minor",
];
const noteName = (midi) =>
  midi === null
    ? "Rest"
    : names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
const currentStaff = () => state.result?.staffs[state.selected];
const options = () => ({
  tempo: tempoValue($("tempo").value),
  transpose: Number($("transpose").value),
  loop: state.loop,
});
const clock = (beats) => {
  const seconds = Math.floor((beats * 60) / options().tempo);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
let toastTimer, previewTimer;

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 4200);
}
function notice(message, type = "") {
  $("notice").textContent = message;
  $("notice").className = `notice ${type}`;
  $("notice").hidden = !message;
}

const player = new PianoPlayer({
  onNote: (event) => highlight(event),
  onProgress: (beat, total) => {
    $("seek").value = beat;
    $("position").textContent = clock(beat);
    $("totalTime").textContent = clock(total);
  },
  onState: (status) => {
    $("playIcon").textContent = status === "playing" ? "Ⅱ" : "▶";
    $("playLabel").textContent =
      status === "playing"
        ? "Pause"
        : status === "paused"
          ? "Resume"
          : "Play staff";
    $("playButton").setAttribute(
      "aria-label",
      status === "playing"
        ? "Pause playback"
        : status === "paused"
          ? "Resume playback"
          : "Play selected staff",
    );
    if (status !== "playing") highlight(null);
  },
});
player.setVolume(Number($("volume").value));

function highlight(event) {
  document
    .querySelectorAll(".note-marker.active,.piano-key.active")
    .forEach((el) => el.classList.remove("active"));
  if (event?.midi !== null && event?.midi !== undefined) {
    const midi = Math.min(127, Math.max(0, event.midi + options().transpose));
    document
      .querySelector(`.piano-key[data-midi="${midi}"]`)
      ?.classList.add("active");
    document
      .querySelector(`.note-marker[data-event="${event.id}"]`)
      ?.classList.add("active");
    $("currentNote").textContent = noteName(midi);
  } else $("currentNote").textContent = "♪";
}

async function preview(midi, event = null) {
  if (midi === null || state.busy) return;
  const token = ++state.soundAction;
  clearTimeout(previewTimer);
  player.stop();
  $("audioStatus").textContent = player.buffers.size
    ? "Sampled piano · plays locally"
    : "Preparing the local piano…";
  try {
    await player.preview(midi + (event ? options().transpose : 0));
    if (token !== state.soundAction) return;
    $("audioStatus").textContent = "88 sampled keys · ready to play";
    highlight(event || { midi: midi - options().transpose });
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => highlight(null), 650);
  } catch (error) {
    $("audioStatus").textContent = "Piano needs attention";
    toast(error.message);
  }
}

function stopPlayback() {
  state.soundAction++;
  clearTimeout(previewTimer);
  player.stop();
}

function buildKeyboard() {
  const whites = [0, 2, 4, 5, 7, 9, 11];
  let count = 0;
  for (let midi = 48; midi < 84; midi++) {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "piano-key";
    key.dataset.midi = midi;
    key.setAttribute("aria-label", `Play ${noteName(midi)}`);
    key.title = noteName(midi);
    if (whites.includes(midi % 12)) {
      key.textContent = midi % 12 === 0 ? noteName(midi) : "";
      count++;
    } else {
      key.classList.add("black");
      key.style.left = `${(count / 21) * 100 - 1.5}%`;
    }
    key.addEventListener("click", () => preview(midi));
    $("keyboard").append(key);
  }
}

function enableControls() {
  const staff = currentStaff(),
    hasNotes = !!staff?.events.some((event) => event.midi !== null);
  for (const id of [
    "playButton",
    "stopButton",
    "loopButton",
    "seek",
    "midiButton",
    "wavButton",
  ])
    $(id).disabled = state.busy || !hasNotes;
  $("wavButton").disabled ||= state.exporting;
  $("editButton").disabled = state.busy || !staff;
  $("viewButton").disabled = state.busy || !staff;
  $("pageSelect").disabled = state.busy;
  $("demoButton").disabled = state.busy;
  $("emptyDemoButton").disabled = state.busy;
  document.querySelectorAll(".staff-item").forEach((button) => {
    button.disabled = state.busy;
  });
}

function staffSummary(staff) {
  const key =
    keyNames[Number(staff.key_signature ?? 0) + 7] ||
    staff.key_name ||
    "Review key";
  return `${staff.clef === "bass" ? "Bass" : "Treble"} · ${key}`;
}

function renderStaffs() {
  $("staffList").replaceChildren();
  $("staffCount").textContent = state.result.staffs.length;
  state.result.staffs.forEach((staff, index) => {
    const button = document.createElement("button");
    button.className = `staff-item${index === state.selected ? " selected" : ""}`;
    button.type = "button";
    button.setAttribute("aria-pressed", String(index === state.selected));
    const icon = document.createElement("span");
    icon.className = "staff-icon";
    icon.textContent = staff.clef === "bass" ? "𝄢" : "𝄞";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "staff-text";
    const strong = document.createElement("strong");
    strong.textContent = `Staff ${index + 1}`;
    const small = document.createElement("small");
    small.textContent = staffSummary(staff);
    text.append(strong, small);
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${staff.events.filter((e) => e.midi !== null).length} notes`;
    button.append(icon, text, count);
    button.addEventListener("click", () => selectStaff(index));
    $("staffList").append(button);
  });
}

function selectStaff(index) {
  stopPlayback();
  state.selected = index;
  renderStaffs();
  renderScore();
  updateTiming();
  enableControls();
  const staff = currentStaff();
  $("scoreTitle").textContent =
    `Staff ${index + 1} · ${staffSummary(staff).split(" · ")[1]}`;
  $("recognitionMeta").textContent =
    `${staff.clef.toUpperCase()} CLEF  /  ${staff.time_signature || "REVIEW METER"}  /  ${staff.events.length} EVENTS${state.changed.has(index) ? "  /  EDITED" : ""}`;
  const warnings = [...new Set(state.result.warnings || [])].filter(
    (message) => {
      const match = /^Staff (\d+):/.exec(message);
      return !match || Number(match[1]) === index + 1;
    },
  );
  notice(
    warnings.map((message) => message.replace(/^Staff \d+: /, "")).join(" ") ||
      "Notes detected. Review the melody, then press play.",
  );
}

function svgElement(name, attributes) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes))
    el.setAttribute(key, value);
  return el;
}

function renderScore() {
  const result = state.result,
    staff = currentStaff();
  if (!result || !staff) return;
  const svg = $("scoreSvg");
  svg.replaceChildren();
  let box = [0, 0, result.width, result.height];
  if (!state.fullPage) {
    const [x, y, w, h] = staff.box;
    const pad = Math.max(12, h * 0.15);
    box = [
      Math.max(0, x - pad),
      Math.max(0, y - pad),
      Math.min(result.width - Math.max(0, x - pad), w + 2 * pad),
      Math.min(result.height - Math.max(0, y - pad), h + 2 * pad),
    ];
  }
  svg.setAttribute("viewBox", box.join(" "));
  svg.append(
    svgElement("image", {
      href: result.preview,
      width: result.width,
      height: result.height,
    }),
  );
  if (state.fullPage)
    result.staffs.forEach((item, index) => {
      const [x, y, w, h] = item.box;
      const region = svgElement("rect", {
        x,
        y,
        width: w,
        height: h,
        class: "staff-region",
        role: "button",
        tabindex: 0,
        "aria-label": `Select staff ${index + 1}`,
      });
      region.addEventListener("click", () => selectStaff(index));
      region.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectStaff(index);
        }
      });
      svg.append(region);
    });
  const radius = Math.max(6, (staff.lines[4] - staff.lines[0]) / 5);
  staff.events.forEach((event, index) => {
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return;
    const marker = svgElement("circle", {
      cx: event.x,
      cy: event.y,
      r: radius,
      class: `note-marker${event.confidence < 0.75 ? " low" : ""}`,
      "data-event": event.id,
      role: "button",
      tabindex: 0,
      "aria-label": `Note ${index + 1}: ${noteName(event.midi)}, ${event.duration} beats. Activate to hear.`,
      "aria-haspopup": "false",
    });
    const title = svgElement("title", {});
    title.textContent = `${index + 1} · ${noteName(event.midi)} · ${event.duration} beats${event.confidence < 0.75 ? " · Review" : ""}`;
    marker.append(title);
    const action = () => {
      if (event.midi === null) {
        toast(`Rest · ${event.duration} beats`);
      } else preview(event.midi, event);
    };
    marker.addEventListener("click", action);
    marker.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        action();
      }
    });
    svg.append(marker);
  });
  $("viewButton").textContent = state.fullPage
    ? "Focus staff ↙"
    : "Full page ↗";
}

function updateTiming() {
  const total = scoreDuration(currentStaff()?.events || []);
  $("seek").max = Math.max(1, total);
  $("seek").value = 0;
  $("position").textContent = "0:00";
  $("totalTime").textContent = clock(total);
}

async function analyze(file = null, page = 1, demo = false) {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const requestId = ++state.request;
  stopPlayback();
  state.busy = true;
  enableControls();
  $("dropzone").classList.add("loading");
  notice("Finding staves, reading notes, and checking the key…", "busy");
  try {
    let response;
    if (demo)
      response = await fetch("/api/demo", { signal: controller.signal });
    else {
      const form = new FormData();
      form.append("file", file);
      form.append("page", page);
      response = await fetch("/api/analyze", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
    }
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : "The score could not be read. Try a clearer crop.",
      );
    if (requestId !== state.request) return;
    if (!data.staffs.length)
      throw new Error(
        "No complete staff was found. Include all five lines, keep the score level, and crop closer to the music.",
      );
    state.result = data;
    state.originals = structuredClone(data.staffs);
    state.selected = 0;
    state.fullPage = false;
    state.file = demo ? null : file;
    state.changed.clear();
    $("scoreEmpty").hidden = true;
    $("scoreView").hidden = false;
    $("fileInfo").hidden = false;
    $("fileInfo").textContent =
      `${data.filename} · ${(data.elapsed_ms / 1000).toFixed(1)}s`;
    $("pageControls").hidden = data.pages <= 1;
    $("pageSelect").replaceChildren();
    for (let number = 1; number <= data.pages; number++) {
      const option = new Option(
        `${number} of ${data.pages}`,
        number,
        false,
        number === data.page,
      );
      $("pageSelect").add(option);
    }
    const warnings = [...new Set(data.warnings || [])];
    notice(
      warnings.length
        ? warnings.join(" ")
        : "Notes detected. Review the melody, then press play.",
    );
    selectStaff(0);
  } catch (error) {
    if (error.name !== "AbortError" && requestId === state.request) {
      if (state.result) $("pageSelect").value = state.result.page;
      notice(error.message, "error");
      toast(
        state.result
          ? "Could not read this score. Your previous score is still available."
          : "Could not read this score. Try a clearer screenshot.",
      );
    }
  } finally {
    if (requestId === state.request) {
      state.busy = false;
      $("dropzone").classList.remove("loading");
      enableControls();
    }
  }
}

function acceptFile(file) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    notice(
      "This file exceeds 25 MB. Crop the screenshot or use a smaller PDF.",
      "error",
    );
    return;
  }
  if (!file.size) {
    notice("This file is empty. Choose a screenshot or PDF.", "error");
    return;
  }
  analyze(file);
}

async function play() {
  const staff = currentStaff();
  if (!staff || state.busy) return;
  state.soundAction++;
  clearTimeout(previewTimer);
  if (player.state === "playing") {
    player.pause();
    return;
  }
  $("playButton").disabled = true;
  $("audioStatus").textContent = player.buffers.size
    ? "88 sampled keys · ready to play"
    : "Preparing the local piano…";
  try {
    await player.play(staff.events, {
      ...options(),
      fromBeat:
        player.state === "paused"
          ? player.currentBeat
          : Number($("seek").value) >= scoreDuration(staff.events)
            ? 0
            : Number($("seek").value),
    });
    $("audioStatus").textContent = "88 sampled keys · ready to play";
  } catch (error) {
    $("audioStatus").textContent = "Piano needs attention";
    toast(error.message);
  } finally {
    enableControls();
  }
}

function edited() {
  stopPlayback();
  let onset = 0;
  for (const event of currentStaff().events) {
    event.onset = onset;
    onset += event.duration;
    event.name = noteName(event.midi);
  }
  state.changed.add(state.selected);
  renderStaffs();
  renderScore();
  updateTiming();
  enableControls();
  $("recognitionMeta").textContent =
    `${currentStaff().clef.toUpperCase()} CLEF  /  ${currentStaff().time_signature || "REVIEW METER"}  /  ${currentStaff().events.length} EVENTS  /  EDITED`;
}

function renderReview() {
  const staff = currentStaff();
  if (!staff) return;
  $("clefSelect").value = staff.clef;
  $("keySelect").value = staff.key_signature;
  $("reviewHint").textContent =
    "Lengths use quarter-note beats: quarter = 1, eighth = 0.5, dotted quarter = 1.5. Clef/key changes preserve manually edited pitches.";
  $("noteRows").replaceChildren();
  staff.events.forEach((event, index) => {
    const row = document.createElement("tr");
    const number = document.createElement("td");
    number.textContent = index + 1;
    const pitchCell = document.createElement("td");
    const pitch = document.createElement("select");
    pitch.setAttribute("aria-label", `Pitch for note ${index + 1}`);
    pitch.add(new Option("Rest", "rest"));
    for (let midi = 0; midi <= 127; midi++)
      pitch.add(new Option(noteName(midi), midi));
    pitch.value = event.midi === null ? "rest" : event.midi;
    pitch.addEventListener("change", () => {
      event.midi = pitch.value === "rest" ? null : Number(pitch.value);
      event.manualPitch = true;
      edited();
      renderReview();
    });
    pitchCell.append(pitch);
    const durationCell = document.createElement("td");
    const duration = document.createElement("input");
    duration.type = "number";
    duration.min = ".125";
    duration.max = "32";
    duration.step = ".125";
    duration.value = event.duration;
    duration.setAttribute("aria-label", `Beats for note ${index + 1}`);
    duration.addEventListener("input", () => {
      const beats = Number(duration.value);
      if (Number.isFinite(beats) && beats >= 0.125 && beats <= 32) {
        event.duration = beats;
        edited();
      }
    });
    duration.addEventListener("change", () => {
      const beats = Number(duration.value);
      if (!Number.isFinite(beats) || beats < 0.125 || beats > 32) {
        duration.value = event.duration;
        toast("Use a length from 0.125 to 32 beats.");
        return;
      }
      event.duration = beats;
      edited();
    });
    durationCell.append(duration);
    const confidence = document.createElement("td");
    const read = document.createElement("span");
    read.className = `reading${event.confidence < 0.75 ? " low" : ""}`;
    read.textContent = event.manualPitch
      ? "Edited"
      : event.confidence < 0.75
        ? "Review"
        : "Detected";
    confidence.append(read);
    const actionCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const hear = document.createElement("button");
    hear.className = "icon-button";
    hear.textContent = "♪";
    hear.disabled = event.midi === null;
    hear.setAttribute("aria-label", `Hear note ${index + 1}`);
    hear.addEventListener("click", () => preview(event.midi, event));
    const remove = document.createElement("button");
    remove.className = "icon-button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove note ${index + 1}`);
    remove.addEventListener("click", () => {
      staff.events.splice(index, 1);
      edited();
      renderReview();
    });
    actions.append(hear, remove);
    actionCell.append(actions);
    row.append(number, pitchCell, durationCell, confidence, actionCell);
    $("noteRows").append(row);
  });
}

function reinterpret(clef, key) {
  try {
    reinterpretStaff(currentStaff(), clef, key);
    edited();
    renderReview();
    $("scoreTitle").textContent =
      `Staff ${state.selected + 1} · ${keyNames[key + 7]}`;
  } catch (error) {
    toast(error.message);
  }
}
function download(blob, extension, staffIndex = state.selected) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `prima-staff-${staffIndex + 1}.${extension}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("fileInput").addEventListener("change", (e) => {
  acceptFile(e.target.files[0]);
  e.target.value = "";
});
$("dropzone").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("fileInput").click();
  }
});
for (const name of ["dragenter", "dragover"])
  $("dropzone").addEventListener(name, (e) => {
    e.preventDefault();
    $("dropzone").classList.add("dragover");
  });
for (const name of ["dragleave", "drop"])
  $("dropzone").addEventListener(name, (e) => {
    e.preventDefault();
    $("dropzone").classList.remove("dragover");
  });
$("dropzone").addEventListener("drop", (e) =>
  acceptFile(e.dataTransfer.files[0]),
);
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());
document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((item) =>
    item.type.startsWith("image/"),
  );
  if (item) {
    e.preventDefault();
    acceptFile(item.getAsFile());
  }
});
for (const id of ["demoButton", "emptyDemoButton"])
  $(id).addEventListener("click", () => analyze(null, 1, true));
$("pageSelect").addEventListener("change", () => {
  if (state.file) analyze(state.file, Number($("pageSelect").value));
});
$("viewButton").addEventListener("click", () => {
  state.fullPage = !state.fullPage;
  renderScore();
});
$("playButton").addEventListener("click", play);
$("stopButton").addEventListener("click", stopPlayback);
$("loopButton").addEventListener("click", () => {
  state.loop = !state.loop;
  $("loopButton").setAttribute("aria-pressed", String(state.loop));
  if (player.state === "playing")
    player
      .play(currentStaff().events, {
        ...options(),
        fromBeat: player.currentBeat,
      })
      .catch((error) => toast(error.message));
});
$("seek").addEventListener("input", () => {
  const beat = Number($("seek").value);
  $("position").textContent = clock(beat);
  if (player.state !== "stopped")
    player.seek(beat).catch((error) => toast(error.message));
});
$("volume").addEventListener("input", () =>
  player.setVolume(Number($("volume").value)),
);
for (const id of ["tempo", "transpose"])
  $(id).addEventListener("change", () => {
    $("tempo").value = tempoValue($("tempo").value);
    const beat = player.currentBeat;
    const wasPlaying = player.state === "playing";
    if (wasPlaying)
      player
        .play(currentStaff().events, { ...options(), fromBeat: beat })
        .catch((error) => toast(error.message));
    $("position").textContent = clock(beat);
    $("totalTime").textContent = clock(
      scoreDuration(currentStaff()?.events || []),
    );
  });
$("editButton").addEventListener("click", () => {
  stopPlayback();
  renderReview();
  $("reviewDialog").showModal();
});
$("doneButton").addEventListener("click", () => {
  $("reviewDialog").close();
  renderScore();
});
$("resetNotesButton").addEventListener("click", () => {
  stopPlayback();
  state.result.staffs[state.selected] = structuredClone(
    state.originals[state.selected],
  );
  state.changed.delete(state.selected);
  selectStaff(state.selected);
  renderReview();
  toast("Original detection restored for this staff.");
});
$("addNoteButton").addEventListener("click", () => {
  const staff = currentStaff();
  staff.events.push({
    id: `manual-${Date.now()}`,
    midi: 60,
    name: "C4",
    onset: scoreDuration(staff.events),
    duration: 1,
    confidence: 1,
    manualPitch: true,
  });
  edited();
  renderReview();
  $("noteRows").lastElementChild?.scrollIntoView({ block: "nearest" });
});
$("clefSelect").addEventListener("change", () =>
  reinterpret($("clefSelect").value, Number($("keySelect").value)),
);
$("keySelect").addEventListener("change", () =>
  reinterpret($("clefSelect").value, Number($("keySelect").value)),
);
for (let key = -7; key <= 7; key++)
  $("keySelect").add(
    new Option(
      `${keyNames[key + 7]} · ${Math.abs(key)} ${key < 0 ? "flats" : key > 0 ? "sharps" : "accidentals"}`,
      key,
    ),
  );
for (const id of ["helpButton", "creditsButton"])
  $(id).addEventListener("click", () => $("helpDialog").showModal());
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      )
        dialog.close();
    }
  });
$("midiButton").addEventListener("click", () => {
  try {
    download(player.exportMidi(currentStaff().events, options()), "mid");
    toast("MIDI downloaded with your current settings.");
  } catch (error) {
    toast(error.message);
  }
});
$("wavButton").addEventListener("click", async () => {
  if (state.exporting) return;
  state.exporting = true;
  const staffIndex = state.selected;
  $("wavButton").disabled = true;
  $("wavButton").textContent = "Rendering…";
  try {
    stopPlayback();
    download(
      await player.exportWav(currentStaff().events, options()),
      "wav",
      staffIndex,
    );
    $("audioStatus").textContent = "88 sampled keys · ready to play";
    toast("Piano audio downloaded.");
  } catch (error) {
    toast(error.message);
  } finally {
    state.exporting = false;
    $("wavButton").textContent = "WAV ↓";
    enableControls();
  }
});
document.addEventListener("keydown", (e) => {
  if (
    !e.defaultPrevented &&
    e.code === "Space" &&
    !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(
      document.activeElement.tagName,
    ) &&
    !document.querySelector("dialog[open]") &&
    !$("playButton").disabled
  ) {
    e.preventDefault();
    play();
  }
});
window.addEventListener("pagehide", stopPlayback);
buildKeyboard();
enableControls();
