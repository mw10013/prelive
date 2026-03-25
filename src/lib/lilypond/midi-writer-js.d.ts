declare module "midi-writer-js" {
  interface NoteEventFields {
    pitch: string[];
    duration?: string;
    wait?: string;
    velocity?: number;
    startTick?: number;
    sequential?: boolean;
    grace?: string | string[];
    channel?: number;
    repeat?: number;
  }

  interface TempoEventFields {
    bpm: number;
    tick?: number;
    delta?: number;
  }

  type NoteEvent = object;
  type TempoEvent = object;
  type TimeSignatureEvent = object;

  type NoteEventConstructor = new (fields: NoteEventFields) => NoteEvent;

  type TempoEventConstructor = new (fields: TempoEventFields) => TempoEvent;

  type TimeSignatureEventConstructor = new (
    numerator: number,
    denominator: number,
    midiclockspertick: number,
    notespermidiclock: number,
  ) => TimeSignatureEvent;

  const NoteEvent: NoteEventConstructor;
  const TempoEvent: TempoEventConstructor;
  const TimeSignatureEvent: TimeSignatureEventConstructor;

  class Track {
    addEvent(event: object | object[]): Track;
    setTempo(bpm: number, tick?: number): Track;
    setTimeSignature(
      numerator: number,
      denominator: number,
      midiclockspertick: number,
      notespermidiclock: number,
    ): Track;
    setKeySignature(sf: number, mi?: number): Track;
    addTrackName(text: string): Track;
    addLyric(text: string): Track;
  }

  class Writer {
    constructor(tracks: Track | Track[], options?: object);
    buildFile(): Uint8Array;
    dataUri(): string;
    base64(): string;
  }

  export { NoteEvent, TempoEvent, TimeSignatureEvent, Track, Writer };
  export default { NoteEvent, TempoEvent, TimeSignatureEvent, Track, Writer };
}
