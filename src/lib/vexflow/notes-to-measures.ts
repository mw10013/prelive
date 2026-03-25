import type { Note } from "@/lib/Domain";

import { beatsToDuration, beatsToRestDuration } from "./beats-to-duration";
import { midiToVexFlowKey } from "./midi-to-key";

export interface StaveDescriptor {
  keys: string[];
  duration: string; // already a VexFlow duration code like "q", "16r", etc.
}

export interface Measure {
  notes: StaveDescriptor[];
  index: number;
}

function quantizedDurationSplit(
  beats: number,
  isRest: boolean,
): StaveDescriptor[] {
  const descriptors: StaveDescriptor[] = [];
  let remaining = beats;
  while (remaining > 0.001) {
    const code = isRest
      ? beatsToRestDuration(remaining)
      : beatsToDuration(remaining);
    const codeBeats = durationToBeats(code.replace(/r$/, ""));
    if (isRest) {
      descriptors.push({ keys: ["b/4"], duration: code });
    } else {
      // caller fills in keys
      descriptors.push({ keys: [], duration: code });
    }
    remaining -= codeBeats;
  }
  return descriptors;
}

export function durationToBeats(code: string): number {
  const base: Record<string, number> = {
    w: 4,
    h: 2,
    q: 1,
    "8": 0.5,
    "16": 0.25,
    "32": 0.125,
    "64": 0.0625,
  };
  const stripped = code.replace(/[dr]$/, "");
  const dotted = stripped.endsWith("d");
  const core = dotted ? stripped.slice(0, -1) : stripped;
  const beats = base[core] ?? 1;
  return dotted ? beats * 1.5 : beats;
}

function buildMeasureNotes(
  groups: Map<number, Note[]>,
  measureStart: number,
  beatsPerMeasure: number,
): StaveDescriptor[] {
  const sortedStarts = [...groups.keys()].sort((a: number, b: number) => a - b);
  const notes: StaveDescriptor[] = [];
  let cursor = 0;

  for (const start of sortedStarts) {
    const groupNotes = groups.get(start);
    if (!groupNotes) continue;
    const relStart = start - measureStart;

    // Fill gap before this group with rests
    const gap = relStart - cursor;
    if (gap > 0.0625) {
      notes.push(...quantizedDurationSplit(gap, true));
    }

    // Get duration for this group
    const groupDuration = Math.max(...groupNotes.map((n) => n.duration));
    const isChord = groupNotes.length > 1;

    // Split duration if needed (for durations longer than a whole note)
    let remaining = groupDuration;
    while (remaining > 0.001) {
      const code = beatsToDuration(remaining);
      const codeBeats = durationToBeats(code);
      if (isChord) {
        const keys = groupNotes
          .sort((a, b) => a.pitch - b.pitch)
          .map((n) => midiToVexFlowKey(n.pitch));
        notes.push({ keys, duration: code });
      } else {
        notes.push({
          keys: [midiToVexFlowKey(groupNotes[0].pitch)],
          duration: code,
        });
      }
      remaining -= codeBeats;
    }

    cursor = relStart + groupDuration;
  }

  // Fill trailing gap with rests
  const trailing = beatsPerMeasure - cursor;
  if (trailing > 0.0625) {
    notes.push(...quantizedDurationSplit(trailing, true));
  }

  return notes;
}

export function notesToMeasures(
  notes: Note[],
  beatsPerMeasure: number,
): Measure[] {
  if (notes.length === 0) return [];

  const maxBeat = Math.max(...notes.map((n) => n.start_time + n.duration));
  const measureCount = Math.ceil(maxBeat / beatsPerMeasure);
  const measures: Measure[] = [];

  for (let m = 0; m < measureCount; m++) {
    const measureStart = m * beatsPerMeasure;
    const measureEnd = measureStart + beatsPerMeasure;

    const measureNotes = notes.filter(
      (n) => n.start_time >= measureStart && n.start_time < measureEnd,
    );

    if (measureNotes.length === 0) {
      // Full measure rest
      measures.push({
        notes: quantizedDurationSplit(beatsPerMeasure, true),
        index: m,
      });
      continue;
    }

    // Group simultaneous notes by start time
    const groups = new Map<number, Note[]>();
    for (const note of measureNotes) {
      const key = Math.round(note.start_time * 1000) / 1000;
      const existing = groups.get(key);
      if (existing) {
        existing.push(note);
      } else {
        groups.set(key, [note]);
      }
    }

    const measureNoteDescs = buildMeasureNotes(
      groups,
      measureStart,
      beatsPerMeasure,
    );
    measures.push({ notes: measureNoteDescs, index: m });
  }

  return measures;
}
