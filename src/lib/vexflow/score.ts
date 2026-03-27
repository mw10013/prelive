import type { Note } from "@/lib/Domain";

import { Effect } from "effect";

import { quantizeNotes } from "@/lib/lilypond/quantizer";

interface VexFlowOptions {
  readonly tempo: number;
  readonly timeSignature: readonly [number, number];
  readonly gridSize: number;
  readonly splitPoint: number;
  readonly quantization?: Parameters<typeof quantizeNotes>[1];
}

export interface VexFlowVoicePlan {
  readonly notes: readonly string[];
}

export interface VexFlowStaffPlan {
  readonly clef: "treble" | "bass";
  readonly voices: readonly VexFlowVoicePlan[];
}

export interface VexFlowPlan {
  readonly staves: readonly VexFlowStaffPlan[];
  readonly timeSignature: readonly [number, number];
  readonly tempo: number;
}

interface Event {
  readonly start: number;
  readonly duration: number;
  readonly pitches: readonly number[];
}

interface DurationToken {
  readonly beats: number;
  readonly duration: string;
  readonly dots: number;
}

const defaultOptions: VexFlowOptions = {
  tempo: 120,
  timeSignature: [4, 4],
  gridSize: 1 / 16,
  splitPoint: 60,
};

const durationTable: readonly DurationToken[] = [
  { beats: 4, duration: "w", dots: 0 },
  { beats: 3, duration: "h", dots: 1 },
  { beats: 2, duration: "h", dots: 0 },
  { beats: 1.5, duration: "q", dots: 1 },
  { beats: 1, duration: "q", dots: 0 },
  { beats: 0.75, duration: "8", dots: 1 },
  { beats: 0.5, duration: "8", dots: 0 },
  { beats: 0.375, duration: "16", dots: 1 },
  { beats: 0.25, duration: "16", dots: 0 },
  { beats: 0.1875, duration: "32", dots: 1 },
  { beats: 0.125, duration: "32", dots: 0 },
  { beats: 0.093_75, duration: "64", dots: 1 },
  { beats: 0.0625, duration: "64", dots: 0 },
];

const noteNames = [
  "c",
  "c#",
  "d",
  "d#",
  "e",
  "f",
  "f#",
  "g",
  "g#",
  "a",
  "a#",
  "b",
];

const epsilon = 1e-6;

const roundToGrid = (value: number, gridSize: number): number =>
  Math.round(value / gridSize) * gridSize;

const sortedUnique = (values: readonly number[]): readonly number[] => {
  const unique = [...new Set(values)];
  const result: number[] = [];
  for (const value of unique) {
    let inserted = false;
    for (let index = 0; index < result.length; index += 1) {
      if (value < (result[index] ?? value)) {
        result.splice(index, 0, value);
        inserted = true;
        break;
      }
    }
    if (!inserted) result.push(value);
  }
  return result;
};

const sortedBy = <T>(values: readonly T[], compare: (a: T, b: T) => number): readonly T[] => {
  const result: T[] = [];
  for (const value of values) {
    let inserted = false;
    for (let index = 0; index < result.length; index += 1) {
      const current = result[index];
      if (current !== undefined && compare(value, current) < 0) {
        result.splice(index, 0, value);
        inserted = true;
        break;
      }
    }
    if (!inserted) result.push(value);
  }
  return result;
};

const pitchToEasyScore = (pitch: number): string => {
  const octave = Math.floor(pitch / 12) - 1;
  const name = noteNames[pitch % 12] ?? "c";
  return `${name}${String(octave)}`;
};

const splitDuration = (beats: number): readonly DurationToken[] => {
  const tokens: DurationToken[] = [];
  let remaining = beats;
  for (const token of durationTable) {
    while (remaining + epsilon >= token.beats) {
      tokens.push(token);
      remaining = roundToGrid(remaining - token.beats, 1 / 1024);
    }
    if (remaining <= epsilon) break;
  }
  return tokens.length > 0
    ? tokens
    : [{ beats: 0.25, duration: "16", dots: 0 }];
};

const formatChord = (pitches: readonly number[]): string => {
  if (pitches.length === 1) return pitchToEasyScore(pitches[0] ?? 60);
  const parts = pitches.map((pitch) => pitchToEasyScore(pitch));
  return `(${parts.join(" ")})`;
};

const formatToken = (
  chord: string,
  token: DurationToken,
  isRest: boolean,
  stem?: "up" | "down",
): string => {
  const dots = ".".repeat(token.dots);
  const stemOption = stem ? `[stem="${stem}"]` : "";
  return isRest
    ? `${chord}/${token.duration}/r${dots}${stemOption}`
    : `${chord}/${token.duration}${dots}${stemOption}`;
};

