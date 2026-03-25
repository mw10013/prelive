import type { Note } from "@/lib/Domain";

import { quantizeNotes } from "@/lib/lilypond/midi";

interface LilyPondOptions {
  readonly tempo: number;
  readonly timeSignature: readonly [number, number];
  readonly gridSize: number;
}

interface Event {
  readonly start: number;
  readonly duration: number;
  readonly pitches: readonly number[];
}

interface VoiceLine {
  readonly events: readonly Event[];
}

const defaultOptions: LilyPondOptions = {
  tempo: 120,
  timeSignature: [4, 4],
  gridSize: 1 / 16,
};

const noteNames = [
  "c",
  "cis",
  "d",
  "dis",
  "e",
  "f",
  "fis",
  "g",
  "gis",
  "a",
  "ais",
  "b",
];

const durationTable = [
  { beats: 4, token: "1" },
  { beats: 3, token: "2." },
  { beats: 2, token: "2" },
  { beats: 1.5, token: "4." },
  { beats: 1, token: "4" },
  { beats: 0.75, token: "8." },
  { beats: 0.5, token: "8" },
  { beats: 0.375, token: "16." },
  { beats: 0.25, token: "16" },
  { beats: 0.1875, token: "32." },
  { beats: 0.125, token: "32" },
  { beats: 0.093_75, token: "64." },
  { beats: 0.0625, token: "64" },
  { beats: 0.046_875, token: "128." },
  { beats: 0.031_25, token: "128" },
];

const epsilon = 1e-6;

const roundToGrid = (value: number, gridSize: number): number =>
  Math.round(value / gridSize) * gridSize;

const pitchToLily = (pitch: number): string => {
  const octave = Math.floor(pitch / 12) - 1;
  const name = noteNames[pitch % 12] ?? "c";
  const marks = octave - 3;
  if (marks > 0) return name + "'".repeat(marks);
  if (marks < 0) return name + ",".repeat(-marks);
  return name;
};

const splitDuration = (beats: number): readonly string[] => {
  const tokens: string[] = [];
  let remaining = beats;
  for (const { beats: value, token } of durationTable) {
    while (remaining + epsilon >= value) {
      tokens.push(token);
      remaining = roundToGrid(remaining - value, 1 / 1024);
    }
    if (remaining <= epsilon) break;
  }
  return tokens.length > 0 ? tokens : ["64"];
};

const formatChord = (pitches: readonly number[], tie: boolean): string => {
  if (pitches.length === 1) {
    const pitch = pitches[0];
    return `${pitchToLily(pitch)}${tie ? "~" : ""}`;
  }
  const parts = pitches.map((pitch) => pitchToLily(pitch));
  return `<${parts.join(" ")}>${tie ? "~" : ""}`;
};

const buildEvents = (
  notes: readonly Note[],
  gridSize: number,
): readonly Event[] => {
  const quantized = quantizeNotes(notes, gridSize);
  const grouped = new Map<string, { start: number; duration: number; pitches: number[] }>();
  for (const note of quantized) {
    const start = roundToGrid(note.start_time, gridSize);
    const duration = roundToGrid(note.duration, gridSize);
    const key = `${String(start)}:${String(duration)}`;
    const entry = grouped.get(key) ?? { start, duration, pitches: [] };
    entry.pitches.push(note.pitch);
    grouped.set(key, entry);
  }
  const events: Event[] = [];
  for (const entry of grouped.values()) {
    // oxlint-disable-next-line unicorn/no-array-sort
    const pitches = [...new Set(entry.pitches)].sort((a, b) => a - b);
    events.push({ start: entry.start, duration: entry.duration, pitches });
  }
  return events;
};

const assignVoices = (events: readonly Event[]): readonly VoiceLine[] => {
  // oxlint-disable-next-line unicorn/no-array-sort
  const sorted = [...events].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const maxA = Math.max(...a.pitches);
    const maxB = Math.max(...b.pitches);
    if (maxA !== maxB) return maxB - maxA;
    return b.duration - a.duration;
  });
  const voices: { end: number; events: Event[] }[] = [];
  for (const event of sorted) {
    let placed = false;
    for (const voice of voices) {
      if (event.start >= voice.end - epsilon) {
        voice.events.push(event);
        voice.end = event.start + event.duration;
        placed = true;
        break;
      }
    }
    if (!placed) {
      voices.push({ end: event.start + event.duration, events: [event] });
    }
  }
  return voices.map((voice) => ({ events: voice.events }));
};

const tokensForDuration = (
  duration: number,
  pitches: readonly number[],
): readonly string[] => {
  const parts = splitDuration(duration);
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const tie = i < parts.length - 1;
    const chord = pitches.length > 0 ? formatChord(pitches, tie) : "r";
    tokens.push(`${chord}${parts[i]}`);
  }
  return tokens;
};

const voiceToTokens = (
  events: readonly Event[],
  totalEnd: number,
): readonly string[] => {
  const tokens: string[] = [];
  let cursor = 0;
  for (const event of events) {
    if (event.start > cursor + epsilon) {
      const restDuration = event.start - cursor;
      tokens.push(...tokensForDuration(restDuration, []));
    }
    tokens.push(...tokensForDuration(event.duration, event.pitches));
    cursor = event.start + event.duration;
  }
  if (cursor + epsilon < totalEnd) {
    tokens.push(...tokensForDuration(totalEnd - cursor, []));
  }
  return tokens;
};

export const notesToLilyPond = (
  notes: readonly Note[],
  options?: Partial<LilyPondOptions>,
): string => {
  const config: LilyPondOptions = { ...defaultOptions, ...options };
  const [numerator, denominator] = config.timeSignature;
  const measureLength = numerator * (4 / denominator);
  const events = buildEvents(notes, config.gridSize);
  const totalEnd = Math.max(
    0,
    ...events.map((event) => event.start + event.duration),
  );
  const roundedEnd = roundToGrid(
    Math.ceil(totalEnd / measureLength) * measureLength,
    config.gridSize,
  );
  const voices = assignVoices(events);
  const voiceTokens = voices.map((voice) =>
    voiceToTokens(voice.events, roundedEnd).join(" "),
  );
  const voiceCommands = [
    String.raw`\voiceOne`,
    String.raw`\voiceTwo`,
    String.raw`\voiceThree`,
    String.raw`\voiceFour`,
  ];
  const body = voiceTokens.length > 1
    ? `<< ${voiceTokens
      .map((line, index) => {
        const command = voiceCommands[index] ?? String.raw`\voiceOne`;
        return `{ ${command} ${line} }`;
      })
      .join(String.raw` \\ `)} >>`
    : (voiceTokens[0] ?? "r1");
  return [
    String.raw`\version "2.24.4"`,
    "",
    String.raw`\score {`,
    String.raw`  \new Staff {`,
    String.raw`    \clef treble`,
    String.raw`    \time ${String(numerator)}/${String(denominator)}`,
    String.raw`    \tempo 4 = ${String(config.tempo)}`,
    String.raw`    \set Score.proportionalNotationDuration = #1/16`,
    String.raw`    \override Score.SpacingSpanner.strict-note-spacing = ##t`,
    `    ${body}`,
    "  }",
    String.raw`  \layout {}`,
    String.raw`  \midi {}`,
    "}",
  ].join("\n");
};
