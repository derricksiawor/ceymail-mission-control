import { NextRequest, NextResponse } from "next/server";

/**
 * Safely parse JSON body from request.
 * Returns [body, null] on success, [null, NextResponse] on failure.
 */
export async function parseJsonBody<T extends Record<string, unknown>>(
  request: NextRequest,
  allowedFields: string[]
): Promise<[T, null] | [null, NextResponse]> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return [
      null,
      NextResponse.json(
        { error: "Invalid or missing JSON body" },
        { status: 400 }
      ),
    ];
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return [
      null,
      NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 }
      ),
    ];
  }

  // Strip unknown fields and prototype pollution keys
  const body = raw as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  const dangerousKeys = ["__proto__", "constructor", "prototype"];

  for (const key of allowedFields) {
    if (key in body && !dangerousKeys.includes(key)) {
      sanitized[key] = body[key];
    }
  }

  return [sanitized as T, null];
}

/**
 * Validate that an ID from query params is a positive integer.
 * Returns [number, null] on success, [0, NextResponse] on failure.
 */
export function parseIntId(
  value: string | null,
  label = "ID"
): [number, null] | [0, NextResponse] {
  if (!value) {
    return [
      0,
      NextResponse.json({ error: `${label} is required` }, { status: 400 }),
    ];
  }

  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    return [
      0,
      NextResponse.json({ error: `Invalid ${label}` }, { status: 400 }),
    ];
  }

  return [num, null];
}

/**
 * Sanitize an error for client consumption.
 * Never expose internal details (stack traces, command output, paths).
 */
export function safeErrorResponse(
  userMessage: string,
  status = 500
): NextResponse {
  return NextResponse.json({ error: userMessage }, { status });
}
