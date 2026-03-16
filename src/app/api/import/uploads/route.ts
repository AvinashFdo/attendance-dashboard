import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: [{ startTime: "desc" }, { createdAt: "desc" }],
      include: {
        _count: {
          select: {
            attendance: true,
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      sessions: sessions.map((s) => ({
        id: s.id,
        moduleCode: s.moduleCode,
        intake: s.intake,
        year: s.year,
        meetingName: s.meetingName,
        startTime: s.startTime,
        scheduledDurationMin: s.scheduledDurationMin ?? s.durationMin ?? null,
        attendanceCount: s._count.attendance,
        createdAt: s.createdAt,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load uploads";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const sessionId = String(body?.sessionId ?? "").trim();

    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    await prisma.session.delete({
      where: { id: sessionId },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}