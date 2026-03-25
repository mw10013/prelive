# Score Rendering Library Research

Date: 2026-03-24

Goal: find TypeScript/JavaScript libraries or local CLI-capable tools that can take either:

- a MIDI file
- a note/event list
- or a nearby interchange format we can generate from those inputs

and produce score output that can be rendered on a web page, ideally as SVG or another image-like format.

Companions:

- `docs/lilypond-score-research.md`

---

## Short answer

There is no obvious best-in-class JS library that takes arbitrary raw MIDI or piano-roll note events and directly engraves polished notation without a conversion step.

The ecosystem splits into two buckets:

1. **Direct notation renderers** that want score-oriented input such as MusicXML, ABC, MEI, alphaTex, or explicit notation objects.
2. **MIDI/event parsers** or editors that can import MIDI, but still need quantization + notation inference before engraving is good.

For this project, the most realistic options are:

- **`opensheetmusicdisplay`** if we can convert our data to **MusicXML** first.
- **`abcjs`** if we can convert our data to **ABC** and only need simpler notation.
- **`lilypond`** CLI if we want the best engraving quality and are OK doing server/local rendering.

---

## Best candidates

### 1. OpenSheetMusicDisplay

Best fit when we can generate **MusicXML** first and want a higher-level score renderer.

Key doc excerpts:

- OSMD site: "Responsive rendering of MusicXML in the browser"
- OSMD site: "Display and render MusicXML sheet music and guitar tabs in a browser(less) environment."
- DuckDuckGo/npm summary: "Outputs SVG or PNG, also via nodejs script in the command line, completely browserless"

What it accepts well:

- MusicXML `.xml` / `.mxl`
- browser rendering
- browserless / Node-style rendering for asset generation

What it does **not** give us:

- raw MIDI import in its core positioning/docs
- note-event-list input API

Takeaway:

- very good if pipeline is `MIDI or Note[] -> MusicXML -> OSMD`
- not a direct MIDI/event-list engraver

Sources:

- https://opensheetmusicdisplay.org/typescript-library/
- https://opensheetmusicdisplay.org/

---

### 2. abcjs

Best fit when we can generate **ABC notation** and want quick SVG rendering in-browser.

Key doc excerpts:

- abcjs docs: "The main entry point to draw standard music notation is `ABCJS.renderAbc`."
- abcjs docs: `renderAbc` is enough "to turn an arbitrary JavaScript string into an SVG image of sheet music."
- abcjs home: "ABC Music Notation is a format for specifying sheet music using only a string of characters."

What it accepts well:

- ABC strings
- browser rendering to SVG
- lightweight integration

What it does **not** give us:

- direct MIDI import
- rich notation coverage on par with MusicXML + heavier engravers
- ideal handling for dense polyphony / arbitrary DAW note timing

Takeaway:

- very attractive if our music is mostly single-line or moderate-complexity and we can convert to ABC
- likely simpler than MusicXML, but narrower

Related search result:

- `marmooo/midi2abc` appears to convert MIDI to ABC, which could be chained into abcjs, but it looks like a standalone project rather than a mainstream library foundation.

Sources:

- https://docs.abcjs.net/
- https://docs.abcjs.net/visual/overview
- https://github.com/marmooo/midi2abc

---

### 3. LilyPond CLI

Best fit when local/server-side rendering quality matters more than browser-native rendering.

Why it is still relevant:

- user said CLI is acceptable locally
- LilyPond gives the best engraving quality of the options we found

Repo research already captured the main shape:

- `docs/lilypond-score-research.md:35` says LilyPond is "not a JavaScript library — it's a standalone binary."
- `docs/lilypond-score-research.md:35` also says it outputs "PDF/SVG/PNG".

What it accepts well:

- LilyPond text input
- generated local assets, especially SVG/PDF/PNG

What it does **not** give us:

- direct browser-side rendering
- direct MIDI/event-list engraving without conversion

Takeaway:

- strongest CLI/local option
- pipeline is `MIDI or Note[] -> LilyPond text -> SVG/PNG`

Sources:

- https://lilypond.org/
- `docs/lilypond-score-research.md`

---

## Other notable options

### Verovio

Very good engraver, but not a direct MIDI renderer.

Key doc excerpts:

