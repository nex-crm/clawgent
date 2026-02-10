import { NextResponse } from "next/server";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import { instances, destroyInstance, reconcileWithDocker } from "@/lib/instances";
import { getPostHogClient } from "@/lib/posthog-server";

export async function GET(
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
  let instance = instances.get(id);

  // If not found in memory/DB, try reconciling with Docker first
  // (only reconciles running containers to avoid race conditions with destroyed instances)
  if (!instance) {
    await reconcileWithDocker();
    instance = instances.get(id);
  }

  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  // Only allow the owner to view their instance details
  if (instance.userId !== userId) {
    return NextResponse.json(
      { error: "You can only view your own instances" },
      { status: 403 },
    );
  }

  return NextResponse.json({
    id: instance.id,
    status: instance.status,
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
  if (instance.userId !== userId) {
    return NextResponse.json(
      { error: "You can only destroy your own instances" },
      { status: 403 },
    );
  }

  try {
    // Capture instance info before destroying
    const provider = instance.provider;
    const persona = instance.persona;
    const createdAt = instance.createdAt;

    await destroyInstance(id);

    // Track instance destroyed (server-side)
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: userId,
      event: 'instance_destroyed',
      properties: {
        instance_id: id,
        provider: provider,
        persona: persona ?? null,
        created_at: createdAt,
      },
    });

    return NextResponse.json({ message: "Instance destroyed", id });
  } catch (err) {
    console.error(`[api] Error destroying instance ${id}:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
