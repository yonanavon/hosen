-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stickers" (
    "id" SERIAL NOT NULL,
    "tag" TEXT NOT NULL,
    "buffer" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL DEFAULT 'image/webp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stickers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_configs" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "cities" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sticker_mappings" (
    "id" SERIAL NOT NULL,
    "alertConfigId" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "stickerTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sticker_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_logs" (
    "id" SERIAL NOT NULL,
    "alertConfigId" INTEGER,
    "phase" TEXT NOT NULL,
    "stickerTag" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "cities" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessions_key_key" ON "whatsapp_sessions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "stickers_tag_key" ON "stickers"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "sticker_mappings_alertConfigId_phase_key" ON "sticker_mappings"("alertConfigId", "phase");

-- AddForeignKey
ALTER TABLE "sticker_mappings" ADD CONSTRAINT "sticker_mappings_alertConfigId_fkey" FOREIGN KEY ("alertConfigId") REFERENCES "alert_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
