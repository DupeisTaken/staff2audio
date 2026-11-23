import test from 'node:test';
import assert from 'node:assert/strict';
import {
  staffStepFromY,
  yFromStaffStep,
  pitchFromWorksheetY,
  yFromPitchOnStaff,
  findSystemAndStaffAtPoint,
  computeWorksheetOverlayLayout,
  renderWorksheetCanvas,
  highlightWorksheetActiveNotes,
  highlightWorksheetIssue,
} from '../static/worksheet-canvas.js';

// Helper: build a standard 5-line staff from topY and line spacing
const makeLines = (topY, space = 12) => [0, 1, 2, 3, 4].map(i => topY + i * space);

// ---------------------------------------------------------------------------
// 1. staffStepFromY & yFromStaffStep roundtrips
// ---------------------------------------------------------------------------

test('staffStepFromY and yFromStaffStep roundtrip accurately across treble and bass staves', () => {
  const trebleLines = makeLines(100, 12); // [100, 112, 124, 136, 148] -> half-space = 6
  const bassLines = makeLines(220, 10);   // [220, 230, 240, 250, 260] -> half-space = 5

  // Bottom line = step 0, top line = step 8
  assert.equal(staffStepFromY(148, trebleLines), 0);
  assert.equal(staffStepFromY(100, trebleLines), 8);
  assert.equal(staffStepFromY(142, trebleLines), 1); // F4 first space
  assert.equal(staffStepFromY(160, trebleLines), -2); // Middle C4 ledger line below treble

  // Snaps off-center Y coordinates to nearest half-space
  assert.equal(staffStepFromY(145.5, trebleLines), 0);
  assert.equal(staffStepFromY(144.4, trebleLines), 1);

  // Exact roundtrip across full ledger-line span (-6..+14)
  for (let step = -6; step <= 14; step++) {
    const ty = yFromStaffStep(step, trebleLines);
    assert.equal(staffStepFromY(ty, trebleLines), step);
    const by = yFromStaffStep(step, bassLines);
    assert.equal(staffStepFromY(by, bassLines), step);
  }

  assert.throws(() => staffStepFromY(100, [100, 110]), RangeError);
  assert.throws(() => yFromStaffStep(0, [200, 190, 180, 170, 160]), RangeError);
});

// ---------------------------------------------------------------------------
// 2. pitchFromWorksheetY (key signatures & ledger lines)
// ---------------------------------------------------------------------------

test('pitchFromWorksheetY resolves D minor (1 flat), A major (3 sharps), and middle C4 ledger lines', () => {
  const trebleLines = makeLines(80, 10);  // [80, 90, 100, 110, 120], bottom E4 = 120
  const bassLines = makeLines(180, 10);   // [180, 190, 200, 210, 220], bottom G2 = 220

  // D minor / F major (keySignature = -1 -> Bb)
  const trebleB4 = pitchFromWorksheetY(100, 'treble', trebleLines, -1); // 3rd line = step 4 = B4
  assert.deepEqual(trebleB4, {
    letter: 'B',
    octave: 4,
    alteration: -1,
    staffStep: 4,
    y: 100,
    midi: 70,
    spell: 'Bb4',
    display: 'B♭4',
  });

  const bassB2 = pitchFromWorksheetY(210, 'bass', bassLines, -1); // 2nd line = step 2 = B2
  assert.equal(bassB2.spell, 'Bb2');
  assert.equal(bassB2.display, 'B♭2');
  assert.equal(bassB2.midi, 46);
  assert.equal(bassB2.y, 210);

  // A major (keySignature = +3 -> F#, C#, G#)
  const fSharp5 = pitchFromWorksheetY(80, 'treble', trebleLines, 3);
  assert.equal(fSharp5.spell, 'F#5');
  assert.equal(fSharp5.display, 'F♯5');
  assert.equal(fSharp5.midi, 78);

  const cSharp5 = pitchFromWorksheetY(95, 'treble', trebleLines, 3); // 3rd space = step 5 = C5
  assert.equal(cSharp5.spell, 'C#5');
  assert.equal(cSharp5.midi, 73);

  const gSharp4 = pitchFromWorksheetY(110, 'treble', trebleLines, 3); // 2nd line = step 2 = G4
  assert.equal(gSharp4.spell, 'G#4');
  assert.equal(gSharp4.midi, 68);

  const a4Natural = pitchFromWorksheetY(105, 'treble', trebleLines, 3); // 2nd space = step 3 = A4
  assert.equal(a4Natural.spell, 'A4');
  assert.equal(a4Natural.alteration, 0);

  // Middle C4 on treble (1 ledger below = step -2 -> y = 130) & bass (1 ledger above = step +10 -> y = 170)
  const trebleMiddleC = pitchFromWorksheetY(131.2, 'treble', trebleLines, 0);
  assert.equal(trebleMiddleC.spell, 'C4');
  assert.equal(trebleMiddleC.midi, 60);
  assert.equal(trebleMiddleC.staffStep, -2);
  assert.equal(trebleMiddleC.y, 130);

  const bassMiddleC = pitchFromWorksheetY(169.1, 'bass', bassLines, 0);
  assert.equal(bassMiddleC.spell, 'C4');
  assert.equal(bassMiddleC.midi, 60);
  assert.equal(bassMiddleC.staffStep, 10);
  assert.equal(bassMiddleC.y, 170);
});

