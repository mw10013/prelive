import { ConfigProvider, Layer, ManagedRuntime } from "effect";

const baseLayer = Layer.mergeAll(
  ConfigProvider.layer(ConfigProvider.fromEnv()),
);

const appLayer = baseLayer;

export const runtime = ManagedRuntime.make(appLayer);

const dispose = () => void runtime.dispose();

process.once("SIGINT", dispose);
process.once("SIGTERM", dispose);
