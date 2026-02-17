import { NextRequest, NextResponse } from "next/server";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import {
  dbGetLinkCode,
  dbMarkLinkCodeUsed,
  dbGetLinkedByWebUser,
  dbGetLinkedByPhone,
  dbInsertLinkedAccount,
  dbGetWaSession,
  dbUpsertWaSession,
} from "@/lib/db";
import {
  findInstanceByAnyLinkedUserId,
} from "@/lib/instances";
import { startInstanceListener } from "@/lib/instance-listener";
import { sendPlivoMessage } from "@/lib/whatsapp";
import { BASE_URL } from "@/lib/whatsapp-config";

export async function POST(request: NextRequest) {
  try {
    // Authenticate
    let userId: string;
    if (isWorkOSConfigured) {
      const { withAuth } = await import("@workos-inc/authkit-nextjs");
      const session = await withAuth({ ensureSignedIn: true });
      userId = session.user.id;
    } else {
      userId = DEV_USER_ID;
    }

    // Parse body
    const body = await request.json();
    const rawCode = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";

    if (!/^[A-Z0-9]{6}$/.test(rawCode)) {
      return NextResponse.json(
        { error: "Invalid code format. Enter the 6-character code from WhatsApp." },
        { status: 400 },
      );
    }

    // Validate code
    const linkCode = dbGetLinkCode(rawCode);
    if (!linkCode) {
      return NextResponse.json(
        { error: "Invalid or expired code. Generate a new one with /link on WhatsApp." },
        { status: 404 },
      );
    }

    const phone = linkCode.phone;

    // Check if web user already linked
    const existingWebLink = dbGetLinkedByWebUser(userId);
    if (existingWebLink) {
      return NextResponse.json(
        { error: "Your web account is already linked to a WhatsApp number. Use /unlink from WhatsApp first." },
        { status: 409 },
      );
    }

    // Check if phone already linked to a different web user
    const existingPhoneLink = dbGetLinkedByPhone(phone);
    if (existingPhoneLink && existingPhoneLink.web_user_id !== userId) {
      return NextResponse.json(
        { error: "This WhatsApp number is already linked to another account." },
        { status: 409 },
      );
    }

    // Find the web user's running instance
    const instance = findInstanceByAnyLinkedUserId(userId);
    if (!instance || (instance.status !== "running" && instance.status !== "starting")) {
      return NextResponse.json(
        { error: "You don't have a running instance. Deploy one first at " + BASE_URL },
        { status: 400 },
      );
    }

    // All checks passed — create the link
    dbMarkLinkCodeUsed(rawCode);
    dbInsertLinkedAccount(userId, phone);

    // Update WA session to point at the web instance
    const now = new Date().toISOString();
    const existing = dbGetWaSession(phone);
    const session = existing ?? {
      phone,
      userId: `wa-${phone}`,
      currentState: "ACTIVE",
      selectedPersona: null,
      selectedProvider: null,
      instanceId: null,
      activeAgent: null,
      createdAt: now,
      updatedAt: now,
    };

    session.userId = userId;
    session.instanceId = instance.id;
    session.currentState = "ACTIVE";
    session.activeAgent = session.activeAgent || "main";
    session.selectedPersona = instance.persona ?? session.selectedPersona;
    session.selectedProvider = instance.provider ?? session.selectedProvider;
    session.updatedAt = now;
    dbUpsertWaSession(session);

    // Start instance listener for WA messages
    startInstanceListener(instance.id, instance.port, instance.token, phone);

    // Send confirmation to WhatsApp
    await sendPlivoMessage(
      phone,
      `🔗 *linked!* your WhatsApp is now connected to your web instance.\n\n` +
        `just type here to chat with your agent.\n\n` +
        `🌐 dashboard: ${BASE_URL}/i/${instance.id}/`,
    );

    return NextResponse.json({
      message: "Linked successfully",
      instanceId: instance.id,
    });
  } catch (err) {
    console.error("[api/link] Error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
