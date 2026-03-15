-- CreateTable
CREATE TABLE "alert_sessions" (
    "id" SERIAL NOT NULL,
    "cities" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "hadMissileActivity" BOOLEAN NOT NULL DEFAULT false,
    "hadAircraftActivity" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_sessions_isActive_idx" ON "alert_sessions"("isActive");

-- CreateIndex
CREATE INDEX "alert_sessions_cities_idx" ON "alert_sessions"("cities");