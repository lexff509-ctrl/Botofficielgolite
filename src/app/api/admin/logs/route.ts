import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { systemLogs } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const adminPayload = getUserFromRequest(req);
    if (!adminPayload || adminPayload.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const logs = await db
      .select()
      .from(systemLogs)
      .orderBy(desc(systemLogs.createdAt))
      .limit(500); // Fetch last 500 logs

    return NextResponse.json({ logs });
  } catch (error) {
    console.error("Failed to fetch system logs:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const adminPayload = getUserFromRequest(req);
    if (!adminPayload || adminPayload.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await db.delete(systemLogs);

    return NextResponse.json({ message: "Logs cleared successfully" });
  } catch (error) {
    console.error("Failed to clear system logs:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
