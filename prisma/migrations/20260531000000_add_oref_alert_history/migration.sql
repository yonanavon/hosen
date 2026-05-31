CREATE TABLE "oref_alert_history" (
    "id" SERIAL NOT NULL,
    "cat" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cities" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oref_alert_history_pkey" PRIMARY KEY ("id")
);
