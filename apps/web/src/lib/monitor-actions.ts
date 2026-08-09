"use server";

import { checkUrl } from "@uptick/core";
import { prisma, type MonitorType, type Prisma } from "@uptick/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { invalid, type ActionResult } from "./action-result";
import { canWrite, requireOrg, type ActiveOrg } from "./tenancy";

/** Types whose `target` is a URL and must clear the SSRF pre-filter. */
const URL_TYPES: readonly MonitorType[] = ["HTTP", "SSL"];

const monitorInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.enum(["HTTP", "TCP", "ICMP", "SSL", "DNS", "HEARTBEAT"]),
  target: z.string().trim().min(1, "Target is required").max(2048),
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  intervalSec: z.coerce.number().int().min(10).max(86_400),
  timeoutMs: z.coerce.number().int().min(500).max(60_000),
  degradedMs: z.coerce.number().int().min(1).max(60_000),
});

export type { ActionResult };

function parseForm(form: FormData) {
  return monitorInput.safeParse({
    name: form.get("name"),
    type: form.get("type"),
    target: form.get("target"),
    method: form.get("method") ?? "GET",
    intervalSec: form.get("intervalSec"),
    timeoutMs: form.get("timeoutMs"),
    degradedMs: form.get("degradedMs"),
  });
}

/**
 * Reject targets that point at internal infrastructure.
 *
 * This is the same structural pre-filter the prober uses, applied here so a
 * hostile target is refused at write time rather than discovered when a worker
 * tries to fetch it. It is NOT the full boundary — the prober still checks
 * every resolved IP, because DNS can change between save and probe.
 */
function validateTarget(type: MonitorType, target: string): string | null {
  if (!URL_TYPES.includes(type)) {
    return null;
  }
  const verdict = checkUrl(target);
  return verdict.allowed ? null : verdict.reason;
}

async function requireWriter(orgSlug: string): Promise<ActiveOrg | ActionResult> {
  const org = await requireOrg(orgSlug);
  if (!canWrite(org.role)) {
    return { ok: false, error: "Your role does not allow changing monitors." };
  }
  return org;
}

function isDenied(value: ActiveOrg | ActionResult): value is ActionResult {
  return "ok" in value;
}

export async function createMonitor(orgSlug: string, form: FormData): Promise<ActionResult> {
  const org = await requireWriter(orgSlug);
  if (isDenied(org)) return org;

  const parsed = parseForm(form);
  if (!parsed.success) {
    return invalid(parsed.error);
  }

  const targetError = validateTarget(parsed.data.type, parsed.data.target);
  if (targetError) {
    return { ok: false, error: targetError, fieldErrors: { target: targetError } };
  }

  const monitor = await prisma.monitor.create({
    data: { organizationId: org.organizationId, ...parsed.data },
    select: { id: true },
  });

  await writeAudit(org, "monitor.create", monitor.id, { name: parsed.data.name });
  revalidatePath(`/${orgSlug}`);
  return { ok: true };
}

export async function updateMonitor(
  orgSlug: string,
  monitorId: string,
  form: FormData,
): Promise<ActionResult> {
  const org = await requireWriter(orgSlug);
  if (isDenied(org)) return org;

  const parsed = parseForm(form);
  if (!parsed.success) {
    return invalid(parsed.error);
  }

  const targetError = validateTarget(parsed.data.type, parsed.data.target);
  if (targetError) {
    return { ok: false, error: targetError, fieldErrors: { target: targetError } };
  }

  // Scoped by organizationId as well as id: a guessed id from another tenant
  // updates zero rows rather than their monitor.
  const { count } = await prisma.monitor.updateMany({
    where: { id: monitorId, organizationId: org.organizationId },
    data: parsed.data,
  });

  if (count === 0) {
    return { ok: false, error: "Monitor not found." };
  }

  await writeAudit(org, "monitor.update", monitorId, { name: parsed.data.name });
  revalidatePath(`/${orgSlug}`);
  revalidatePath(`/${orgSlug}/monitors/${monitorId}`);
  return { ok: true };
}

/** Pause or resume. Paused monitors are skipped by the scheduler lease query. */
export async function setMonitorActive(
  orgSlug: string,
  monitorId: string,
  active: boolean,
): Promise<ActionResult> {
  const org = await requireWriter(orgSlug);
  if (isDenied(org)) return org;

  const { count } = await prisma.monitor.updateMany({
    where: { id: monitorId, organizationId: org.organizationId },
    data: { active, state: active ? "PENDING" : "PAUSED" },
  });

  if (count === 0) {
    return { ok: false, error: "Monitor not found." };
  }

  await writeAudit(org, active ? "monitor.resume" : "monitor.pause", monitorId, {});
  revalidatePath(`/${orgSlug}`);
  revalidatePath(`/${orgSlug}/monitors/${monitorId}`);
  return { ok: true };
}

/** Acknowledge an open incident so escalation stops paging. */
export async function acknowledgeIncident(
  orgSlug: string,
  incidentId: string,
): Promise<ActionResult> {
  const org = await requireWriter(orgSlug);
  if (isDenied(org)) return org;

  const { count } = await prisma.incident.updateMany({
    where: {
      id: incidentId,
      ackedAt: null,
      monitor: { organizationId: org.organizationId },
    },
    data: { ackedAt: new Date(), ackedById: org.userId },
  });

  if (count === 0) {
    return { ok: false, error: "Incident not found or already acknowledged." };
  }

  await writeAudit(org, "incident.ack", incidentId, {});
  revalidatePath(`/${orgSlug}/incidents`);
  return { ok: true };
}

/**
 * `useActionState` wrappers.
 *
 * The hook calls actions as (previousState, formData); the underlying actions
 * take their org and monitor ids first so they can be bound on the server. On
 * success these redirect, which is why they never return an ok result.
 */
export async function createMonitorForm(
  orgSlug: string,
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const result = await createMonitor(orgSlug, form);
  if (result.ok) {
    redirect(`/${orgSlug}`);
  }
  return result;
}

export async function updateMonitorForm(
  orgSlug: string,
  monitorId: string,
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const result = await updateMonitor(orgSlug, monitorId, form);
  if (result.ok) {
    redirect(`/${orgSlug}/monitors/${monitorId}`);
  }
  return result;
}

async function writeAudit(
  org: ActiveOrg,
  action: string,
  targetId: string,
  meta: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      organizationId: org.organizationId,
      actorId: org.userId,
      action,
      targetType: action.split(".")[0] ?? "monitor",
      targetId,
      meta,
    },
  });
}
