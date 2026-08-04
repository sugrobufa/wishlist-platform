-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "ItemState" AS ENUM ('LOVE', 'WANT');

-- CreateEnum
CREATE TYPE "PriceVisibility" AS ENUM ('ALL', 'FRIENDS', 'ME', 'NONE');

-- CreateEnum
CREATE TYPE "ItemSource" AS ENUM ('URL', 'MANUAL', 'PHOTO', 'CATALOG', 'SHARE', 'EXTENSION', 'BOT');

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('QUIET', 'SIGNED', 'POOL');

-- CreateEnum
CREATE TYPE "ConnectionKind" AS ENUM ('MUTUAL', 'FOLLOW', 'VIEWED');

-- CreateEnum
CREATE TYPE "CatalogSourceType" AS ENUM ('ADMITAD', 'EPN', 'YML', 'AMAZON_PAAPI', 'ALIEXPRESS');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "displayName" TEXT,
    "avatarKey" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "secondAuth" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
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
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "zoneSet" TEXT NOT NULL DEFAULT 'ALL',
    "zonesOff" TEXT[],
    "shareSlug" TEXT NOT NULL,
    "occasionDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "state" "ItemState" NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "photoKey" TEXT,
    "url" TEXT,
    "canonicalUrl" TEXT,
    "domain" TEXT,
    "price" DECIMAL(12,2),
    "currency" TEXT,
    "priceVisibility" "PriceVisibility" NOT NULL DEFAULT 'ALL',
    "size" TEXT,
    "color" TEXT,
    "desire" INTEGER,
    "giverName" TEXT,
    "receivedAt" TIMESTAMP(3),
    "inHall" BOOLEAN NOT NULL DEFAULT false,
    "hiddenFromHall" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "source" "ItemSource" NOT NULL DEFAULT 'MANUAL',
    "catalogProductId" TEXT,
    "priceCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "mode" "BookingMode" NOT NULL DEFAULT 'QUIET',
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT,
    "guestUserId" TEXT,
    "cancelToken" TEXT NOT NULL,
    "purchased" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolContribution" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccasionSummary" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "revealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OccasionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "aUserId" TEXT NOT NULL,
    "bUserId" TEXT NOT NULL,
    "kind" "ConnectionKind" NOT NULL,
    "origin" TEXT NOT NULL,
    "history" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "available" BOOLEAN,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParseJob" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParseJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSource" (
    "id" TEXT NOT NULL,
    "type" "CatalogSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "CatalogSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogProduct" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "zone" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "affiliateUrl" TEXT,
    "gtin" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "embedding" vector(768),

    CONSTRAINT "CatalogProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundClick" (
    "id" TEXT NOT NULL,
    "catalogProductId" TEXT,
    "itemId" TEXT,
    "context" TEXT NOT NULL,
    "subId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecognitionJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attrs" JSONB,
    "candidates" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecognitionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "Room_userId_key" ON "Room"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_shareSlug_key" ON "Room"("shareSlug");

-- CreateIndex
CREATE INDEX "Item_roomId_zone_state_idx" ON "Item"("roomId", "zone", "state");

-- CreateIndex
CREATE INDEX "Item_canonicalUrl_idx" ON "Item"("canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_itemId_key" ON "Booking"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_cancelToken_key" ON "Booking"("cancelToken");

-- CreateIndex
CREATE INDEX "OccasionSummary_roomId_date_idx" ON "OccasionSummary"("roomId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_aUserId_bUserId_key" ON "Connection"("aUserId", "bUserId");

-- CreateIndex
CREATE INDEX "PriceSnapshot_itemId_checkedAt_idx" ON "PriceSnapshot"("itemId", "checkedAt");

-- CreateIndex
CREATE INDEX "CatalogProduct_zone_available_idx" ON "CatalogProduct"("zone", "available");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogProduct_sourceId_externalId_key" ON "CatalogProduct"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "OutboundClick_catalogProductId_createdAt_idx" ON "OutboundClick"("catalogProductId", "createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolContribution" ADD CONSTRAINT "PoolContribution_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_aUserId_fkey" FOREIGN KEY ("aUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_bUserId_fkey" FOREIGN KEY ("bUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CatalogSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
