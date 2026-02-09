import { NextResponse } from "next/server";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import {
  findInstanceByUserId,
  reconcileWithDocker,
} from "@/lib/instances";

export async function GET() {
  let userId: string | null = null;
  let userInfo: { id: string; email: string; firstName: string | null; lastName: string | null; profilePictureUrl: string | null } | null = null;

  if (isWorkOSConfigured) {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const session = await withAuth();

    if (!session.user) {
      return NextResponse.json({ user: null, instance: null });
    }

    userId = session.user.id;
    userInfo = {
      id: session.user.id,
      email: session.user.email,
      firstName: session.user.firstName,
      lastName: session.user.lastName,
      profilePictureUrl: session.user.profilePictureUrl,
    };
  } else {
    // Dev mode: anonymous user
    userId = DEV_USER_ID;
    userInfo = {
      id: DEV_USER_ID,
      email: "",
      firstName: "Dev",
      lastName: "User",
      profilePictureUrl: null,
    };
  }

  // Reconcile to pick up any containers from server restart
  await reconcileWithDocker();

  const instance = findInstanceByUserId(userId);

  return NextResponse.json({
    user: userInfo,
    instance: instance
      ? {
          id: instance.id,
          status: instance.status,
          dashboardUrl: instance.dashboardUrl,
          createdAt: instance.createdAt,
          persona: instance.persona,
          provider: instance.provider,
          modelId: instance.modelId,
        }
      : null,
  });
}
