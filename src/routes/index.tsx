import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { runtime } from "@/lib/runtime";

export const Route = createFileRoute("/")({
  loader: async () => {
    const message = await runtime.runPromise(
      Effect.succeed("Effect v4 runtime is working"),
    );
    return { message };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { message } = Route.useLoaderData();

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>prelive</CardTitle>
          <CardDescription>Skeleton project</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
