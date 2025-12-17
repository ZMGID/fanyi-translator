
import { translate as bingTranslate } from 'bing-translate-api';

// Docs: https://github.com/plainheart/bing-translate-api

export async function translate(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  // Auto-detect is handled by Bing usually, but we can be specific or leave auto.
  // 'bing-translate-api' defaults to auto-detect source.
  // We just need to determine target.

  const hasChinese = /[\u4e00-\u9fa5]/.test(trimmed);
  const targetLang = hasChinese ? 'en' : 'zh-Hans'; // zh-Hans for Simplified Chinese

  try {
    const res = await bingTranslate(trimmed, null, targetLang);
    if (res && res.translation) {
      return res.translation;
    }
    return "Translation error";
  } catch (error) {
    console.error("Bing API Error:", error);
    return "Translation failed (API limit or network)";
  }
}