// ---------------------------------------------------------------------------
// 3. yFromPitchOnStaff (snapping edited / fixed pitches onto exact staff lines)
// ---------------------------------------------------------------------------

test('yFromPitchOnStaff moves markers to exact staff lines and ledger coordinates for strings and objects', () => {
  const trebleLines = makeLines(80, 12); // [80, 92, 104, 116, 128], half-space = 6
  const bassLines = makeLines(200, 12);  // [200, 212, 224, 236, 248], half-space = 6

  const fSharp4 = yFromPitchOnStaff('F#4', 'treble', trebleLines);
  assert.equal(fSharp4.staffStep, 1);
  assert.equal(fSharp4.y, 122);
  assert.equal(fSharp4.midi, 66);
  assert.deepEqual(fSharp4.ledgerLines, []);

  // After Apply Fix moves G4 -> A4 on treble:
  const g4 = yFromPitchOnStaff('G4', 'treble', trebleLines);
  const a4 = yFromPitchOnStaff('A4', 'treble', trebleLines);
  assert.equal(g4.y, 116);
  assert.equal(a4.y, 110);

  // Object pitch form with flat accidental on bass
  const bb2 = yFromPitchOnStaff({ letter: 'B', octave: 2, alteration: -1 }, 'bass', bassLines);
  assert.equal(bb2.staffStep, 2);
  assert.equal(bb2.y, 236);
  assert.equal(bb2.spell, 'Bb2');
  assert.equal(bb2.display, 'B♭2');

  // Middle C4 ledger line on both staves
  const c4Treble = yFromPitchOnStaff('C4', 'treble', trebleLines);
  assert.equal(c4Treble.y, 140);
  assert.deepEqual(c4Treble.ledgerLines, [140]);

  const c4Bass = yFromPitchOnStaff('C4', 'bass', bassLines);
  assert.equal(c4Bass.y, 188);
  assert.deepEqual(c4Bass.ledgerLines, [188]);

  // Invalid / rest returns null
  assert.equal(yFromPitchOnStaff('Rest', 'treble', trebleLines), null);
  assert.equal(yFromPitchOnStaff(null, 'treble', trebleLines), null);
});

// ---------------------------------------------------------------------------
// 4. findSystemAndStaffAtPoint across multi-system worksheets
// ---------------------------------------------------------------------------

