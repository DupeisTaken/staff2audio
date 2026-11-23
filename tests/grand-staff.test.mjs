import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePitchDisplay,
  staffYPosition,
  pitchFromStaffY,
  keySignatureAccidentals,
  computeGrandStaffLayout,
  renderGrandStaff,
  highlightActiveNotes,
  highlightIssue,
} from '../static/grand-staff.js';

// ---------------------------------------------------------------------------
// parsePitchDisplay
// ---------------------------------------------------------------------------

test('parsePitchDisplay parses ASCII and Unicode accidentals into exact diatonic step and MIDI', () => {
  assert.deepEqual(parsePitchDisplay('F#4'), {
    letter: 'F', alteration: 1, octave: 4, diatonicStep: 31, midi: 66, display: 'F♯4',
  });
  assert.deepEqual(parsePitchDisplay('Bb3'), {
    letter: 'B', alteration: -1, octave: 3, diatonicStep: 27, midi: 58, display: 'B♭3',
  });
  assert.deepEqual(parsePitchDisplay('C4'), {
    letter: 'C', alteration: 0, octave: 4, diatonicStep: 28, midi: 60, display: 'C4',
  });
  assert.deepEqual(parsePitchDisplay('Ebb4'), {
    letter: 'E', alteration: -2, octave: 4, diatonicStep: 30, midi: 62, display: 'E𝄫4',
  });
  assert.deepEqual(parsePitchDisplay('G♯3'), {
    letter: 'G', alteration: 1, octave: 3, diatonicStep: 25, midi: 56, display: 'G♯3',
  });
  assert.deepEqual(parsePitchDisplay('F𝄪4'), {
    letter: 'F', alteration: 2, octave: 4, diatonicStep: 31, midi: 67, display: 'F𝄪4',
  });
  assert.equal(parsePitchDisplay('Rest'), null);
  assert.equal(parsePitchDisplay(null), null);
  assert.equal(parsePitchDisplay('invalid'), null);
});

// ---------------------------------------------------------------------------
// staffYPosition & pitchFromStaffY
// ---------------------------------------------------------------------------

test('staffYPosition computes exact Y coordinates and ledger lines for treble, bass, and middle C4', () => {
  const topY = 50;
  const sp = 10;

  // Treble E4 (bottom line = topY + 4*sp = 90) through F5 (top line = 50)
  const e4 = staffYPosition('E', 4, 'treble', topY, sp);
  assert.equal(e4.y, 90);
  assert.equal(e4.staffStep, 0);
  assert.deepEqual(e4.ledgerLines, []);

  const f5 = staffYPosition('F', 5, 'treble', topY, sp);
  assert.equal(f5.y, 50);
  assert.equal(f5.staffStep, 8);
  assert.deepEqual(f5.ledgerLines, []);

  // D4 sits immediately below E4 -> 0 ledger lines
  assert.deepEqual(staffYPosition('D', 4, 'treble', topY, sp).ledgerLines, []);

  // Middle C4 below treble -> 1 ledger line at 100
  const trebleC4 = staffYPosition('C', 4, 'treble', topY, sp);
  assert.equal(trebleC4.y, 100);
  assert.deepEqual(trebleC4.ledgerLines, [100]);

  // A3 below treble -> 2 ledger lines (C4 at 100, A3 at 110)
  assert.deepEqual(staffYPosition('A', 3, 'treble', topY, sp).ledgerLines, [100, 110]);

  // A5 above treble -> 1 ledger line at 40
  assert.deepEqual(staffYPosition('A', 5, 'treble', topY, sp).ledgerLines, [40]);

  // Bass G2 (bottom line = 90) through A3 (top line = 50)
  const g2 = staffYPosition('G', 2, 'bass', topY, sp);
  assert.equal(g2.y, 90);
  assert.deepEqual(g2.ledgerLines, []);

  const a3 = staffYPosition('A', 3, 'bass', topY, sp);
  assert.equal(a3.y, 50);
  assert.deepEqual(a3.ledgerLines, []);

  // Middle C4 above bass -> 1 ledger line at 40
  const bassC4 = staffYPosition('C', 4, 'bass', topY, sp);
  assert.equal(bassC4.y, 40);
  assert.deepEqual(bassC4.ledgerLines, [40]);

  // E4 above bass -> 2 ledger lines (C4 at 40, E4 at 30)
  assert.deepEqual(staffYPosition('E', 4, 'bass', topY, sp).ledgerLines, [40, 30]);

  // E2 below bass -> 1 ledger line at 100
  assert.deepEqual(staffYPosition('E', 2, 'bass', topY, sp).ledgerLines, [100]);

  // Inverse snapping applies active key signature
  const snappedFSharp = pitchFromStaffY(50, 'treble', topY, sp, 1); // F5 in G major
  assert.equal(snappedFSharp.spell, 'F#5');
  assert.equal(snappedFSharp.midi, 78);

  const snappedBFlat = pitchFromStaffY(80, 'bass', topY, sp, -2); // B2 in Bb major
  assert.equal(snappedBFlat.spell, 'Bb2');
  assert.equal(snappedBFlat.midi, 46);
});

