import { notesToMeasures } from "./src/lib/vexflow/notes-to-measures.ts";

const notes = [
  { note_id: 1, pitch: 72, start_time: 0, duration: 0.25, velocity: 100, mute: false, probability: 1, velocity_deviation: 0, release_velocity: 0 },
  { note_id: 2, pitch: 60, start_time: 0.25, duration: 0.25, velocity: 100, mute: false, probability: 1, velocity_deviation: 0, release_velocity: 0 },
  { note_id: 3, pitch: 69, start_time: 1, duration: 0.25, velocity: 100, mute: false, probability: 1, velocity_deviation: 0, release_velocity: 0 },
  { note_id: 4, pitch: 67, start_time: 2, duration: 0.25, velocity: 100, mute: false, probability: 1, velocity_deviation: 0, release_velocity: 0 },
];

console.log("Notes:", notes);
const measures = notesToMeasures(notes, 4);
console.log("Measures:", JSON.stringify(measures, null, 2));