"use server";

// Экшен удаления аккаунта (тикет 14, GDPR). Отдельный файл: actions.ts —
// территория тикета 13, сюда только новое. Экшен тонкий: сессия и
// перепроверка фразы здесь, каскад/чистка S3 — в services/account.
import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { DELETE_ACCOUNT_PHRASE, deleteAccount } from "@/server/services/account";

export type DeleteAccountError = "AUTH" | "PHRASE" | "GENERIC";

/**
 * Удалить аккаунт целиком. Клиент требует ввести точную фразу
 * («удалить комнату»), сервер ПЕРЕПРОВЕРЯЕТ поле confirm — доверия клиенту
 * нет. Успех заканчивается redirect("/") — сюда не возвращаемся.
 */
export async function deleteAccountAction(input: {
  confirm: string;
}): Promise<{ error: DeleteAccountError }> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  const confirm = String(input?.confirm ?? "").trim().toLowerCase();
  if (confirm !== DELETE_ACCOUNT_PHRASE) return { error: "PHRASE" };

  try {
    // Выход ДО удаления: сессия ещё жива — Auth.js тихо удаляет её и чистит
    // cookie. Наоборот нельзя: каскад снёс бы сессию раньше signOut, и
    // адаптер шумел бы AdapterError на каждом успешном удалении (проверено
    // живым смоуком). Отказ signOut не останавливает: сессии этой и других
    // устройств всё равно умрут в каскаде ниже, останется лишь мёртвая cookie.
    await signOut({ redirect: false });
  } catch {
    // сознательно молчим — удаление важнее косметики cookie
  }

  try {
    // s3Cleaned=false не отказ: аккаунт удалён, сироты в S3 залогированы.
    await deleteAccount(userId);
  } catch {
    return { error: "GENERIC" };
  }

  redirect("/");
}
