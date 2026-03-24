const SHARPS = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"]

export function midiToVexFlowKey(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 1
  const name = SHARPS[pitch % 12]
  return `${name}/${String(octave)}`
}
