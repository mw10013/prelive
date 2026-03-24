import { VexFlow, Factory, Stave, StaveNote, Formatter, Beam } from "vexflow"
import type { Note } from "@/lib/Domain"
import { notesToMeasures, type Measure } from "./notes-to-measures"

let fontsLoaded = false

async function ensureFonts(): Promise<void> {
  if (fontsLoaded) return
  await VexFlow.loadFonts("Bravura", "Academico")
  VexFlow.setFonts("Bravura", "Academico")
  fontsLoaded = true
}

function buildStaveNotes(measure: Measure): StaveNote[] {
  return measure.notes.map(
    (desc) => new StaveNote({ keys: desc.keys, duration: desc.duration }),
  )
}

export async function renderScore(
  container: HTMLElement,
  notes: Note[],
  timeSigNum: number,
  timeSigDen: number,
): Promise<void> {
  await ensureFonts()

  const isDark = document.documentElement.classList.contains("dark")
  const fg = isDark ? "#e4e4e7" : "black"

  const measures = notesToMeasures(notes, timeSigNum)
  if (measures.length === 0) return

  const measuresPerRow = 4
  const rowHeight = 160
  const rows = Math.ceil(measures.length / measuresPerRow)
  const width = 900
  const height = rows * rowHeight + 40

  const factory = new Factory({
    renderer: { elementId: container.id, width, height },
  })
  const ctx = factory.getContext()
  ctx.setFillStyle(fg)
  ctx.setStrokeStyle(fg)

  for (let row = 0; row < rows; row++) {
    const rowMeasures = measures.slice(
      row * measuresPerRow,
      (row + 1) * measuresPerRow,
    )
    const y = row * rowHeight + 20
    const staveWidth = Math.floor((width - 40) / rowMeasures.length)

    for (let i = 0; i < rowMeasures.length; i++) {
      const measure = rowMeasures[i]
      const isFirstOverall = row === 0 && i === 0
      const x = 20 + i * staveWidth

      const staveNotes = buildStaveNotes(measure)

      const stave = new Stave(x, y, staveWidth)
      if (isFirstOverall) {
        stave.addClef("treble")
        stave.addTimeSignature(`${String(timeSigNum)}/${String(timeSigDen)}`)
      }
      stave.setContext(ctx).draw()

      Formatter.FormatAndDraw(ctx, stave, staveNotes)

      const beamable = staveNotes.filter(
        (n) => !n.isRest() && n.getTicks().value() <= 4 * 480,
      )
      if (beamable.length > 1) {
        const beams = Beam.generateBeams(beamable)
        for (const beam of beams) {
          beam.setContext(ctx).draw()
        }
      }
    }
  }

  if (isDark) {
    const svg = container.querySelector("svg")
    if (svg) {
      svg.setAttribute("fill", fg)
      svg.setAttribute("stroke", fg)
      svg.setAttribute("shadowColor", fg)
      for (const el of svg.querySelectorAll("[stroke='#444']")) {
        el.setAttribute("stroke", fg)
      }
    }
  }
}
