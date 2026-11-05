import { PianoPlayer, scoreDuration } from "./piano.js";
import { reinterpretStaff } from "./score.js";
import { DocumentImporter } from "./importer.js";
import {
  recommendTempo,
  toQuarterBpm,
  fromQuarterBpm,
  clampDisplayBpm,
  tempoPresets,
} from "./tempo.js";
import {
  pitchName,
  eventName,
  transposedKeySignature,
  spokenPitchName,
} from "./note-names.js";

const $ = (id) => document.getElementById(id);
const state = {
  result: null,
  originals: null,
  selected: 0,
  fullPage: false,
  file: null,
  busy: false,
  exporting: false,
  soundAction: 0,
  loop: false,
  changed: new Set(),
  importing: false,
  pageOptions: "",
  tempoRecommendation: null,
  tempoBpm: 72,
  tempos: new Map(),
};
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
const currentStaff = () => state.result?.staffs[state.selected];
const effectiveKey = () =>
  transposedKeySignature(
    currentStaff()?.key_signature ?? 0,
    Number($("transpose").value),
  );
const tempoProfile = () => state.tempoRecommendation || recommendTempo(null);
const tempoKey = () =>
  currentStaff()
    ? `${state.result.page}:${currentStaff().id ?? state.selected}`
    : null;
const options = () => ({
  // Score durations and the audio/export engine always use quarter-note beats.
  tempo: toQuarterBpm(state.tempoBpm, tempoProfile().quarterNotesPerBeat),
  transpose: Number($("transpose").value),
  loop: state.loop,
});
const clock = (beats) => {
  const seconds = Math.floor((beats * 60) / options().tempo);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
let toastTimer, previewTimer;

function renderTempoInfo() {
  const profile = tempoProfile();
  const preset = $("tempoPreset");
  preset.options[0].textContent = `Custom · ${state.tempoBpm} BPM`;
  preset.value = [...preset.options].some(
    (option) => option.value === String(state.tempoBpm),
  ) ? String(state.tempoBpm) : "";
  preset.setAttribute(
    "aria-label", `BPM preset in ${profile.beatLabel} beats per minute`,
  );
  $("tempoUnit").textContent = `${profile.beatSymbol} BPM`;
  $("tempo").setAttribute(
    "aria-label",
    `Tempo in ${profile.beatLabel} beats per minute`,
  );
  $("tempoRange").textContent =
    `${profile.beatLabel} beat · suggested ${profile.minBpm}–${profile.maxBpm} BPM`;
  $("tempoReason").textContent = state.tempos.has(tempoKey())
    ? "Your tempo is saved for this staff. Use suggested to reset."
    : `Auto start: ${profile.bpm} BPM. Adjust to your voice and the phrase.`;
  $("tempoRecommendation").title = profile.reason;
  $("autoTempoButton").disabled =
    state.busy || !currentStaff() || !state.tempos.has(tempoKey());
  $("tempoRecommendation").hidden = !currentStaff();
}

function refreshTempo() {
  state.tempoRecommendation = recommendTempo(currentStaff());
  const profile = tempoProfile(),
    manual = state.tempos.get(tempoKey());
  const displayBpm = manual
    ? fromQuarterBpm(
        toQuarterBpm(manual.bpm, manual.factor),
        profile.quarterNotesPerBeat,
      )
    : profile.bpm;
  state.tempoBpm = clampDisplayBpm(displayBpm, profile.quarterNotesPerBeat);
  $("tempo").min = Math.ceil(30 / profile.quarterNotesPerBeat);
  $("tempo").max = Math.floor(240 / profile.quarterNotesPerBeat);
  $("tempo").value = state.tempoBpm;
  const custom = new Option("Custom", "");
  custom.disabled = true;
  $("tempoPreset").replaceChildren(
    custom,
    ...tempoPresets(profile.quarterNotesPerBeat).map(
      (bpm) => new Option(`${bpm} BPM`, String(bpm)),
    ),
  );
  renderTempoInfo();
}

function applyTempo(bpm, manual = true) {
  const beat =
      player.state === "stopped" ? Number($("seek").value) : player.currentBeat,
    wasPlaying = player.state === "playing";
  const previous = options().tempo;
  state.tempoBpm = clampDisplayBpm(bpm, tempoProfile().quarterNotesPerBeat);
  $("tempo").value = state.tempoBpm;
  if (manual && currentStaff())
    state.tempos.set(tempoKey(), {
      bpm: state.tempoBpm,
      factor: tempoProfile().quarterNotesPerBeat,
    });
  renderTempoInfo();
  $("position").textContent = clock(beat);
  $("totalTime").textContent = clock(
    scoreDuration(currentStaff()?.events || []),
  );
  if (wasPlaying && previous !== options().tempo)
    player
      .play(currentStaff().events, { ...options(), fromBeat: beat })
      .catch((error) => toast(error.message));
}

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
    $("currentNote").textContent = event.keyboardPreview
      ? pitchName(midi, effectiveKey())
      : eventName(event, currentStaff(), { transpose: options().transpose });
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
    $("audioStatus").textContent = "88 sampled keys · ready to play";
    if (token !== state.soundAction) return;
    highlight(
      event || { midi: midi - options().transpose, keyboardPreview: true },
    );
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
    key.setAttribute(
      "aria-label",
      `Play ${spokenPitchName(pitchName(midi, effectiveKey()))}`,
    );
    key.title = pitchName(midi, effectiveKey());
    if (whites.includes(midi % 12)) {
      key.textContent = midi % 12 === 0 ? pitchName(midi, effectiveKey()) : "";
      count++;
    } else {
      key.classList.add("black");
      key.style.left = `${(count / 21) * 100 - 1.5}%`;
    }
    key.addEventListener("click", () => preview(midi));
    $("keyboard").append(key);
  }
}

