import { NextRequest, NextResponse } from "next/server";

/**
 * Require admin role for mutation endpoints.
 * Returns null if authorized, or a 403 NextResponse if not.
 */
export function requireAdmin(request: NextRequest): NextResponse | null {
  const role = request.headers.get("x-user-role");
  if (role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }
  return null;
}
