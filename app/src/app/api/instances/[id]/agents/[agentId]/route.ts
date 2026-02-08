import { NextResponse } from "next/server";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import { instances, runCommand, reconcileWithDocker } from "@/lib/instances";

/**
 * DELETE /api/instances/[id]/agents/[agentId]
 * Remove an agent from a running instance.
 * Cannot delete the "main" agent.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; agentId: string }> },
) {
  const { id, agentId } = await params;

  // Authenticate
  let userId: string;
  if (isWorkOSConfigured) {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const session = await withAuth({ ensureSignedIn: true });
    userId = session.user.id;
  } else {
    userId = DEV_USER_ID;
  }

  let instance = instances.get(id);
  if (!instance) {
    await reconcileWithDocker();
    instance = instances.get(id);
  }
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }
  if (instance.userId && instance.userId !== userId) {
    return NextResponse.json(
      { error: "You can only remove agents from your own instance" },
      { status: 403 },
    );
  }
  if (instance.status !== "running") {
    return NextResponse.json(
      { error: `Instance is ${instance.status}, not running` },
      { status: 409 },
    );
  }

  // Prevent deleting the main agent
  if (agentId === "main") {
    return NextResponse.json(
      { error: "Cannot delete the main agent" },
      { status: 400 },
    );
  }

  try {
    await runCommand("docker", [
      "exec", instance.containerName,
      "openclaw", "agents", "delete", agentId, "--force", "--json",
    ]);

    return NextResponse.json({
      message: `Agent "${agentId}" removed`,
      agentId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to delete agent: ${message}` },
      { status: 500 },
    );
  }
}
