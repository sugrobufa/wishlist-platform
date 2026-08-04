import { test, expect } from "@playwright/test";

test("домашняя страница рендерится с заголовком и кнопкой входа", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /войти/i })).toBeVisible();
});

test("страница входа показывает форму почты", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByRole("textbox")).toBeVisible();
});