// ---------------------------------------------------------------------------
// keySignatureAccidentals (-7..+7 on treble & bass)
// ---------------------------------------------------------------------------

test('keySignatureAccidentals matches standard engraving order and octaves for all 15 keys on treble and bass', () => {
  const trebleSharps = ['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4'];
  const bassSharps = ['F3', 'C3', 'G3', 'D3', 'A2', 'E3', 'B2'];
  const trebleFlats = ['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4'];
  const bassFlats = ['B2', 'E3', 'A2', 'D3', 'G2', 'C3', 'F2'];

  assert.deepEqual(keySignatureAccidentals(0, 'treble'), []);
  assert.deepEqual(keySignatureAccidentals(0, 'bass'), []);

  for (let k = 1; k <= 7; k++) {
    const ts = keySignatureAccidentals(k, 'treble');
    const bs = keySignatureAccidentals(k, 'bass');
    assert.deepEqual(ts.map(a => `${a.letter}${a.octave}`), trebleSharps.slice(0, k));
    assert.deepEqual(bs.map(a => `${a.letter}${a.octave}`), bassSharps.slice(0, k));
    assert.ok(ts.every(a => a.symbol === '♯'));
    assert.ok(bs.every(a => a.symbol === '♯'));

    const tf = keySignatureAccidentals(-k, 'treble');
    const bf = keySignatureAccidentals(-k, 'bass');
    assert.deepEqual(tf.map(a => `${a.letter}${a.octave}`), trebleFlats.slice(0, k));
    assert.deepEqual(bf.map(a => `${a.letter}${a.octave}`), bassFlats.slice(0, k));
    assert.ok(tf.every(a => a.symbol === '♭'));
    assert.ok(bf.every(a => a.symbol === '♭'));
  }
});

// ---------------------------------------------------------------------------
// computeGrandStaffLayout: 2nd-interval offsets, accidentals, barlines, errors, melody mode
// ---------------------------------------------------------------------------

test('computeGrandStaffLayout offsets 2nd intervals, avoids accidental collisions, and enforces SATB stem directions', () => {
  const layout = computeGrandStaffLayout({
    mode: 'four-part',
    keySignature: 1, // G major (F#)
    timeSignature: '4/4',
    chords: [
      // Chord 0: S=E5, A=D5 (2nd apart!), T=C#4, B=B3 (2nd apart!) + close accidentals C#4 and B#3/Bb3
      { onset: 0, duration: 1, roman: 'I', figuredBass: '6', voices: { S: 'E5', A: 'D5', T: 'C#4', B: 'Bb3' } },
      // Chord 1: S=G5, A=B4 (wide 6th -> no offset), F#4 in key (no accidental), F4 natural (needs natural!)
      { onset: 1, duration: 1, roman: 'V', figuredBass: ['6', '5'], voices: { S: 'G5', A: 'F4', T: 'D4', B: 'G2' } },
      // Chord 2: same measure F4 -> inherits natural (no redundant accidental)
      { onset: 2, duration: 2, roman: 'I', voices: { S: 'G5', A: 'F4', T: 'D4', B: 'G2' } },
      // Chord 3: Measure 2 (onset 4) -> barline between beat 0..3 and beat 4; F#4 needs no accidental (key restored)
      { onset: 4, duration: 4, roman: 'I', voices: { S: 'G5', A: 'F#4', T: 'D4', B: 'G2' } },
    ],
  });

  // Barlines: 1 single barline at beat 4 + 1 final double barline
  const singles = layout.barlines.filter(b => b.type === 'single');
  assert.equal(singles.length, 1);
  assert.equal(singles[0].beat, 4);
  assert.equal(layout.barlines.at(-1).type, 'final');

  // Chord 0 second-interval offsets on BOTH treble (S/A) and bass (T/B)
  const c0S = layout.notes.find(n => n.chordIndex === 0 && n.voice === 'S');
  const c0A = layout.notes.find(n => n.chordIndex === 0 && n.voice === 'A');
  const c0T = layout.notes.find(n => n.chordIndex === 0 && n.voice === 'T');
  const c0B = layout.notes.find(n => n.chordIndex === 0 && n.voice === 'B');
  assert.equal(c0S.offsetX, 0);
  assert.ok(c0A.offsetX > 0 && c0A.x > c0S.x);
  assert.equal(c0T.offsetX, 0);
  assert.ok(c0B.offsetX > 0 && c0B.x > c0T.x);

  // Close accidentals on bass (C#4 and Bb3 are only 1 step apart) must not collide horizontally!
  assert.ok(c0T.accidental && c0B.accidental);
  assert.notEqual(c0T.accidental.x, c0B.accidental.x);

  // Chord 1 wider interval -> no offset
  const c1S = layout.notes.find(n => n.chordIndex === 1 && n.voice === 'S');
  const c1A = layout.notes.find(n => n.chordIndex === 1 && n.voice === 'A');
  assert.equal(c1S.offsetX, 0);
  assert.equal(c1A.offsetX, 0);
  assert.equal(c1A.accidental.symbol, '♮'); // Cancels F# from G major key sig

  // Chord 2 inherits F4 natural in same measure -> no redundant accidental; half note is hollow
  const c2A = layout.notes.find(n => n.chordIndex === 2 && n.voice === 'A');
  assert.equal(c2A.accidental, null);
  assert.equal(c2A.filled, false);
  assert.ok(c2A.stem);

  // Chord 3 in measure 2 restores F# from key -> no accidental; whole note has no stem
  const c3A = layout.notes.find(n => n.chordIndex === 3 && n.voice === 'A');
  assert.equal(c3A.accidental, null);
  assert.equal(c3A.filled, false);
  assert.equal(c3A.stem, null);

  // Stem directions: S up, A down, T up, B down
  assert.equal(c0S.stem.dir, 'up');
  assert.equal(c0A.stem.dir, 'down');
  assert.equal(c0T.stem.dir, 'up');
  assert.equal(c0B.stem.dir, 'down');
});

