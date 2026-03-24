import { useRef, useCallback } from "react"
import type { Note } from "@/lib/Domain"
import { renderScore } from "@/lib/vexflow/render-score"
import { Button } from "@/components/ui/button"

interface ScoreDisplayProps {
  notes: Note[]
  timeSigNum: number
  timeSigDen: number
}

export function ScoreDisplay({ notes, timeSigNum, timeSigDen }: ScoreDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const handleRender = useCallback(() => {
    const el = containerRef.current
    if (!el || notes.length === 0) return
    el.innerHTML = ""
    renderScore(el, notes, timeSigNum, timeSigDen).catch((error: unknown) => {
      console.error("Score render failed:", error)
    })
  }, [notes, timeSigNum, timeSigDen])

  if (notes.length === 0) return null

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <Button variant="secondary" onClick={handleRender}>
          Render Score
        </Button>
      </div>
      <div
        ref={containerRef}
        id="score-container"
        className="bg-background overflow-x-auto rounded border"
      />
    </div>
  )
}
