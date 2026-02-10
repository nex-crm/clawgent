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

  const allInstances = Array.from(instances.values());
  const runningCount = allInstances.filter(
    (i) => i.status === "running"
  ).length;

  return NextResponse.json({
    dockerAvailable,
    totalInstances: instances.size,
    runningInstances: runningCount,
  });
}
