import midiWriter from "midi-writer-js";
const { NoteEvent, TimeSignatureEvent, Track, Writer } = midiWriter;
import type { Note } from "@/lib/Domain";

const midiToNoteName = (midi: number): string => {
  const notes = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const octave = Math.floor(midi / 12) - 1;
  const note = notes[midi % 12];
  return `${note}${String(octave)}`;
};

export const notesToMidiFile = (
  notes: readonly Note[],
  ticksPerBeat = 480,
): Uint8Array => {
  const track = new Track();
  track.setTempo(120);
  track.addEvent(new TimeSignatureEvent(4, 4, 24, 8));

  for (const note of notes) {
    track.addEvent(
      new NoteEvent({
        pitch: [midiToNoteName(note.pitch)],
        duration: `T${String(Math.round(note.duration * ticksPerBeat))}`,
        velocity: note.velocity,
        startTick: Math.round(note.start_time * ticksPerBeat),
      }),
    );
  }

  return new Writer(track, { ticksPerBeat }).buildFile();
};
