type DurationEntry = [beats: number, code: string]

const DURATION_MAP: DurationEntry[] = [
  [4, "w"],
  [3, "hd"],
  [2, "h"],
  [1.5, "qd"],
  [1, "q"],
  [0.75, "8d"],
  [0.5, "8"],
  [0.375, "16d"],
  [0.25, "16"],
  [0.125, "32"],
  [0.0625, "64"],
]

const GRID = 0.125 // 32nd note

function snapToGrid(beats: number): number {
  return Math.round(beats / GRID) * GRID
}

export function beatsToDuration(beats: number): string {
  const snapped = snapToGrid(beats)
  let best = "q"
  let bestDiff = Infinity
  for (const [len, code] of DURATION_MAP) {
    const diff = Math.abs(snapped - len)
    if (diff < bestDiff) {
      bestDiff = diff
      best = code
    }
  }
  return best
}

export function beatsToRestDuration(beats: number): string {
  return `${beatsToDuration(beats)}r`
}
