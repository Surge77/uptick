import { checkRateLimit } from "@/lib/rate-limit";
import { verifyWebhookSignature } from "@uptick/core";
import { prisma } from "@uptick/db";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Bounded so an oversized body cannot be used to burn CPU on HMAC. */
const MAX_BODY_BYTES = 16 * 1024;

/** Generous for CI (a deploy train is a handful a minute), tight for abuse. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const deployPayload = z.object({
  org: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(200),
  /** Optional: scope the marker to one monitor instead of the whole org. */
  monitorId: z.string().trim().max(64).optional(),
  /** Optional ISO timestamp; defaults to receipt time. */
  ts: z.string().datetime().optional(),
});

/** Every failure returns the same shape: a prober must not learn why it failed. */
function rejected() {
  return NextResponse.json({ error: "Rejected" }, { status: 401 });
}

/**
 * Record a deploy marker for incident correlation.
 *
 * Unauthenticated by nature — CI systems post here — so the HMAC signature is
 * the only thing standing between this and an open write. Failures are
 * deliberately indistinguishable to the caller: distinguishing "bad signature"
 * from "unknown org" would turn this into an organization-slug oracle.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.DEPLOY_WEBHOOK_SECRET;
  if (!secret) {
    // Unconfigured means closed, not open.
    return rejected();
  }

  // Rate limit before any crypto: HMAC over attacker-supplied bodies is
  // exactly the CPU an unauthenticated flood would want us to spend. Keyed
  // by client IP, taking the first hop of x-forwarded-for as set by the
  // fronting proxy.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const allowed = await checkRateLimit(`deploys:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const signature = request.headers.get("x-uptick-signature");
  if (!signature) {
    return rejected();
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return rejected();
  }

  const verdict = verifyWebhookSignature({
    payload: raw,
    header: signature,
    secret,
    now: new Date(),
  });

  if (!verdict.valid) {
    return rejected();
  }

  let parsed: z.infer<typeof deployPayload>;
  try {
    parsed = deployPayload.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { slug: parsed.org },
    select: { id: true },
  });

  if (!org) {
    return rejected();
  }

  // A monitor id from the request is only honoured if it belongs to the named
  // org; otherwise the marker is recorded org-wide rather than against someone
  // else's monitor.
  const monitorId = parsed.monitorId
    ? ((
        await prisma.monitor.findFirst({
          where: { id: parsed.monitorId, organizationId: org.id },
          select: { id: true },
        })
      )?.id ?? null)
    : null;

  const annotation = await prisma.annotation.create({
    data: {
      organizationId: org.id,
      monitorId,
      kind: "DEPLOY",
      label: parsed.label,
      ts: parsed.ts ? new Date(parsed.ts) : new Date(),
    },
    select: { id: true },
  });

  return NextResponse.json({ id: annotation.id }, { status: 201 });
}
