import { NextResponse } from "next/server";
import { db } from "@/db";
import { systemLogs, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { cookies } from "next/headers";
import * as jwt from "jose";

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return false;

  try {
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || "fallback_secret_key_123"
    );
    const { payload } = await jwt.jwtVerify(token, secret);
    
    if (!payload.userId) return false;

    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, Number(payload.userId)));

    return user?.role === "ADMIN";
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
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

export async function DELETE() {
  try {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
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
