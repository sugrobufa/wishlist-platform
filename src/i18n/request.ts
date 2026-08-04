import { getRequestConfig } from "next-intl/server";

// Стартовый язык — ru; каркас для en заложен (messages/en.json).
export default getRequestConfig(async () => {
  const locale = "ru";
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