test('findSystemAndStaffAtPoint resolves stacked grand-staff systems and treble/bass midpoints', () => {
  const systems = [
    {
      index: 0,
      treble: { lines: makeLines(80, 10), left: 60, right: 940, space: 10 },
      bass: { lines: makeLines(170, 10), left: 60, right: 940, space: 10 },
    },
    {
      index: 1,
      treble: { lines: makeLines(320, 10), left: 60, right: 940, space: 10 },
      bass: { lines: makeLines(410, 10), left: 60, right: 940, space: 10 },
    },
  ];

  // System 0 treble vs bass split at (120 + 170) / 2 = 145
  const s0Treble = findSystemAndStaffAtPoint(300, 144, systems);
  assert.equal(s0Treble.systemIndex, 0);
  assert.equal(s0Treble.staff, 'treble');
  assert.equal(s0Treble.space, 10);

  const s0Bass = findSystemAndStaffAtPoint(300, 146, systems);
  assert.equal(s0Bass.systemIndex, 0);
  assert.equal(s0Bass.staff, 'bass');

  // Between System 0 bass bottom (210) and System 1 treble top (320): split at 265
  assert.equal(findSystemAndStaffAtPoint(400, 240, systems).systemIndex, 0);
  assert.equal(findSystemAndStaffAtPoint(400, 240, systems).staff, 'bass');
  assert.equal(findSystemAndStaffAtPoint(400, 290, systems).systemIndex, 1);
  assert.equal(findSystemAndStaffAtPoint(400, 290, systems).staff, 'treble');

  // System 1 bass
  const s1Bass = findSystemAndStaffAtPoint(500, 435, systems);
  assert.equal(s1Bass.systemIndex, 1);
  assert.equal(s1Bass.staff, 'bass');

  // Outside vertical or horizontal margins -> null
  assert.equal(findSystemAndStaffAtPoint(300, 10, systems), null);
  assert.equal(findSystemAndStaffAtPoint(300, 560, systems), null);
  assert.equal(findSystemAndStaffAtPoint(15, 100, systems), null);
});

// ---------------------------------------------------------------------------
// 5. computeWorksheetOverlayLayout: four-part mode
// ---------------------------------------------------------------------------

