import { ConfigProvider, Layer, ManagedRuntime } from "effect";

import { LilyPondRenderer } from "@/lib/lilypond/renderer";

const baseLayer = Layer.mergeAll(
  ConfigProvider.layer(ConfigProvider.fromEnv()),
  LilyPondRenderer.layer,
);

const appLayer = baseLayer;

export const runtime = ManagedRuntime.make(appLayer);

const dispose = () => void runtime.dispose();

process.once("SIGINT", dispose);
process.once("SIGTERM", dispose);