- Verovio home: "engraving Music Encoding Initiative (MEI) music scores into SVG"
- JS/WASM docs: install via `npm install verovio`
- input formats docs list **MEI, Humdrum, MusicXML, Plaine and Easie, ABC, CMME**

Important limitation:

- I found **no MIDI input support** in the documented input formats.

Takeaway:

- good if we convert to MusicXML/MEI/ABC first
- not direct from MIDI or raw note events

Sources:

- https://www.verovio.org/index.xhtml
- https://book.verovio.org/installing-or-building-from-sources/javascript-and-webassembly.html
- https://book.verovio.org/toolkit-reference/input-formats.html

---

### alphaTab

Interesting, but aimed more at guitar/tab ecosystems than general DAW-note-list engraving.

Key doc excerpts:

- alphaTab home: "Load music notation from formats like Guitar Pro 3-8, MusicXML, Capella or use the built-in text language alphaTex."
- alphaTab intro: importers exist for `gp3/gp4/gp5`, `gpx`, `gp`, `MusicXML`, `CapXML`, and `alphaTex`
- alphaTab renders "standard music notation, guitar tabs, drum tabs"

Important limitation:

- docs do **not** list MIDI as an importer

Takeaway:

- useful if we choose MusicXML or alphaTex as our intermediate format
- not a raw MIDI/event-list score-image library

Sources:

- https://alphatab.net/
- https://alphatab.net/docs/introduction
- https://alphatab.net/docs/reference/settings

---

### Smoosic

Promising if we want a fuller notation application/library, not just a renderer.

Key doc excerpts:

- Smoosic says it is a "music notation application that runs in a web browser"
- feature list includes "MIDI and MusicXML import and export"
- it is "highly dependent on the Vexflow engraving library"

Takeaway:

- one of the few web-side projects I found explicitly claiming MIDI import
- likely heavier than we need if the goal is just render a score image from our own data
- worth a spike only if direct MIDI import matters a lot

Sources:

- https://smoosic.github.io/Smoosic/
- https://github.com/Smoosic/Smoosic

---

### music21j

More musicology toolkit than turnkey score renderer.

Search/docs summary:

- music21j is a "Javascript reinterpretation of the Music21 Python package"
- it can "visualize ... Streams quickly (using Vexflow and MIDI.js)"

Takeaway:

- potentially useful for analysis/transformation layers
- not the clearest direct path to `MIDI or Note[] -> score image on page`

Sources:

- https://github.com/cuthbertLab/music21j
- https://www.npmjs.com/package/music21j

---

## Conversion-layer libraries worth noting

These are not renderers, but useful if we choose a score-format pipeline.

### musicxml-io

DuckDuckGo/npm summary says:

- "Parse and serialize MusicXML (.xml/.mxl) and ABC notation with high round-trip fidelity"

Takeaway:

- useful if we want to generate MusicXML or ABC from our own domain model before handing off to OSMD / Verovio / abcjs

Source:

- https://github.com/tan-z-tan/musicxml-io

---

### MIDI-to-ABC adapters

Search surfaced:

- `marmooo/midi2abc`

Takeaway:

- could be useful as reference code for quantization and ABC emission
- does not look like the main platform choice itself

Source:

- https://github.com/marmooo/midi2abc

---

## Recommendation matrix

| Need                                             | Best option               |
| ------------------------------------------------ | ------------------------- |
| Raw `Note[]` in app, render on page (server OK)   | **LilyPond**              |
| Best browser renderer if we can emit MusicXML    | **OpenSheetMusicDisplay** |
| Lightweight browser SVG from text notation       | **abcjs**                 |
| Best final engraving quality via local CLI       | **LilyPond**              |
| Try explicit MIDI import in a web notation app   | **Smoosic**               |
| MEI/MusicXML/ABC engraver via JS/WASM            | **Verovio**               |

---

## Practical recommendation for this repo

Given the LilyPond pipeline already in the repo, I would rank the paths like this:

1. **LilyPond CLI first**
   - best engraving quality
   - reliable for complex rhythms and polyphony
   - server/local asset generation

2. **MusicXML pipeline second**
   - generate MusicXML from our note data
   - render with **OSMD** or **Verovio**
   - better interoperability

3. **abcjs third**
   - good for quick client-side previews
   - simpler notation constraints

Main caveat across all options:

- converting MIDI or raw note events into readable notation is the hard part, not drawing the notation once structure exists.
