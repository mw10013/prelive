import { createFileRoute } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { NoteTable } from "@/components/NoteTable"
import { type Note } from "@/lib/Domain"
import { readClip, writeNotes } from "@/lib/liveql"

interface ClipInfo {
  id: number
  name: string
  length: number
}

let nextTempId = -1

export const Route = createFileRoute("/")({
  component: RouteComponent,
})

function RouteComponent() {
  const [notes, setNotes] = useState<Note[]>([])
  const [clipInfo, setClipInfo] = useState<ClipInfo | null>(null)
  const [modifiedNoteIds, setModifiedNoteIds] = useState<Set<number>>(new Set())
  const [deletedNoteIds, setDeletedNoteIds] = useState<Set<number>>(new Set())

  const readMutation = useMutation({
    mutationFn: () => readClip(),
    onSuccess: (data) => {
      const detailClip = data.live_set.view.detail_clip
      if (!detailClip) return
      setClipInfo({ id: detailClip.id, name: detailClip.name, length: detailClip.length })
      setNotes([...(detailClip.notes ?? [])])
      setModifiedNoteIds(new Set())
      setDeletedNoteIds(new Set())
    },
  })

  const writeMutation = useMutation({
    mutationFn: writeNotes,
    onSuccess: () => { readMutation.mutate() },
  })

  const handleWrite = () => {
    if (!clipInfo) return
    writeMutation.mutate({
      data: {
        clipId: clipInfo.id,
        newNotes: notes.filter((n) => n.note_id < 0).map(({ note_id: _, ...rest }) => rest),
        modifiedNotes: notes.filter(
          (n) => modifiedNoteIds.has(n.note_id) && n.note_id > 0,
        ),
        removedNoteIds: [...deletedNoteIds],
      },
    })
  }

  const handleAddNote = () => {
    setNotes((prev) => [
      ...prev,
      {
        note_id: nextTempId--,
        pitch: 60,
        start_time: 0,
        duration: 1,
        velocity: 100,
        mute: false,
        probability: 1,
        velocity_deviation: 0,
        release_velocity: 64,
      },
    ])
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center gap-2">
        <Button onClick={() => { readMutation.mutate() }} disabled={readMutation.isPending}>
          {readMutation.isPending ? "Reading…" : "Read from Live"}
        </Button>
        <Button onClick={handleWrite} disabled={!clipInfo || writeMutation.isPending}>
          {writeMutation.isPending ? "Writing…" : "Write to Live"}
        </Button>
        <Button variant="secondary" onClick={handleAddNote} disabled={!clipInfo}>
          + Note
        </Button>
        {clipInfo && (
          <span className="text-muted-foreground ml-auto text-sm">
            {clipInfo.name} ({clipInfo.length} beats)
          </span>
        )}
      </div>

      {readMutation.isError && (
        <p className="text-destructive mb-2 text-sm">
          {readMutation.error instanceof Error ? readMutation.error.message : "Read failed"}
        </p>
      )}
      {writeMutation.isError && (
        <p className="text-destructive mb-2 text-sm">
          {writeMutation.error instanceof Error ? writeMutation.error.message : "Write failed"}
        </p>
      )}

      <NoteTable
        notes={notes}
        onUpdate={(rowIndex, columnId, value) => {
          setNotes((old) =>
            old.map((row, i) => (i === rowIndex ? { ...row, [columnId]: value } : row)),
          )
          const noteId = notes[rowIndex]?.note_id
          if (noteId !== undefined && noteId > 0) {
            setModifiedNoteIds((prev) => new Set(prev).add(noteId))
          }
        }}
        onDelete={(rowIndex) => {
          const noteId = notes[rowIndex]?.note_id
          if (noteId !== undefined && noteId > 0) {
            setDeletedNoteIds((prev) => new Set(prev).add(noteId))
          }
          setNotes((old) => old.filter((_, i) => i !== rowIndex))
        }}
      />

      {clipInfo && notes.length > 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          {notes.length} notes · {modifiedNoteIds.size} modified · {deletedNoteIds.size} deleted
        </p>
      )}
    </div>
  )
}
