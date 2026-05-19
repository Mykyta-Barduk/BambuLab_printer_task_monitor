-- CreateTable
CREATE TABLE "Spool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialType" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "colorHex" TEXT NOT NULL,
    "totalWeightG" INTEGER NOT NULL,
    "remainingWeightG" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "currentSpoolId" TEXT,
    CONSTRAINT "Printer_currentSpoolId_fkey" FOREIGN KEY ("currentSpoolId") REFERENCES "Spool" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrintTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "modelName" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "requestedColor" TEXT NOT NULL,
    "gdriveFileLink" TEXT,
    "gdriveFolderPath" TEXT,
    "printerId" TEXT,
    "estimatedWeightG" INTEGER,
    "totalDurationMins" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrintTask_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