test('computeGrandStaffLayout generates error arcs, halos, and melody-harmonize features (NCTs, ghost SATB, phrases)', () => {
  const fourPart = computeGrandStaffLayout({
    mode: 'four-part',
    chords: [
      { onset: 0, duration: 1, voices: { S: 'G4', A: 'E4', T: 'C4', B: 'C3' } },
      { onset: 1, duration: 1, voices: { S: 'A4', A: 'F4', T: 'D4', B: 'D3' } },
    ],
    issues: [
      { id: 'p5', code: 'PARALLEL_5TH', severity: 'error', chordIndices: [0, 1], voices: ['S', 'B'], message: 'Parallel 5ths S-B' },
      { id: 'sp', code: 'SPACING', severity: 'warning', chordIndex: 1, voices: ['A', 'T'], message: 'Spacing' },
    ],
  });

  assert.equal(fourPart.issueOverlays.length, 2);
  const p5 = fourPart.issueOverlays[0];
  assert.equal(p5.arcs.length, 2); // One arc for S, one for B
  assert.equal(p5.halos.length, 4); // 2 chords x 2 voices
  assert.match(p5.arcs[0].path, /^M .+ Q .+ .+$/);

  const sp = fourPart.issueOverlays[1];
  assert.equal(sp.halos.length, 2);
  assert.equal(sp.arcs.length, 1);

  // Melody harmonization mode
  const melLayout = computeGrandStaffLayout({
    mode: 'melody-harmonize',
    keySignature: 0,
    timeSignature: '3/4',
    showSatbPreview: true,
    melody: [
      { onset: 0, duration: 1, spell: 'C5' },
      { onset: 1, duration: 0.5, spell: 'D5', nct: 'PT' },
      { onset: 1.5, duration: 0.5, spell: 'E5' },
      { onset: 2, duration: 1, spell: 'D5' },
      { onset: 3, duration: 3, spell: 'C5' },
    ],
    harmonization: [
      { onset: 0, duration: 2, bass: 'C3', roman: 'I' },
      { onset: 2, duration: 1, bass: 'G2', roman: 'V' },
      { onset: 3, duration: 3, bass: 'C3', roman: 'I', cadence: 'PAC' },
    ],
    satbPreview: [
      { onset: 0, duration: 2, voices: { A: 'E4', T: 'G3' } },
      { onset: 2, duration: 1, voices: { A: 'F4', T: 'B3' } },
      { onset: 3, duration: 3, voices: { A: 'E4', T: 'G3' } },
    ],
    phrases: [{ startIndex: 0, endIndex: 2, label: 'Phrase 1', cadence: 'PAC' }],
  });

  assert.equal(melLayout.barlines.filter(b => b.type === 'single').length, 1); // 3/4 barline at beat 3
  assert.equal(melLayout.notes.filter(n => n.voice === 'S').length, 5);
  assert.equal(melLayout.notes.filter(n => n.ghost).length, 6); // 3 chords x (A + T)
  const ptNote = melLayout.notes.find(n => n.nct === 'PT');
  assert.ok(ptNote);
  assert.equal(ptNote.flags, 1); // Eighth note gets 1 flag
  const dottedHalf = melLayout.notes.find(n => n.onset === 3 && n.voice === 'S');
  assert.equal(dottedHalf.filled, false);
  assert.equal(dottedHalf.dotted, true);
  assert.equal(melLayout.phrases.length, 1);
  assert.equal(melLayout.phrases[0].cadence, 'PAC');
});

