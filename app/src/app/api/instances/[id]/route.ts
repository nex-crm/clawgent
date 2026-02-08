import { NextResponse } from "next/server";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import { instances, destroyInstance, reconcileWithDocker } from "@/lib/instances";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let instance = instances.get(id);

  // If not found, try reconciling with Docker first
  if (!instance) {
    await reconcileWithDocker();
    instance = instances.get(id);
  }

  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: instance.id,
    status: instance.status,
    port: instance.port,
    token: instance.token,
    dashboardUrl: instance.dashboardUrl,
    createdAt: instance.createdAt,
    logs: instance.logs,
    provider: instance.provider,
    modelId: instance.modelId,
    persona: instance.persona,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authenticate the user
  let userId: string;
  if (isWorkOSConfigured) {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const session = await withAuth({ ensureSignedIn: true });
    userId = session.user.id;
  } else {
    userId = DEV_USER_ID;
  }

  const { id } = await params;
  const instance = instances.get(id);

  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  // Only allow the owner to destroy their instance
  if (instance.userId && instance.userId !== userId) {
    return NextResponse.json(
      { error: "You can only destroy your own instances" },
      { status: 403 },
    );
  }

  try {
    await destroyInstance(id);
    return NextResponse.json({ message: "Instance destroyed", id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
