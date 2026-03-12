-- AlterTable: add alertType column to sticker_mappings
ALTER TABLE "sticker_mappings" ADD COLUMN "alertType" TEXT NOT NULL DEFAULT 'missiles';

-- DropIndex: remove old unique constraint
DROP INDEX "sticker_mappings_alertConfigId_phase_key";

-- CreateIndex: new unique constraint including alertType
CREATE UNIQUE INDEX "sticker_mappings_alertConfigId_alertType_phase_key" ON "sticker_mappings"("alertConfigId", "alertType", "phase");

-- AlterTable: add alertType column to alert_logs
ALTER TABLE "alert_logs" ADD COLUMN "alertType" TEXT NOT NULL DEFAULT 'missiles';
