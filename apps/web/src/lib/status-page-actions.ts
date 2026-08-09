"use server";

import { prisma } from "@uptick/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { invalid, type ActionResult } from "./action-result";
import { canWrite, requireOrg, type ActiveOrg } from "./tenancy";

export type { ActionResult };

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const pageInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Slug is required")
    .max(64)
    .regex(SLUG_PATTERN, "Use lowercase letters, numbers and dashes only"),
  description: z.string().trim().max(2000).optional(),
  isPublic: z.boolean(),
});

function parsePage(form: FormData) {
  return pageInput.safeParse({
    title: form.get("title"),
    slug: form.get("slug"),
    description: form.get("description")?.toString() || undefined,
    isPublic: form.get("isPublic") === "on",
  });
}

async function requireWriter(orgSlug: string): Promise<ActiveOrg | ActionResult> {
  const org = await requireOrg(orgSlug);
  if (!canWrite(org.role)) {
    return { ok: false, error: "Your role does not allow changing status pages." };
  }
  return org;
}

function isDenied(value: ActiveOrg | ActionResult): value is ActionResult {
  return "ok" in value;
}

/** Slugs are globally unique, so a clash may belong to another tenant. */
async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const existing = await prisma.statusPage.findUnique({ where: { slug }, select: { id: true } });
  return existing !== null && existing.id !== exceptId;
}

export async function createStatusPage(orgSlug: string, form: FormData): Promise<ActionResult> {
  const org = await requireWriter(orgSlug);
  if (isDenied(org)) return org;

  const parsed = parsePage(form);
  if (!parsed.success) return invalid(parsed.error);

  if (await slugTaken(parsed.data.slug)) {
    return { ok: false, error: "That slug is taken.", fieldErrors: { slug: "Already in use" } };
  }

  const page = await prisma.statusPage.create({
    data: { organizationId: org.organizationId, ...parsed.data },
    select: { id: true },
  });

  revalidatePath(`/${orgSlug}/status-pages`);
  redirect(`/${orgSlug}/status-pages/${page.id}`);
}

export async function updateStatusPage(
  orgSlug: string,
  pageId: string,
  form: FormData,
): Promise<ActionResult> {
  const org = await requireWriter(orgSlug);
  if (isDenied(org)) return org;

  const parsed = parsePage(form);
  if (!parsed.success) return invalid(parsed.error);

  if (await slugTaken(parsed.data.slug, pageId)) {
    return { ok: false, error: "That slug is taken.", fieldErrors: { slug: "Already in use" } };
  }

  const { count } = await prisma.statusPage.updateMany({
    where: { id: pageId, organizationId: org.organizationId },
    data: parsed.data,
  });

  if (count === 0) {
    return { ok: false, error: "Status page not found." };
  }

  revalidatePath(`/${orgSlug}/status-pages/${pageId}`);
  revalidatePath(`/status/${parsed.data.slug}`);
  return { ok: true };
}

/**
 * Replace the published component list.
 *
 * The submitted monitor ids are intersected with the monitors that actually
 * belong to the caller's organization before anything is written. Without that
 * step a forged form value would publish another tenant's monitor on a page
 * anyone can read — the worst failure this feature can have.
 */
export async function setStatusPageItems(
  orgSlug: string,
  pageId: string,
  monitorIds: string[],
): Promise<ActionResult> {
  const org = await requireWriter(orgSlug);
  if (isDenied(org)) return org;

  const page = await prisma.statusPage.findFirst({
    where: { id: pageId, organizationId: org.organizationId },
    select: { id: true, slug: true },
  });

  if (!page) {
    return { ok: false, error: "Status page not found." };
  }

  const owned = await prisma.monitor.findMany({
    where: { id: { in: monitorIds }, organizationId: org.organizationId },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((m) => m.id));
  const allowed = monitorIds.filter((id) => ownedIds.has(id));

  await prisma.$transaction([
    prisma.statusPageItem.deleteMany({ where: { statusPageId: page.id } }),
    prisma.statusPageItem.createMany({
      data: allowed.map((monitorId, position) => ({
        statusPageId: page.id,
        monitorId,
        position,
      })),
    }),
  ]);

  await prisma.auditLog.create({
    data: {
      organizationId: org.organizationId,
      actorId: org.userId,
      action: "statuspage.items",
      targetType: "statuspage",
      targetId: page.id,
      meta: { count: allowed.length },
    },
  });

  revalidatePath(`/${orgSlug}/status-pages/${pageId}`);
  revalidatePath(`/status/${page.slug}`);
  return { ok: true };
}

export async function deleteStatusPage(orgSlug: string, pageId: string): Promise<ActionResult> {
  const org = await requireWriter(orgSlug);
  if (isDenied(org)) return org;

  const { count } = await prisma.statusPage.deleteMany({
    where: { id: pageId, organizationId: org.organizationId },
  });

  if (count === 0) {
    return { ok: false, error: "Status page not found." };
  }

  revalidatePath(`/${orgSlug}/status-pages`);
  redirect(`/${orgSlug}/status-pages`);
}

/** `useActionState` wrappers; see monitor-actions for the signature rationale. */
export async function createStatusPageForm(
  orgSlug: string,
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  return createStatusPage(orgSlug, form);
}

export async function updateStatusPageForm(
  orgSlug: string,
  pageId: string,
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  return updateStatusPage(orgSlug, pageId, form);
}

/** Items arrive as repeated `monitorId` fields, in checkbox order. */
export async function setStatusPageItemsForm(
  orgSlug: string,
  pageId: string,
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const ids = form.getAll("monitorId").map(String);
  return setStatusPageItems(orgSlug, pageId, ids);
}
