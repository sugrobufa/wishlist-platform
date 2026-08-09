"use server";

// Экшены настроек хозяйки (тикет 13). Тонкие (CLAUDE.md): сессия здесь,
// ownership/Zod/revalidateTag — в services/rooms; отказы переводятся в коды,
// клиент показывает строки ns Settings.
import { ZodError } from "zod";
import { auth, signOut } from "@/server/auth";
import {
  AVATAR_MAX_BYTES,
  RoomSettingsError,
  changeRoomPreset,
  getSessionUserId,
  newAvatarKey,
  setDemoGhostsOff,
  setHallSettings,
  setLightSettings,
  setOccasionDate,
  setOwnerAvatar,
  setRoomNick,
  setZoneOff,
  setZoneSet,
  updateDisplayName,
  type HallSettingsInput,
  type LightSettingsInput,
} from "@/server/services/rooms";
import { presignPut } from "@/server/s3";

export type SettingsError =
  | "AUTH"
  | "NO_ROOM"
  | "VALIDATION"
  | "NICK_TAKEN"
  | "NICK_RESERVED"
  | "ZONE_UNKNOWN"
  | "TOO_LARGE"
  | "BAD_TYPE"
  | "GENERIC";

export type SettingsResult = { error: SettingsError } | { ok: true };

async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return getSessionUserId(session?.user);
}

/** Единый перевод отказов сервиса в коды клиента. */
function toError(error: unknown): SettingsResult {
  if (error instanceof ZodError) return { error: "VALIDATION" };
  if (error instanceof RoomSettingsError) {
    switch (error.code) {
      case "NO_ROOM":
        return { error: "NO_ROOM" };
      case "NICK_TAKEN":
        return { error: "NICK_TAKEN" };
      case "NICK_RESERVED":
        return { error: "NICK_RESERVED" };
      case "ZONE_UNKNOWN":
        return { error: "ZONE_UNKNOWN" };
      case "FOREIGN_AVATAR_KEY":
        return { error: "VALIDATION" };
    }
  }
  throw error;
}

async function runForOwner(mutate: (userId: string) => Promise<unknown>): Promise<SettingsResult> {
  const userId = await sessionUserId();
  if (!userId) return { error: "AUTH" };
  try {
    await mutate(userId);
  } catch (error) {
    return toError(error);
  }
  return { ok: true };
}

// ---------- Профиль ----------

export async function updateDisplayNameAction(displayName: string): Promise<SettingsResult> {
  return runForOwner((userId) => updateDisplayName(userId, String(displayName ?? "")));
}

export type PresignAvatarResult = { key: string; url: string } | { error: SettingsError };

/**
 * Pre-signed PUT для аватара: растровые ≤5 МБ, ключ avatars/{userId}/{16hex}.{ext}
 * СВОЕГО пользователя. Валидация своя — photoKey-схема вещей не подходит
 * (комментарий тикета 04); SVG не пускаем (XSS через /media).
 */
export async function presignAvatarAction(input: {
  contentType: string;
  size: number;
}): Promise<PresignAvatarResult> {
  const userId = await sessionUserId();
  if (!userId) return { error: "AUTH" };

  const size = Number(input?.size);
  if (!Number.isInteger(size) || size <= 0 || size > AVATAR_MAX_BYTES) {
    return { error: "TOO_LARGE" };
  }

  const contentType = String(input?.contentType ?? "");
  const key = newAvatarKey(userId, contentType);
  if (!key) return { error: "BAD_TYPE" };

  const url = await presignPut(key, contentType, size);
  return { key, url };
}

/** Сохранить загруженный аватар (null — убрать). Чужой ключ не пройдёт. */
export async function saveAvatarAction(key: string | null): Promise<SettingsResult> {
  return runForOwner((userId) => setOwnerAvatar(userId, key === null ? null : String(key)));
}

// ---------- Ник ----------

/** Занять/сменить (строка) или освободить (null) ник. */
export async function setNickAction(nick: string | null): Promise<SettingsResult> {
  return runForOwner((userId) => setRoomNick(userId, nick === null ? null : String(nick)));
}

// ---------- Комната: пресет, набор зон, зоны ----------

export type ChangePresetResult = { ok: true; moved: number } | { error: SettingsError };

export async function changePresetAction(preset: string): Promise<ChangePresetResult> {
  const userId = await sessionUserId();
  if (!userId) return { error: "AUTH" };
  try {
    const { movedToAnything } = await changeRoomPreset(userId, String(preset));
    return { ok: true, moved: movedToAnything };
  } catch (error) {
    const mapped = toError(error);
    return "error" in mapped ? mapped : { error: "GENERIC" };
  }
}

export async function setZoneSetAction(zoneSet: string): Promise<SettingsResult> {
  return runForOwner((userId) => setZoneSet(userId, String(zoneSet)));
}

export async function toggleZoneAction(zoneKey: string, off: boolean): Promise<SettingsResult> {
  return runForOwner((userId) => setZoneOff(userId, String(zoneKey), Boolean(off)));
}

// ---------- Дата праздника и демо-призраки ----------

export async function setOccasionDateAction(date: string | null): Promise<SettingsResult> {
  return runForOwner((userId) => setOccasionDate(userId, date === null ? null : String(date)));
}

export async function setDemoGhostsAction(off: boolean): Promise<SettingsResult> {
  return runForOwner((userId) => setDemoGhostsOff(userId, Boolean(off)));
}

// ---------- Сокровищница: кто видит (тикет 116) и стоимость (тикет 35) ----------

/**
 * Сохранить раздел «Сокровищница»: кто видит саму витрину (три положения,
 * тикет 116/ADR-0011), видимость цены (четыре положения), сумма, имя
 * дарителя, округление. Раздел сохраняется целиком — как нарисовано на доске
 * (турн 12d, кнопка «Сохранить» внизу экрана).
 */
export async function setHallSettingsAction(input: HallSettingsInput): Promise<SettingsResult> {
  return runForOwner((userId) => setHallSettings(userId, input));
}

// ---------- Свет и время суток (тикет 96) ----------

/**
 * Сохранить свет комнаты. Сохраняется по одному нажатию, без кнопки «ОК»:
 * ручка меняет картинку на глазах, и подтверждать тут нечего.
 */
export async function setLightSettingsAction(input: LightSettingsInput): Promise<SettingsResult> {
  return runForOwner((userId) => setLightSettings(userId, input));
}

// ---------- Выход ----------

/** «Выйти» — Auth.js завершает сессию и уводит на главную. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