function refreshKeyboardNames() {
  document.querySelectorAll(".piano-key").forEach((key) => {
    const midi = Number(key.dataset.midi),
      name = pitchName(midi, effectiveKey());
    key.setAttribute("aria-label", `Play ${spokenPitchName(name)}`);
    key.title = name;
    if (!key.classList.contains("black"))
      key.textContent = midi % 12 === 0 ? name : "";
  });
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
  $("pageSelect").disabled = state.importing;
  $("tempo").disabled = state.busy || !staff;
  $("tempoPreset").disabled = state.busy || !staff;
  $("autoTempoButton").disabled =
    state.busy || !staff || !state.tempos.has(tempoKey());
  $("demoButton").disabled = state.importing;
  $("emptyDemoButton").disabled = state.importing;
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
    button.addEventListener("click", () => {
      importer.retainSelection();
      selectStaff(index);
    });
    $("staffList").append(button);
  });
}

function selectStaff(index) {
  if (!state.result?.staffs[index]) return;
  stopPlayback();
  state.selected = index;
  const record = importer.document?.page(importer.currentPage);
  if (record) record.selectedStaff = index;
  refreshTempo();
  refreshKeyboardNames();
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
  if (!result?.preview) return;
  const svg = $("scoreSvg");
  svg.replaceChildren();
  let box = [0, 0, result.width, result.height];
  if (!state.fullPage && staff) {
    const [x, y, w, h] = staff.box;
    const pad = Math.max(12, h * 0.15);
    box = [
      Math.max(0, x - pad),
      Math.max(0, y),
      Math.min(result.width - Math.max(0, x - pad), w + 2 * pad),
      Math.min(result.height - Math.max(0, y), h),
    ];
  }
  svg.setAttribute("viewBox", box.join(" "));
  // A minimum display height can letterbox a wide staff; clip in score units
  // so page titles and neighboring exercises cannot leak into that space.
  const clip = svgElement("clipPath", {
    id: "scoreClip",
    clipPathUnits: "userSpaceOnUse",
  });
  clip.append(
    svgElement("rect", { x: box[0], y: box[1], width: box[2], height: box[3] }),
  );
  const drawing = svgElement("g", { "clip-path": "url(#scoreClip)" });
  svg.append(clip, drawing);
  drawing.append(
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
      drawing.append(region);
    });
  if (!staff) return;
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
      "aria-label": `Note ${index + 1}: ${spokenPitchName(eventName(event, staff))}, ${event.duration} beats. Activate to hear.`,
      "aria-haspopup": "false",
    });
    const title = svgElement("title", {});
    title.textContent = `${index + 1} · ${eventName(event, staff)} · ${event.duration} beats${event.confidence < 0.75 ? " · Review" : ""}`;
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
    drawing.append(marker);
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

function pageStatus(record) {
  if (!record) return "queued";
  if (record.status === "ready") return `${record.result.staffs.length} staves`;
  if (record.status === "error")
    return /no.*staff/i.test(record.error || "")
      ? "no staff"
      : "could not read";
  return record.status === "processing" ? "reading…" : "queued";
}

