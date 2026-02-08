import { NextResponse } from "next/server";
import { instances, runCommandSilent, reconcileWithDocker } from "@/lib/instances";

export async function GET() {
  let dockerAvailable = false;
  try {
    await runCommandSilent("docker", ["info"]);
    dockerAvailable = true;
  } catch {
    // Docker not available
  }

  // Recover any containers we lost track of (hot reload, restart)
  if (dockerAvailable) {
    await reconcileWithDocker();
  }

  const runningInstances = Array.from(instances.values()).filter(
    (i) => i.status === "running"
  );

  return NextResponse.json({
    dockerAvailable,
    totalInstances: instances.size,
    runningInstances: runningInstances.length,
    instances: runningInstances.map((i) => ({
      id: i.id,
      status: i.status,
      port: i.port,
      dashboardUrl: i.dashboardUrl,
      createdAt: i.createdAt,
      persona: i.persona,
      provider: i.provider,
      modelId: i.modelId,
    })),
  });
}