test('computeWorksheetOverlayLayout builds four-part markers, review flags, pills, and parallel-5th arcs on image coords', () => {
  const sys0 = {
    index: 0,
    treble: { lines: makeLines(100, 12), left: 80, right: 900, space: 12 }, // E4 = 148, G4 = 136, A4 = 130
    bass: { lines: makeLines(220, 12), left: 80, right: 900, space: 12 },   // G2 = 268, C3 = 250, D3 = 244, C4 = 208
  };

  const layout = computeWorksheetOverlayLayout({
    mode: 'four-part',
    width: 1000,
    height: 400,
    preview: 'data:image/png;base64,AAAA',
    keySignature: 0,
    systems: [sys0],
    chords: [
      {
        index: 0,
        system_index: 0,
        onset: 0,
        duration: 1,
        x: 240,
        voices: {
          S: { pitch: 'G4', source: 'printed', confidence: 0.96 },
          A: { pitch: 'E4', source: 'handwritten', confidence: 0.62 }, // low confidence -> needsReview
          T: 'C4',
          B: 'C3',
        },
        voice_coords: {
          S: { x: 240, y: 999 }, // Intentionally stale Y -> must snap to true G4 staff line (136)!
          A: { x: 242, y: 148 },
          T: { x: 240, y: 208 },
          B: { x: 240, y: 250 },
        },
        figure: '5/3',
        roman: 'I',
        figure_y: 295,
        roman_y: 320,
      },
      {
        index: 1,
        system_index: 0,
        onset: 1,
        duration: 1,
        x: 380,
        voices: {
          S: 'A4',
          A: null, // explicitly missing -> needsReview & missing
          T: 'D4',
          B: 'D3',
        },
        figure: '6',
        roman: 'ii',
      },
    ],
    issues: [
      {
        id: 'p5-sb',
        issueIndex: 0,
        code: 'PARALLEL_5TH',
        severity: 'error',
        message: 'Parallel 5ths between S and B',
        chordIndices: [0, 1],
        voices: ['S', 'B'],
      },
      {
        id: 'spacing-0',
        issueIndex: 1,
        code: 'SPACING',
        severity: 'warning',
        message: 'Spacing > octave between A and T',
        chordIndex: 0,
        voices: ['A', 'T'],
      },
    ],
    selection: { chordIndex: 0, voice: 'S' },
  });

  assert.equal(layout.markers.length, 8);

  // S0 snaps to true G4 staff line (136), ignoring stale raw y=999
  const s0 = layout.markers.find(m => m.chordIndex === 0 && m.voice === 'S');
  assert.equal(s0.x, 240);
  assert.equal(s0.y, 136);
  assert.equal(s0.radius, Number((12 * 0.48).toFixed(2)));
  assert.equal(s0.selected, true);
  assert.equal(s0.needsReview, false);

  // A0 low confidence triggers needsReview
  const a0 = layout.markers.find(m => m.chordIndex === 0 && m.voice === 'A');
  assert.equal(a0.needsReview, true);
  assert.equal(a0.missing, false);
  assert.equal(a0.source, 'handwritten');

  // A1 explicitly missing triggers missing & needsReview
  const a1 = layout.markers.find(m => m.chordIndex === 1 && m.voice === 'A');
  assert.equal(a1.missing, true);
  assert.equal(a1.needsReview, true);
  assert.equal(a1.display, '?');

  // Grand-staff OMR fallback voice_coords[v].missing = true retains placeholder pitch while flagging needsReview
  const omrDraft = computeWorksheetOverlayLayout({
    mode: 'four_part',
    width: 1000,
    height: 400,
    systems: [sys0],
    chords: [
      {
        index: 0,
        system_index: 0,
        onset: 0,
        duration: 1,
        x: 240,
        voices: { S: 'G4', A: 'E4', T: 'G3', B: 'C3' },
        voice_coords: {
          S: { x: 240, y: 136, source: 'printed', confidence: 0.95, missing: false },
          A: { x: 240, y: 148, source: 'fallback', confidence: 0.2, missing: true },
          T: { x: 240, y: 232, source: 'handwritten', confidence: 0.85, missing: false },
          B: { x: 240, y: 250, source: 'printed', confidence: 0.95, missing: false },
        },
      },
    ],
  });
  const fallbackAlto = omrDraft.markers.find(m => m.voice === 'A');
  assert.equal(fallbackAlto.missing, true);
  assert.equal(fallbackAlto.needsReview, true);
  assert.equal(fallbackAlto.spell, 'E4');
  assert.equal(fallbackAlto.display, 'E4');

  // Roman numeral & Figured Bass pills
  assert.equal(layout.columnMeta.length, 2);
  assert.equal(layout.columnMeta[0].roman, 'I');
  assert.equal(layout.columnMeta[0].figure, '5/3');
  assert.equal(layout.columnMeta[0].figureY, 295);
  assert.equal(layout.columnMeta[0].romanY, 320);

  // Parallel 5th red-ink overlay connects exact marker image coordinates (240,136)->(380,130) & (240,250)->(380,244)
  assert.equal(layout.issueOverlays.length, 2);
  const p5 = layout.issueOverlays[0];
  assert.equal(p5.halos.length, 4);
  assert.equal(p5.arcs.length, 2);
  const sArc = p5.arcs.find(a => a.voice === 'S');
  const bArc = p5.arcs.find(a => a.voice === 'B');
  assert.equal(sArc.x1, 240);
  assert.equal(sArc.y1, 136);
  assert.equal(sArc.x2, 380);
  assert.equal(sArc.y2, 130);
  assert.equal(bArc.x1, 240);
  assert.equal(bArc.y1, 250);
  assert.equal(bArc.x2, 380);
  assert.equal(bArc.y2, 244);
  assert.match(sArc.path, /^M 240\.0 136\.0 Q .+ 380\.0 130\.0$/);

  // Single-chord spacing arc connects A0 and T0
  const sp = layout.issueOverlays[1];
  assert.equal(sp.halos.length, 2);
  assert.equal(sp.arcs.length, 1);
});

// ---------------------------------------------------------------------------
// 6. computeWorksheetOverlayLayout: multi-system melody mode (FRQ 7)
// ---------------------------------------------------------------------------