function updateDocumentProgress(info) {
  state.importing = info.importing;
  $("dropzone").classList.toggle("loading", info.importing);
  if (info.importing)
    notice("Checking the file and discovering its pages…", "busy");
  const doc = info.document;
  if (!doc) {
    $("scanControls").hidden = !info.importing;
    $("scanProgress").textContent = "Discovering the document’s pages…";
    $("scanMeter").max = 1;
    $("scanMeter").value = 0;
    $("scanButton").textContent = "Cancel import";
    $("scanButton").disabled = false;
    $("retryPageButton").hidden = true;
    enableControls();
    return;
  }
  $("fileInfo").hidden = false;
  $("fileInfo").textContent =
    `${doc.filename} · ${doc.pages} ${doc.pages === 1 ? "page" : "pages"}`;
  $("pageControls").hidden = doc.pages <= 1;
  const nearby = [];
  if (doc.pages <= 200)
    for (let page = 1; page <= doc.pages; page++) nearby.push(page);
  else {
    nearby.push(1);
    for (
      let page = Math.max(2, info.currentPage - 25);
      page <= Math.min(doc.pages - 1, info.currentPage + 25);
      page++
    )
      nearby.push(page);
    nearby.push(doc.pages);
  }
  const signature = nearby.join(",");
  if (signature !== state.pageOptions) {
    $("pageSelect").replaceChildren(
      ...nearby.map((page) => new Option(String(page), page)),
    );
    state.pageOptions = signature;
  }
  const records = new Map(doc.records.map((record) => [record.number, record]));
  for (const option of $("pageSelect").options)
    option.textContent = `${option.value} of ${doc.pages} · ${pageStatus(records.get(Number(option.value)))}`;
  $("pageSelect").value = info.currentPage;
  $("pageJump").hidden = doc.pages <= 200;
  $("pageJump").max = doc.pages;
  $("pageJump").value = info.currentPage;
  $("pageJump").disabled = info.importing;
  $("previousPage").disabled = info.importing || info.currentPage <= 1;
  $("nextPage").disabled = info.importing || info.currentPage >= doc.pages;
  $("scanControls").hidden = false;
  const progress = info.progress;
  $("scanMeter").max = doc.pages;
  $("scanMeter").value = progress.done;
  $("scanProgress").textContent = info.scanning
    ? `Reading page ${info.processingPage || info.currentPage} · ${progress.done} of ${doc.pages} scanned`
    : progress.pending
      ? `Scan paused · ${progress.done} of ${doc.pages} scanned`
      : `${doc.pages} of ${doc.pages} scanned · ${progress.ready} ready${progress.failed ? ` · ${progress.failed} with no music or a reading error` : ""}`;
  $("scanButton").textContent = info.importing
    ? "Cancel import"
    : info.scanning
      ? "Stop scan"
      : progress.pending
        ? "Scan remaining"
        : "Scan complete";
  $("scanButton").disabled =
    !info.importing && !info.scanning && !progress.pending;
  $("retryPageButton").hidden = doc.page(info.currentPage).status !== "error";
  $("retryPageButton").disabled = info.importing || info.scanning;
  enableControls();
}

function showDocumentPage(
  record,
  { previewLoading = false, previewError = null } = {},
) {
  if ($("reviewDialog").open) $("reviewDialog").close();
  stopPlayback();
  state.selected = record.selectedStaff;
  state.changed = record.changed;
  state.originals = record.originals;
  state.fullPage = record.fullPage ?? false;
  state.busy =
    previewLoading || ["queued", "processing"].includes(record.status);
  state.result = record.result || null;
  $("scoreSvg").replaceChildren();
  $("emptyDemoButton").hidden = true;
  if (record.result?.preview && !previewLoading) {
    $("scoreEmpty").hidden = true;
    $("scoreView").hidden = false;
    if (record.status === "ready" && record.result.staffs.length) {
      state.busy = false;
      selectStaff(
        Math.min(record.selectedStaff, record.result.staffs.length - 1),
      );
      return;
    }
    state.busy = false;
    state.fullPage = true;
    renderStaffs();
    renderScore();
  } else {
    $("scoreEmpty").hidden = false;
    $("scoreView").hidden = true;
    $("scoreEmpty").querySelector("h3").textContent = previewLoading
      ? `Opening page ${record.number}…`
      : record.status === "processing"
        ? `Reading page ${record.number}…`
        : record.status === "queued"
          ? `Page ${record.number} is waiting.`
          : `Page ${record.number} needs a closer look.`;
    $("scoreEmpty").querySelector("p").textContent = previewLoading
      ? "Loading this page’s image; recognized notes and edits are preserved."
      : record.status === "queued"
        ? "The scan will read this page when it reaches it. Use Scan remaining if the scan is paused."
        : record.status === "processing"
          ? "Finding staff lines, notes and key signatures locally. Other completed pages remain available."
          : previewError ||
            record.error ||
            "Choose another page or retry this one.";
    $("staffList").replaceChildren();
    $("staffCount").textContent = "—";
  }
  $("scoreTitle").textContent = `Page ${record.number} · ${pageStatus(record)}`;
  $("recognitionMeta").textContent =
    record.status === "error"
      ? "OTHER PAGES REMAIN AVAILABLE"
      : "LOCAL PAGE RECOGNITION";
  refreshTempo();
  refreshKeyboardNames();
  updateTiming();
  enableControls();
  notice(
    previewError ||
      record.error ||
      (previewLoading
        ? "Opening the selected page…"
        : record.status === "processing"
          ? "Reading this page. You can switch to any completed page."
          : "This page is queued. Resume scanning to recognize remaining pages."),
    record.status === "error" ? "error" : "busy",
  );
}