const tokensForDuration = (
  duration: number,
  pitches: readonly number[],
  restKey: string,
  stem?: "up" | "down",
): readonly string[] => {
  const parts = splitDuration(duration);
  const chord = pitches.length > 0 ? formatChord(pitches) : restKey;
  return parts.map((part) => formatToken(chord, part, pitches.length === 0, stem));
};

const buildEvents = (notes: readonly Note[], gridSize: number): readonly Event[] => {
  const grouped = new Map<string, { start: number; duration: number; pitches: number[] }>();
  for (const note of notes) {
    const start = roundToGrid(note.start_time, gridSize);
    const duration = roundToGrid(note.duration, gridSize);
    const key = `${String(start)}:${String(duration)}`;
    const entry = grouped.get(key) ?? { start, duration, pitches: [] };
    entry.pitches.push(note.pitch);
    grouped.set(key, entry);
  }
  const events: Event[] = [];
  for (const entry of grouped.values()) {
    const pitches = sortedUnique(entry.pitches);
    events.push({ start: entry.start, duration: entry.duration, pitches });
  }
  return events;
};

const assignVoices = (events: readonly Event[]): readonly { readonly events: readonly Event[] }[] => {
  const sorted = sortedBy(events, (a, b) => {
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

const stemForPitches = (
  pitches: readonly number[],
  clef: "treble" | "bass",
): "up" | "down" => {
  const average = pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length;
  const middleLine = clef === "treble" ? 71 : 50;
  return average >= middleLine ? "down" : "up";
};

const voiceToTokens = (
  events: readonly Event[],
  totalEnd: number,
  restKey: string,
  clef: "treble" | "bass",
  useExplicitStems: boolean,
): readonly string[] => {
  const tokens: string[] = [];
  let cursor = 0;
  for (const event of events) {
    if (event.start > cursor + epsilon) {
      const restDuration = event.start - cursor;
      tokens.push(...tokensForDuration(restDuration, [], restKey));
    }
    const stem = useExplicitStems && event.pitches.length > 0
      ? stemForPitches(event.pitches, clef)
      : undefined;
    tokens.push(...tokensForDuration(event.duration, event.pitches, restKey, stem));
    cursor = event.start + event.duration;
  }
  if (cursor + epsilon < totalEnd) {
    tokens.push(...tokensForDuration(totalEnd - cursor, [], restKey));
  }
  return tokens;
};

const splitByClef = (
  events: readonly Event[],
  splitPoint: number,
): readonly { readonly clef: "treble" | "bass"; readonly events: readonly Event[] }[] => {
  const treble: Event[] = [];
  const bass: Event[] = [];
  for (const event of events) {
    const upper: number[] = [];
    const lower: number[] = [];
    for (const pitch of event.pitches) {
      if (pitch >= splitPoint) upper.push(pitch);
      else lower.push(pitch);
    }
    if (upper.length > 0) treble.push({ ...event, pitches: upper });
    if (lower.length > 0) bass.push({ ...event, pitches: lower });
  }
  const hasTreble = treble.length > 0;
  const hasBass = bass.length > 0;
  if (hasTreble && hasBass) return [{ clef: "treble", events: treble }, { clef: "bass", events: bass }];
  if (hasTreble) return [{ clef: "treble", events: treble }];
  if (hasBass) return [{ clef: "bass", events: bass }];
  return [];
};

export const buildVexFlowPlan = Effect.fn("VexFlowScore.buildVexFlowPlan")(
  (notes: readonly Note[], options?: Partial<VexFlowOptions>) =>
    Effect.gen(function* () {
      const config: VexFlowOptions = { ...defaultOptions, ...options };
      const quantized = yield* quantizeNotes(notes, config.quantization);
      const events = buildEvents(quantized, config.gridSize);
      const staves = splitByClef(events, config.splitPoint).map((staff) => {
        const voices = assignVoices(staff.events);
        const totalEnd = Math.max(0, ...staff.events.map((event) => event.start + event.duration));
        const restKey = staff.clef === "bass" ? "d3" : "b4";
        const useExplicitStems = voices.length === 1;
        const voicePlans = voices.map((voice) => ({
          notes: voiceToTokens(voice.events, totalEnd, restKey, staff.clef, useExplicitStems),
        }));
        return { clef: staff.clef, voices: voicePlans };
      });
      return { staves, timeSignature: config.timeSignature, tempo: config.tempo };
    }),
);