test('computeWorksheetOverlayLayout handles multi-system melody mode, gradeFromOnset divider, NCTs, cadences, and noteIndex halos', () => {
  const systems = [
    {
      index: 0,
      treble: { lines: makeLines(80, 10), left: 70, right: 920, space: 10 },
      bass: { lines: makeLines(170, 10), left: 70, right: 920, space: 10 },
      barlines: [310, 600],
    },
    {
      index: 1,
      treble: { lines: makeLines(310, 10), left: 70, right: 920, space: 10 },
      bass: { lines: makeLines(400, 10), left: 70, right: 920, space: 10 },
      barlines: [500],
    },
  ];

  const layout = computeWorksheetOverlayLayout({
    mode: 'melody',
    width: 1000,
    height: 540,
    preview: 'data:image/png;base64,BBBB',
    keySignature: -1, // F major / D minor
    systems,
    gradeFromOnset: 4, // Measure 1 (beats 0..3) is printed/given; grading starts at beat 4!
    melody: [
      { index: 0, system_index: 0, onset: 0, duration: 2, pitch: 'F4', x: 180, source: 'printed', confidence: 0.98 },
      { index: 1, system_index: 0, onset: 2, duration: 2, pitch: 'A4', x: 260, source: 'printed', confidence: 0.95 },
      { index: 2, system_index: 0, onset: 4, duration: 1, pitch: 'Bb4', x: 380, source: 'printed', confidence: 0.97, nct: 'PT' },
      { index: 3, system_index: 1, onset: 6, duration: 2, pitch: 'A4', x: 240, source: 'printed', confidence: 0.99 },
      { index: 4, system_index: 1, onset: 8, duration: 2, pitch: 'F4', x: 420, source: 'printed', confidence: 0.99 },
    ],
    harmonization: [
      { index: 0, system_index: 0, onset: 0, duration: 4, bass: 'F2', roman: 'I', x: 180, source: 'printed', confidence: 0.95 },
      { index: 1, system_index: 0, onset: 4, duration: 2, bass: 'G2', roman: 'ii6', x: 380, source: 'handwritten', confidence: 0.65 },
      { index: 2, system_index: 1, onset: 6, duration: 2, bass: 'C3', roman: 'V', x: 240, source: 'handwritten', confidence: 0.9 },
      { index: 3, system_index: 1, onset: 8, duration: 2, bass: 'F2', roman: 'I', x: 420, source: 'handwritten', confidence: 0.92 },
    ],
    phrases: [
      { name: 'Phrase 1', end_onset: 4, cadence: 'HC', passed: false },
      { name: 'Phrase 2', end_onset: 8, cadence: 'PAC', passed: true },
    ],
    issues: [
      {
        id: 'mel-clash',
        code: 'MELODY_HARMONY_CLASH',
        severity: 'error',
        message: 'Melody Bb4 clashes with harmony',
        noteIndex: 2,
        chordIndex: 1,
        voices: ['S', 'B'],
      },
    ],
  });

  assert.equal(layout.markers.length, 9); // 5 melody + 4 bass
  assert.equal(layout.nctBadges.length, 1);
  assert.equal(layout.nctBadges[0].label, 'PT');
  assert.equal(layout.nctBadges[0].x, 380);

  // Given region snaps cleanly to the barline at x=310 between onset 2 (x=260) and onset 4 (x=380)!
  assert.ok(layout.givenRegion);
  assert.equal(layout.givenRegion.rects.length, 1);
  assert.equal(layout.givenRegion.divider.x, 310);
  assert.equal(layout.givenRegion.divider.systemIndex, 0);
  assert.equal(layout.givenRegion.divider.label, 'Grade starts here →');

  // Cadence badges (HC ✕ and PAC ✓)
  assert.equal(layout.cadenceBadges.length, 2);
  assert.equal(layout.cadenceBadges[0].label, 'HC ✕');
  assert.equal(layout.cadenceBadges[0].passed, false);
  assert.equal(layout.cadenceBadges[1].label, 'PAC ✓');
  assert.equal(layout.cadenceBadges[1].passed, true);
  assert.equal(layout.cadenceBadges[1].systemIndex, 1);

  // Issue halo targets melody-2 AND connects to bass-1
  assert.equal(layout.issueOverlays.length, 1);
  const clash = layout.issueOverlays[0];
  assert.ok(clash.halos.some(h => h.noteId === 'melody-2'));
  assert.ok(clash.halos.some(h => h.noteId === 'bass-1'));
  assert.equal(clash.arcs.length, 1);
});

// ---------------------------------------------------------------------------
// 7. DOM-free SVG rendering, pointer drag, pill clicks, multi-system playhead, issue focus
// ---------------------------------------------------------------------------

