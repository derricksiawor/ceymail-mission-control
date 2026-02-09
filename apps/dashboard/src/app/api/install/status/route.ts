import { NextRequest, NextResponse } from "next/server";
import { getConfig, saveConfig } from "@/lib/config/config";
import { requireAdmin } from "@/lib/api/helpers";

// GET - Check install status (any authenticated user)
export async function GET() {
  try {
    const config = getConfig();
    if (!config) {
      return NextResponse.json({ installed: false, completedAt: null });
    }

    const completedAt = config.installCompletedAt ?? null;
    return NextResponse.json({
      installed: !!completedAt,
      completedAt,
    });
  } catch (error) {
    console.error("Error checking install status:", error);
    return NextResponse.json(
      { error: "Failed to check install status" },
      { status: 500 }
    );
  }
}

// POST - Mark install as complete (admin only)
export async function POST(request: NextRequest) {
  try {
    const denied = requireAdmin(request);
    if (denied) return denied;

    const config = getConfig();
    if (!config) {
      return NextResponse.json(
        { error: "Configuration not found. Run setup wizard first." },
        { status: 400 }
      );
    }

    const completedAt = new Date().toISOString();
    saveConfig({
      ...config,
      installCompletedAt: completedAt,
    });

    return NextResponse.json({
      success: true,
      completedAt,
    });
  } catch (error) {
    console.error("Error marking install complete:", error);
    return NextResponse.json(
      { error: "Failed to mark install as complete" },
      { status: 500 }
    );
  }
}

// DELETE - Reset install state (admin only)
export async function DELETE(request: NextRequest) {
  try {
    const denied = requireAdmin(request);
    if (denied) return denied;

    const config = getConfig();
    if (!config) {
      return NextResponse.json(
        { error: "Configuration not found" },
        { status: 400 }
      );
    }

    saveConfig({
      ...config,
      installCompletedAt: null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error resetting install state:", error);
    return NextResponse.json(
      { error: "Failed to reset install state" },
      { status: 500 }
    );
  }
}
