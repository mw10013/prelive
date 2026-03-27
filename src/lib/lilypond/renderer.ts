import type { Note } from "@/lib/Domain";

import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, FileSystem, Layer, Path, Schema, ServiceMap } from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

import { notesToMidiFile } from "./midi";
import { quantizeNotes } from "./quantizer";
import { notesToLilyPond } from "./score";

class LilyPondError extends Schema.TaggedErrorClass<LilyPondError>()(
  "LilyPondError",
  {
    message: Schema.String,
    cause: Schema.Defect,
  },
) {}

export class LilyPondRenderer extends ServiceMap.Service<
  LilyPondRenderer,
  {
    readonly renderToSvg: (
      notes: readonly Note[],
    ) => Effect.Effect<Uint8Array, LilyPondError>;
  }
>()("app/LilyPondRenderer") {
  static readonly layerNoDeps = Layer.effect(
    LilyPondRenderer,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner;

      const lyToSvg = Effect.fn("lyToSvg")(function* (lyContent: string) {
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const tmpDir = yield* fs.makeTempDirectoryScoped({
              prefix: "lilypond-",
            });
            const tmpLy = path.join(tmpDir, "score.ly");
            const outputBase = path.join(tmpDir, "score");

            yield* fs.writeFileString(tmpLy, lyContent);

            yield* spawner.string(
              ChildProcess.make("lilypond", [
                "-dbackend=svg",
                "-o",
                outputBase,
                tmpLy,
              ]),
            );

            return yield* fs.readFile(`${outputBase}.svg`);
          }),
        );
      });

      const renderToSvg = Effect.fn("LilyPondRenderer.renderToSvg")(function* (
        notes: readonly Note[],
      ) {
        const quantized = yield* quantizeNotes(notes);
        const midiBuffer = notesToMidiFile(quantized);
        const debugDir = path.join(process.cwd(), "logs");
        const debugMidiPath = path.join(debugDir, "score-debug.mid");
        const debugLyPath = path.join(debugDir, "score-debug.ly");
        const debugSvgPath = path.join(debugDir, "score-debug.svg");

        yield* fs.writeFile(debugMidiPath, midiBuffer).pipe(
          Effect.mapError(
            (e) => new LilyPondError({ message: "debug midi write failed", cause: e }),
          ),
        );

        const lyContent = notesToLilyPond(quantized);

        yield* fs.writeFileString(debugLyPath, lyContent).pipe(
          Effect.mapError(
            (e) => new LilyPondError({ message: "debug ly write failed", cause: e }),
          ),
        );

        const svgBuffer = yield* lyToSvg(lyContent).pipe(
          Effect.mapError(
            (e) => new LilyPondError({ message: "lilypond failed", cause: e }),
          ),
        );

        yield* fs.writeFile(debugSvgPath, svgBuffer).pipe(
          Effect.mapError(
            (e) => new LilyPondError({ message: "debug svg write failed", cause: e }),
          ),
        );

        return svgBuffer;
      });

      return LilyPondRenderer.of({ renderToSvg });
    }),
  );

  static readonly layer = Layer.provide(
    Layer.provide(
      Layer.provide(this.layerNoDeps, NodeChildProcessSpawner.layer),
      NodePath.layer,
    ),
    NodeFileSystem.layer,
  );
}
