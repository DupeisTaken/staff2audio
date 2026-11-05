# Bundled acoustic grand piano

The 88 MP3 recordings (A0–C8) in `grand-piano.json` are the **FluidR3 GM Acoustic Grand Piano**, originally created by **Frank Wen**, rendered and distributed by **Benjamin Gleitzman** in [MIDI.js Soundfonts](https://github.com/gleitz/midi-js-soundfonts).

- Source: [acoustic_grand_piano-mp3.js at commit 044fab8e1456bfafc5776e86dfd6bb8697149aef](https://github.com/gleitz/midi-js-soundfonts/blob/044fab8e1456bfafc5776e86dfd6bb8697149aef/FluidR3_GM/acoustic_grand_piano-mp3.js).
- The [distributor's README](https://github.com/gleitz/midi-js-soundfonts/blob/044fab8e1456bfafc5776e86dfd6bb8697149aef/README.md) identifies the Fluid recordings as licensed under [Creative Commons Attribution 3.0 United States](https://creativecommons.org/licenses/by/3.0/us/). License terms: <https://creativecommons.org/licenses/by/3.0/us/legalcode>.
- The repository's MIT notice is preserved in `LICENSE-MIDI-JS.txt`.
- Original FluidR3 copyright and permission notice, preserved by the [PianoBooster Fluid Soundfont repository](https://github.com/pianobooster/fluid-soundfont/blob/main/COPYING), is included as `LICENSE-FLUIDR3.txt`.

Modification: only the acoustic grand instrument is included. Literal MP3 data was extracted into JSON without evaluating the upstream JavaScript; the recordings were not re-encoded. Playback applies gain envelopes and may change pitch. Exported WAV performances use these recordings. Retain this attribution when distributing the bundled samples or rendered performances. No endorsement by the original creators is implied.

Reproduce the bundle with `node tools/audio-bundle.mjs` from the repository root. This maintenance tool downloads the pinned source and verifies its SHA-256; the application makes no external audio requests at runtime.
