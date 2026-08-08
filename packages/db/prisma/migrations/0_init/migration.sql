-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "MonitorType" AS ENUM ('HTTP', 'TCP', 'ICMP', 'SSL', 'DNS', 'HEARTBEAT');

-- CreateEnum
CREATE TYPE "MonitorState" AS ENUM ('PENDING', 'UP', 'DEGRADED', 'DOWN', 'PAUSED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('DEGRADED', 'DOWN');

-- CreateEnum
CREATE TYPE "IncidentUpdateStatus" AS ENUM ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('EMAIL', 'SLACK', 'DISCORD', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "NotificationState" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "AnnotationKind" AS ENUM ('DEPLOY', 'CONFIG_CHANGE', 'MANUAL', 'INCIDENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "refresh_token_expires_in" INTEGER,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Monitor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MonitorType" NOT NULL DEFAULT 'HTTP',
    "target" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "assertions" JSONB NOT NULL DEFAULT '{}',
    "headers" JSONB NOT NULL DEFAULT '{}',
    "body" TEXT,
    "intervalSec" INTEGER NOT NULL DEFAULT 60,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "degradedMs" INTEGER NOT NULL DEFAULT 2000,
    "confirmThreshold" INTEGER NOT NULL DEFAULT 3,
    "recoverThreshold" INTEGER NOT NULL DEFAULT 2,
    "quorum" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "state" "MonitorState" NOT NULL DEFAULT 'PENDING',
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorDependency" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Heartbeat" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "graceSec" INTEGER NOT NULL DEFAULT 300,
    "lastPingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Heartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceWindow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "rrule" TEXT,
    "monitorIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SloTarget" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "objective" DECIMAL(6,4) NOT NULL DEFAULT 99.9,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SloTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Check" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "monitorId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,
    "dnsMs" INTEGER,
    "connectMs" INTEGER,
    "tlsMs" INTEGER,
    "ttfbMs" INTEGER,

    CONSTRAINT "Check_pkey" PRIMARY KEY ("id","ts")
) PARTITION BY RANGE ("ts");

-- CreateTable
CREATE TABLE "CheckRollup" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "upCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "p50Ms" INTEGER,
    "p95Ms" INTEGER,
    "p99Ms" INTEGER,
    "minMs" INTEGER,
    "maxMs" INTEGER,
    "downtimeSec" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'DOWN',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "cause" TEXT,
    "ackedAt" TIMESTAMP(3),
    "ackedById" TEXT,
    "parentIncidentId" TEXT,
    "isFlapping" BOOLEAN NOT NULL DEFAULT false,
    "failingRegions" TEXT[],
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentUpdate" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" "IncidentUpdateStatus" NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "monitorId" TEXT,
    "kind" "AnnotationKind" NOT NULL DEFAULT 'MANUAL',
    "label" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tier" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorChannel" (
    "monitorId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    CONSTRAINT "MonitorChannel_pkey" PRIMARY KEY ("monitorId","channelId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "state" "NotificationState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "customDomain" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" TEXT,
    "branding" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatusPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPageItem" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "displayName" TEXT,
    "group" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StatusPageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPageSubscriber" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "unsubscribeToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusPageSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "Monitor_organizationId_idx" ON "Monitor"("organizationId");

-- CreateIndex
CREATE INDEX "Monitor_active_nextCheckAt_idx" ON "Monitor"("active", "nextCheckAt");

-- CreateIndex
CREATE INDEX "Monitor_organizationId_state_idx" ON "Monitor"("organizationId", "state");

-- CreateIndex
CREATE INDEX "MonitorDependency_dependsOnId_idx" ON "MonitorDependency"("dependsOnId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorDependency_monitorId_dependsOnId_key" ON "MonitorDependency"("monitorId", "dependsOnId");

-- CreateIndex
CREATE UNIQUE INDEX "Region_slug_key" ON "Region"("slug");

-- CreateIndex
CREATE INDEX "Region_active_idx" ON "Region"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Heartbeat_monitorId_key" ON "Heartbeat"("monitorId");

-- CreateIndex
CREATE UNIQUE INDEX "Heartbeat_token_key" ON "Heartbeat"("token");

-- CreateIndex
CREATE INDEX "MaintenanceWindow_organizationId_startsAt_idx" ON "MaintenanceWindow"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "MaintenanceWindow_startsAt_endsAt_idx" ON "MaintenanceWindow"("startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "SloTarget_monitorId_windowDays_key" ON "SloTarget"("monitorId", "windowDays");

-- CreateIndex
CREATE INDEX "Check_monitorId_ts_idx" ON "Check"("monitorId", "ts" DESC);

-- CreateIndex
CREATE INDEX "Check_monitorId_regionId_ts_idx" ON "Check"("monitorId", "regionId", "ts" DESC);

-- CreateIndex
CREATE INDEX "CheckRollup_day_idx" ON "CheckRollup"("day");

-- CreateIndex
CREATE UNIQUE INDEX "CheckRollup_monitorId_day_key" ON "CheckRollup"("monitorId", "day");

-- CreateIndex
CREATE INDEX "Incident_monitorId_startedAt_idx" ON "Incident"("monitorId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "Incident_resolvedAt_idx" ON "Incident"("resolvedAt");

-- CreateIndex
CREATE INDEX "Incident_parentIncidentId_idx" ON "Incident"("parentIncidentId");

-- CreateIndex
CREATE INDEX "IncidentUpdate_incidentId_createdAt_idx" ON "IncidentUpdate"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "Annotation_organizationId_ts_idx" ON "Annotation"("organizationId", "ts" DESC);

-- CreateIndex
CREATE INDEX "Annotation_monitorId_ts_idx" ON "Annotation"("monitorId", "ts" DESC);

-- CreateIndex
CREATE INDEX "NotificationChannel_organizationId_idx" ON "NotificationChannel"("organizationId");

-- CreateIndex
CREATE INDEX "MonitorChannel_channelId_idx" ON "MonitorChannel"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_incidentId_idx" ON "Notification"("incidentId");

-- CreateIndex
CREATE INDEX "Notification_state_createdAt_idx" ON "Notification"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPage_slug_key" ON "StatusPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPage_customDomain_key" ON "StatusPage"("customDomain");

-- CreateIndex
CREATE INDEX "StatusPage_organizationId_idx" ON "StatusPage"("organizationId");

-- CreateIndex
CREATE INDEX "StatusPageItem_statusPageId_position_idx" ON "StatusPageItem"("statusPageId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageItem_statusPageId_monitorId_key" ON "StatusPageItem"("statusPageId", "monitorId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageSubscriber_unsubscribeToken_key" ON "StatusPageSubscriber"("unsubscribeToken");

-- CreateIndex
CREATE INDEX "StatusPageSubscriber_statusPageId_verifiedAt_idx" ON "StatusPageSubscriber"("statusPageId", "verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageSubscriber_statusPageId_email_key" ON "StatusPageSubscriber"("statusPageId", "email");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorDependency" ADD CONSTRAINT "MonitorDependency_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorDependency" ADD CONSTRAINT "MonitorDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heartbeat" ADD CONSTRAINT "Heartbeat_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SloTarget" ADD CONSTRAINT "SloTarget_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckRollup" ADD CONSTRAINT "CheckRollup_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_ackedById_fkey" FOREIGN KEY ("ackedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_parentIncidentId_fkey" FOREIGN KEY ("parentIncidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorChannel" ADD CONSTRAINT "MonitorChannel_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorChannel" ADD CONSTRAINT "MonitorChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPage" ADD CONSTRAINT "StatusPage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageItem" ADD CONSTRAINT "StatusPageItem_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageItem" ADD CONSTRAINT "StatusPageItem_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageSubscriber" ADD CONSTRAINT "StatusPageSubscriber_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────
-- Check partitioning (hand-written; Prisma cannot express this)
--
-- "Check" is the only unbounded table: ~26M rows/month at 100 monitors x
-- 3 regions x 30s. Retention is implemented as a partition DROP rather than
-- a DELETE, because deleting tens of millions of rows leaves dead tuples that
-- bloat the heap and force expensive vacuums.
-- ─────────────────────────────────────────────────────────────

-- Creates the monthly partition covering `at`, if it does not already exist.
-- Idempotent, so the worker can call it on every tick without coordination.
CREATE OR REPLACE FUNCTION uptick_ensure_check_partition(at TIMESTAMP(3))
RETURNS TEXT AS $$
DECLARE
    range_start DATE := date_trunc('month', at)::DATE;
    range_end   DATE := (date_trunc('month', at) + INTERVAL '1 month')::DATE;
    part_name   TEXT := 'Check_' || to_char(range_start, 'YYYY_MM');
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF "Check" FOR VALUES FROM (%L) TO (%L)',
            part_name, range_start, range_end
        );
    END IF;
    RETURN part_name;
END;
$$ LANGUAGE plpgsql;

-- Drops partitions whose entire range is older than the retention cutoff.
-- Returns the names dropped so the job can log what it reclaimed.
CREATE OR REPLACE FUNCTION uptick_prune_check_partitions(retain_days INT DEFAULT 30)
RETURNS SETOF TEXT AS $$
DECLARE
    cutoff DATE := (date_trunc('month', now() - make_interval(days => retain_days)))::DATE;
    part   RECORD;
BEGIN
    FOR part IN
        SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'Check'
          AND to_date(right(c.relname, 7), 'YYYY_MM') < cutoff
    LOOP
        EXECUTE format('DROP TABLE %I', part.name);
        RETURN NEXT part.name;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- A default partition guarantees inserts never fail on a missing range. Rows
-- landing here are a signal that the ensure-partition job is not running.
CREATE TABLE IF NOT EXISTS "Check_default" PARTITION OF "Check" DEFAULT;

-- Seed the current and next month so probing works immediately after deploy.
SELECT uptick_ensure_check_partition(now()::TIMESTAMP(3));
SELECT uptick_ensure_check_partition((now() + INTERVAL '1 month')::TIMESTAMP(3));