function makeFakeSvgDom(rectWidth = 1000, rectHeight = 500) {
  class FakeNode {
    constructor(tag) {
      this.tagName = tag;
      this.attributes = new Map();
      this.children = [];
      this.listeners = new Map();
      this.textContent = '';
      this._classes = new Set();
      this.classList = {
        add: (...cls) => {
          cls.forEach(c => this._classes.add(c));
          this.attributes.set('class', [...this._classes].join(' '));
        },
        remove: (...cls) => {
          cls.forEach(c => this._classes.delete(c));
          this.attributes.set('class', [...this._classes].join(' '));
        },
        contains: c => this._classes.has(c),
      };
    }
    setAttribute(k, v) {
      this.attributes.set(k, String(v));
      if (k === 'class') this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatch(type, event = {}) {
      for (const fn of this.listeners.get(type) || []) fn(event);
    }
    querySelectorAll(selector) {
      const results = [];
      const visit = node => {
        for (const child of node.children) {
          if (matches(child, selector)) results.push(child);
          visit(child);
        }
      };
      visit(this);
      return results;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const matches = (node, selector) => {
    if (selector.startsWith('.')) return node._classes.has(selector.slice(1));
    return node.tagName === selector;
  };
  const ownerDocument = { createElementNS: (_ns, tag) => new FakeNode(tag) };
  const svg = new FakeNode('svg');
  svg.ownerDocument = ownerDocument;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: rectWidth, height: rectHeight });
  return svg;
}

test('renderWorksheetCanvas wires click, drag-to-adjust pitch, staff placement, pill clicks, multi-system playhead, and issue focus', () => {
  const svg = makeFakeSvgDom(1000, 500);
  let selectedNote = null;
  let movedMarker = null;
  let staffClick = null;
  let metaSelect = null;

  const systems = [
    {
      index: 0,
      treble: { lines: makeLines(60, 10), left: 60, right: 940, space: 10 }, // top=60, bottom=100 (E4)
      bass: { lines: makeLines(140, 10), left: 60, right: 940, space: 10 },  // top=140, bottom=180 (G2)
    },
    {
      index: 1,
      treble: { lines: makeLines(280, 10), left: 60, right: 940, space: 10 }, // top=280, bottom=320 (E4)
      bass: { lines: makeLines(360, 10), left: 60, right: 940, space: 10 },   // top=360, bottom=400 (G2)
    },
  ];

  const layout = renderWorksheetCanvas(svg, {
    mode: 'four-part',
    width: 1000,
    height: 500,
    preview: 'data:image/png;base64,TEST',
    keySignature: 1, // G major (F#)
    systems,
    chords: [
      {
        index: 0,
        system_index: 0,
        onset: 0,
        duration: 1,
        x: 220,
        voices: { S: 'G4', A: 'D4', T: 'B3', B: 'G2' },
        roman: 'I',
        figure: '5/3',
      },
      {
        index: 1,
        system_index: 1,
        onset: 1,
        duration: 1,
        x: 340,
        voices: { S: 'A4', A: 'F#4', T: 'C4', B: 'D3' },
        roman: 'V',
        figure: '7',
      },
    ],
    issues: [
      { id: 'err-1', issueIndex: 0, code: 'PARALLEL_5TH', severity: 'error', chordIndices: [0, 1], voices: ['S', 'B'] },
    ],
  }, {
    onSelectNote: info => { selectedNote = info; },
    onMoveMarker: info => { movedMarker = info; },
    onStaffClick: info => { staffClick = info; },
    onSelectColumnMeta: info => { metaSelect = info; },
  });

  assert.equal(svg.getAttribute('viewBox'), '0 0 1000 500');
  assert.equal(svg.querySelector('image').getAttribute('href'), 'data:image/png;base64,TEST');
  assert.equal(layout.markers.length, 8);

  // 1. Click a voice marker -> triggers onSelectNote
  const markers = svg.querySelectorAll('.ws-marker');
  const s0Marker = markers.find(m => m.getAttribute('data-note-id') === 'note-0-S');
  assert.ok(s0Marker);
  s0Marker.dispatch('click', { stopPropagation() {} });
  assert.equal(selectedNote.noteId, 'note-0-S');
  assert.equal(selectedNote.chordIndex, 0);
  assert.equal(selectedNote.voice, 'S');
  assert.equal(selectedNote.spell, 'G4');

  // 2. Vertical drag of S0 marker from G4 (y=90) up to F#5 (y=60) -> triggers onMoveMarker snapped to F#5!
  s0Marker.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 220, clientY: 90, stopPropagation() {} });
  s0Marker.dispatch('pointermove', { pointerId: 1, clientX: 220, clientY: 60.8, stopPropagation() {} });
  s0Marker.dispatch('pointerup', { pointerId: 1, clientX: 220, clientY: 60.8, stopPropagation() {} });
  assert.ok(movedMarker);
  assert.equal(movedMarker.chordIndex, 0);
  assert.equal(movedMarker.voice, 'S');
  assert.equal(movedMarker.spell, 'F#5'); // G major key sig applies F#!
  assert.equal(movedMarker.display, 'F♯5');
  assert.equal(movedMarker.y, 60);
  assert.equal(movedMarker.midi, 78);

  // 3. Click empty staff band on system 1 treble -> triggers onStaffClick snapped to nearest column & pitch
  const bands = svg.querySelectorAll('.ws-staff-band');
  const sys1Treble = bands.find(b => b.getAttribute('data-system-index') === '1' && b.getAttribute('data-staff') === 'treble');
  assert.ok(sys1Treble);
  // Click at top line of system 1 treble (y=280 -> F#5 in G major)
  sys1Treble.dispatch('click', { clientX: 350, clientY: 280 });
  assert.equal(staffClick.systemIndex, 1);
  assert.equal(staffClick.chordIndex, 1);
  assert.equal(staffClick.staff, 'treble');
  assert.equal(staffClick.spell, 'F#5');

  // 4. Click inline Roman numeral & Figured Bass pills -> triggers onSelectColumnMeta
  const romanPills = svg.querySelectorAll('.ws-roman-pill');
  const figPills = svg.querySelectorAll('.ws-figure-pill');
  assert.equal(romanPills.length, 2);
  assert.equal(figPills.length, 2);

  romanPills[1].dispatch('click', { stopPropagation() {} });
  assert.equal(metaSelect.chordIndex, 1);
  assert.equal(metaSelect.kind, 'roman');
  assert.equal(metaSelect.value, 'V');

  figPills[0].dispatch('click', { stopPropagation() {} });
  assert.equal(metaSelect.chordIndex, 0);
  assert.equal(metaSelect.kind, 'figure');
  assert.equal(metaSelect.value, '5/3');

  // 5. Multi-system playback playhead sweeps to system 0, then system 1, then hides
  highlightWorksheetActiveNotes(svg, [{ id: 'note-0-S' }, { id: 'note-0-B' }]);
  const playhead = svg.querySelector('.ws-playhead');
  assert.equal(playhead.getAttribute('visibility'), 'visible');
  assert.equal(Number(playhead.getAttribute('x1')), 220);
  assert.equal(Number(playhead.getAttribute('y1')), 50);  // sys0 treble[0] - space = 60 - 10
  assert.equal(Number(playhead.getAttribute('y2')), 190); // sys0 bass[4] + space = 180 + 10
  assert.equal(markers.filter(m => m.classList.contains('active')).length, 2);

  highlightWorksheetActiveNotes(svg, [{ chordIndex: 1, voice: 'S' }, { chordIndex: 1, voice: 'B' }]);
  assert.equal(Number(playhead.getAttribute('x1')), 340);
  assert.equal(Number(playhead.getAttribute('y1')), 270); // sys1 treble[0] - space = 280 - 10
  assert.equal(Number(playhead.getAttribute('y2')), 410); // sys1 bass[4] + space = 400 + 10
  assert.equal(markers.filter(m => m.classList.contains('active')).length, 2);

  highlightWorksheetActiveNotes(svg, []);
  assert.equal(playhead.getAttribute('visibility'), 'hidden');
  assert.equal(markers.filter(m => m.classList.contains('active')).length, 0);

  // 6. Issue focus spotlight & reset
  highlightWorksheetIssue(svg, { id: 'err-1' });
  assert.equal(svg.classList.contains('gs-has-focused-issue'), true);
  assert.equal(svg.querySelector('.ws-issue-group').classList.contains('gs-issue-focused'), true);
  assert.equal(markers.filter(m => m.classList.contains('ws-marker-issue-target')).length, 4);

  highlightWorksheetIssue(svg, null);
  assert.equal(svg.classList.contains('gs-has-focused-issue'), false);
  assert.equal(markers.filter(m => m.classList.contains('ws-marker-issue-target')).length, 0);
});
