import { NextRequest, NextResponse } from "next/server";
import { getMailPool } from "@/lib/db/connection";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { requireAdmin } from "@/lib/api/helpers";

// GET - Fetch all aliases with domain names
export async function GET() {
  try {
    const pool = getMailPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT va.*, vd.name as domain_name
       FROM virtual_aliases va
       JOIN virtual_domains vd ON va.domain_id = vd.id
       ORDER BY va.source`
    );

    return NextResponse.json(rows, { status: 200 });
  } catch (error) {
    console.error("Error fetching aliases:", error);
    return NextResponse.json(
      { error: "Failed to fetch aliases" },
      { status: 500 }
    );
  }
}

// POST - Create a new alias
export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    const { source, destination, domain_id } = body as { source?: unknown; destination?: unknown; domain_id?: unknown };

    // Validate required fields
    if (!source || typeof source !== "string") {
      return NextResponse.json(
        { error: "Source is required and must be a string" },
        { status: 400 }
      );
    }

    if (!destination || typeof destination !== "string") {
      return NextResponse.json(
        { error: "Destination is required and must be a string" },
        { status: 400 }
      );
    }

    if (!domain_id || typeof domain_id !== "number") {
      return NextResponse.json(
        { error: "Domain ID is required and must be a number" },
        { status: 400 }
      );
    }

    // Validate email format for source
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(source)) {
      return NextResponse.json(
        { error: "Invalid source email format" },
        { status: 400 }
      );
    }

    // Validate email format for destination
    if (!emailRegex.test(destination)) {
      return NextResponse.json(
        { error: "Invalid destination email format" },
        { status: 400 }
      );
    }

    // Bug 1 fix: Prevent self-referencing aliases (would create mail loop)
    if (source.toLowerCase() === destination.toLowerCase()) {
      return NextResponse.json(
        { error: "Source and destination cannot be the same (would create a mail loop)" },
        { status: 400 }
      );
    }

    const pool = getMailPool();

    // Verify domain exists
    const [domainRows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM virtual_domains WHERE id = ?",
      [domain_id]
    );

    if (domainRows.length === 0) {
      return NextResponse.json(
        { error: "Domain not found" },
        { status: 404 }
      );
    }

    // Bug 2 fix: Check for duplicate alias (same source, destination, domain_id)
    const [existingAlias] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM virtual_aliases WHERE source = ? AND destination = ? AND domain_id = ?",
      [source, destination, domain_id]
    );

    if (existingAlias.length > 0) {
      return NextResponse.json(
        { error: "An alias with this source, destination, and domain already exists" },
        { status: 409 }
      );
    }

    // Insert the alias using prepared statement
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO virtual_aliases (source, destination, domain_id) VALUES (?, ?, ?)",
      [source, destination, domain_id]
    );

    // Fetch the created alias with domain name
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT va.*, vd.name as domain_name
       FROM virtual_aliases va
       JOIN virtual_domains vd ON va.domain_id = vd.id
       WHERE va.id = ?`,
      [result.insertId]
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (error) {
    console.error("Error creating alias:", error);

    // Handle duplicate entry error
    const dbError = error as { code?: string };
    if (dbError.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "Alias with this source already exists" },
        { status: 409 }
      );
    }

    // Handle foreign key constraint errors
    if (dbError.code === "ER_NO_REFERENCED_ROW_2") {
      return NextResponse.json(
        { error: "Invalid domain ID" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create alias" },
      { status: 500 }
    );
  }
}

// DELETE - Delete an alias by ID
export async function DELETE(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get("id");

    // Validate ID
    if (!id) {
      return NextResponse.json(
        { error: "Alias ID is required" },
        { status: 400 }
      );
    }

    const aliasId = Number(id);
    if (!Number.isInteger(aliasId) || aliasId <= 0) {
      return NextResponse.json(
        { error: "Invalid alias ID" },
        { status: 400 }
      );
    }

    const pool = getMailPool();

    // Delete the alias using prepared statement
    const [result] = await pool.query<ResultSetHeader>(
      "DELETE FROM virtual_aliases WHERE id = ?",
      [aliasId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "Alias not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: "Alias deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting alias:", error);
    return NextResponse.json(
      { error: "Failed to delete alias" },
      { status: 500 }
    );
  }
}