const importer = new DocumentImporter({
  onDocument: () => {
    state.file = importer.file;
    state.tempos.clear();
    state.pageOptions = "";
  },
  onPage: showDocumentPage,
  onProgress: updateDocumentProgress,
  onError: (message) => {
    notice(message, "error");
    toast(message);
  },
});

function analyze(file = null, page = 1, demo = false) {
  if ($("reviewDialog").open) $("reviewDialog").close();
  stopPlayback();
  if (demo) importer.loadDemo();
  else importer.importFile(file);
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
    event.name = eventName(event, currentStaff());
  }
  state.changed.add(state.selected);
  refreshTempo();
  refreshKeyboardNames();
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
      pitch.add(new Option(pitchName(midi, staff.key_signature), midi));
    if (event.midi !== null)
      pitch.options[event.midi + 1].textContent = eventName(event, staff);
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
  importer.selectPage(Number($("pageSelect").value));
});
$("pageJump").addEventListener("change", () => {
  const page = Number($("pageJump").value);
  if (Number.isInteger(page) && page >= 1 && page <= importer.document?.pages)
    importer.selectPage(page);
  else {
    $("pageJump").value = importer.currentPage;
    toast("Choose a page within this PDF.");
  }
});
$("previousPage").addEventListener("click", () =>
  importer.selectPage(importer.currentPage - 1),
);
$("nextPage").addEventListener("click", () =>
  importer.selectPage(importer.currentPage + 1),
);
$("scanButton").addEventListener("click", () => {
  if (importer.importing) importer.cancelImport();
  else if (importer.scanning) importer.stopScan();
  else importer.startScan();
});
$("retryPageButton").addEventListener("click", () => importer.retryPage());
$("viewButton").addEventListener("click", () => {
  state.fullPage = !state.fullPage;
  const record = importer.document?.page(importer.currentPage);
  if (record) record.fullPage = state.fullPage;
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
$("tempo").addEventListener("input", () => {
  const value = Number($("tempo").value);
  if (
    $("tempo").value.trim() &&
    Number.isInteger(value) &&
    value >= Number($("tempo").min) &&
    value <= Number($("tempo").max)
  )
    applyTempo(value);
});
$("tempo").addEventListener("change", () =>
  applyTempo($("tempo").value.trim() ? $("tempo").value : state.tempoBpm),
);
$("tempoPreset").addEventListener("change", () => {
  const value = Number($("tempoPreset").value);
  if (tempoPresets(tempoProfile().quarterNotesPerBeat).includes(value))
    applyTempo(value);
});
$("autoTempoButton").addEventListener("click", () => {
  state.tempos.delete(tempoKey());
  applyTempo(tempoProfile().bpm, false);
});
$("transpose").addEventListener("change", () => {
  const beat =
    player.state === "stopped" ? Number($("seek").value) : player.currentBeat;
  const wasPlaying = player.state === "playing";
  state.soundAction++;
  clearTimeout(previewTimer);
  if (!wasPlaying) {
    // Cancel an audition at its old pitch, retaining the transport's position.
    if (player.state === "paused") player.pause();
    else {
      stopPlayback();
      $("seek").value = beat;
    }
  }
  refreshKeyboardNames();
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
  importer.retainSelection();
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
window.addEventListener("pagehide", () => {
  stopPlayback();
  importer.cancelWork();
});
buildKeyboard();
refreshTempo();
enableControls();
