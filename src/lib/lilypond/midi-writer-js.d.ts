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

  class NoteEvent {
    constructor(fields: NoteEventFields);
  }

  class TempoEvent {
    constructor(fields: TempoEventFields);
  }

  class TimeSignatureEvent {
    constructor(
      numerator: number,
      denominator: number,
      midiclockspertick: number,
      notespermidiclock: number,
    );
  }

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
