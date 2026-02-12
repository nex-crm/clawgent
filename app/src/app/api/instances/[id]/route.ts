import { NextResponse } from "next/server";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import { instances, destroyInstance, reconcileWithDocker } from "@/lib/instances";
import { getPostHogClient } from "@/lib/posthog-server";
import { dbGetLinkedByWebUser, dbGetWaSession, dbUpsertWaSession, dbDeleteLinkedByPhone } from "@/lib/db";
import { sendPlivoMessage } from "@/lib/whatsapp";
import { stopInstanceListener } from "@/lib/instance-listener";

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

    stopInstanceListener(id);
    await destroyInstance(id);

    // Notify linked WhatsApp user and clean up session (non-fatal)
    try {
      const linked = dbGetLinkedByWebUser(userId);
      if (linked) {
        const waSession = dbGetWaSession(linked.wa_phone);
        if (waSession && waSession.instanceId === id) {
          dbUpsertWaSession({
            ...waSession,
            currentState: "PERSONA_SELECT",
            instanceId: null,
            activeAgent: null,
            selectedPersona: null,
            selectedProvider: null,
            updatedAt: new Date().toISOString(),
          });
          await sendPlivoMessage(
            linked.wa_phone,
            "your instance was shut down from the web dashboard. send any message to start a new one."
          );
        }
        dbDeleteLinkedByPhone(linked.wa_phone);
        console.log(`[api] unlinked WA phone ${linked.wa_phone} after web destroy of instance ${id}`);
      }
    } catch (waErr) {
      console.error(`[api] non-fatal: WA notification failed for instance ${id}:`, waErr);
    }

    // Track instance destroyed (server-side)
    const posthog = getPostHogClient();
    posthog?.capture({
      distinctId: userId,
      event: 'instance_destroyed',
      properties: {
        source: "web",
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