// ---------------------------------------------------------------------------
// renderGrandStaff, highlightActiveNotes, highlightIssue with minimal fake SVG DOM
// ---------------------------------------------------------------------------

function makeFakeSvgDom() {
  class FakeNode {
    constructor(tag) {
      this.tagName = tag;
      this.attributes = new Map();
      this.children = [];
      this.listeners = new Map();
      this.textContent = '';
      this._classes = new Set();
      this.classList = {
        add: (...cls) => { cls.forEach(c => this._classes.add(c)); this.attributes.set('class', [...this._classes].join(' ')); },
        remove: (...cls) => { cls.forEach(c => this._classes.delete(c)); this.attributes.set('class', [...this._classes].join(' ')); },
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
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    dispatch(type, event = {}) { this.listeners.get(type)?.(event); }
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
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 280 });
  return svg;
}

test('renderGrandStaff wires click-to-select, click-to-place, active playback highlighting, and issue focus', () => {
  const svg = makeFakeSvgDom();
  let selected = null;
  let placed = null;

  const layout = renderGrandStaff(svg, {
    mode: 'four-part',
    keySignature: 1,
    chords: [
      { onset: 0, duration: 1, roman: 'I', voices: { S: 'G4', A: 'D4', T: 'B3', B: 'G2' } },
      { onset: 1, duration: 1, roman: 'V', voices: { S: 'A4', A: 'F#4', T: 'C4', B: 'D3' } },
    ],
    issues: [
      { id: 'issue-p5', code: 'PARALLEL_5TH', severity: 'error', chordIndices: [0, 1], voices: ['S', 'B'] },
    ],
  }, {
    onSelectNote: info => { selected = info; },
    onStaffClick: info => { placed = info; },
  });

  assert.equal(svg.getAttribute('viewBox'), `0 0 ${layout.width} ${layout.height}`);
  const noteNodes = svg.querySelectorAll('.gs-note');
  assert.equal(noteNodes.length, 8);

  // Clicking a note triggers onSelectNote
  noteNodes[0].dispatch('click', { stopPropagation() {} });
  assert.equal(selected.chordIndex, 0);
  assert.equal(selected.voice, 'S');
  assert.equal(selected.spell, 'G4');

  // Clicking a hit area on treble staff triggers onStaffClick with snapped diatonic pitch
  const hitAreas = svg.querySelectorAll('.gs-hit-area');
  const trebleCol0 = hitAreas.find(r => r.getAttribute('data-chord-index') === '0' && r.getAttribute('data-staff') === 'treble');
  assert.ok(trebleCol0);
  // Click at F5 line Y (layout.treble.topY) mapped to fake rect height 280
  const clientY = (layout.treble.topY / layout.height) * 280;
  trebleCol0.dispatch('click', { clientX: 120, clientY });
  assert.equal(placed.chordIndex, 0);
  assert.equal(placed.staff, 'treble');
  assert.equal(placed.spell, 'F#5'); // F5 with G-major key signature!

  // Active playback highlighting & playhead visibility
  highlightActiveNotes(svg, [{ chordIndex: 1, voice: 'S', midi: 69 }, { chordIndex: 1, voice: 'B', midi: 50 }]);
  const activeNodes = svg.querySelectorAll('.gs-note').filter(n => n.classList.contains('active'));
  assert.equal(activeNodes.length, 2);
  assert.equal(svg.querySelector('.gs-playhead').getAttribute('visibility'), 'visible');

  highlightActiveNotes(svg, []);
  assert.equal(svg.querySelector('.gs-playhead').getAttribute('visibility'), 'hidden');

  // Issue highlighting
  highlightIssue(svg, { id: 'issue-p5' });
  assert.equal(svg.classList.contains('gs-has-focused-issue'), true);
  assert.equal(svg.querySelector('.gs-issue-group').classList.contains('gs-issue-focused'), true);
  const targeted = svg.querySelectorAll('.gs-note').filter(n => n.classList.contains('gs-issue-target'));
  assert.equal(targeted.length, 4);

  highlightIssue(svg, null);
  assert.equal(svg.classList.contains('gs-has-focused-issue'), false);
});
