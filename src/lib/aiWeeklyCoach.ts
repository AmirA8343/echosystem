import { z } from "zod";
import type { EcosystemWeeklyReview } from "../types.js";

const weeklyCoachSchema = z.object({
  headline: z.string().trim().min(5).max(70),
  summary: z.string().trim().min(30).max(320),
  focus: z.string().trim().min(10).max(180),
  action: z.string().trim().min(5).max(140),
});

const localeNames: Record<string, string> = {
  ar: "Arabic",
  en: "English",
  es: "Spanish",
  fa: "Persian",
  fr: "French",
  hi: "Hindi",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  "pt-BR": "Brazilian Portuguese",
  ru: "Russian",
  tr: "Turkish",
  zh: "Chinese",
};

export type AiWeeklyCoach = {
  headline: string;
  summary: string;
  focus: string;
  action: string;
  personalizedByAi: boolean;
  model: string | null;
};

type PersonalizeWeeklyCoachInput = {
  locale?: string | null;
  profile: Record<string, unknown> | null;
  summaries: Record<string, unknown>[];
  weeklyReview: EcosystemWeeklyReview;
};

const normalizeLocale = (locale?: string | null): string => {
  const value = String(locale ?? "en").trim();
  if (localeNames[value]) return value;
  const base = value.split("-")[0];
  return localeNames[base] ? base : "en";
};

const fallbackCoach = (review: EcosystemWeeklyReview): AiWeeklyCoach => ({
  headline:
    review.weeklyMomentum === "building"
      ? "Your momentum is building"
      : review.weeklyMomentum === "slipping"
        ? "Reset one habit this week"
        : "Your week is holding steady",
  summary: `${review.bestHabit} ${review.weakestHabit}`,
  focus: review.nextWeekFocus,
  action: review.targetAdjustment.reason,
  personalizedByAi: false,
  model: null,
});

const extractOutputText = (response: Record<string, unknown>): string | null => {
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const value = part as Record<string, unknown>;
      if (value.type === "output_text" && typeof value.text === "string") {
        return value.text;
      }
    }
  }
  return null;
};

const extractNumbers = (value: string): Set<string> =>
  new Set(value.match(/\d+(?:[.,]\d+)?/g) ?? []);

export async function personalizeWeeklyCoach(
  input: PersonalizeWeeklyCoachInput
): Promise<AiWeeklyCoach> {
  const fallback = fallbackCoach(input.weeklyReview);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[AI weekly coach] using deterministic fallback: OPENAI_API_KEY is missing");
    return fallback;
  }

  const model = process.env.OPENAI_COACH_MODEL?.trim() || "gpt-4o-mini";
  const locale = normalizeLocale(input.locale);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const source = JSON.stringify({
      profile: input.profile,
      summaries: input.summaries.slice(0, 14),
      weeklyReview: input.weeklyReview,
    });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 450,
        instructions: [
          "You write a concise weekly plan for a healthy-aging, nutrition, and recovery coaching ecosystem.",
          "Use the supplied deterministic review as the source of truth and explain the pattern in a specific, supportive way.",
          "Nutrition data comes from FitMacro. Sleep, movement, hydration, and visual scan signals can come from FitFace.",
          "Do not diagnose, prescribe treatment, shame the user, promise outcomes, or invent facts or measurements.",
          "Prioritize sustainable energy, recovery, strength, nutrition, and consistency without claiming to reverse aging.",
          "Recommend one achievable focus and one concrete action. Do not change calculated targets.",
          "Do not include numeric digits anywhere in the response. Do not restate dates, measurements, scores, amounts, or targets because the app displays calculated values separately.",
          `Write in ${localeNames[locale]}.`,
        ].join(" "),
        input: source,
        text: {
          format: {
            type: "json_schema",
            name: "personalized_weekly_coach",
            strict: true,
            schema: {
              type: "object",
              properties: {
                headline: { type: "string" },
                summary: { type: "string" },
                focus: { type: "string" },
                action: { type: "string" },
              },
              required: ["headline", "summary", "focus", "action"],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.warn(
        `[AI weekly coach] OpenAI request failed (${response.status}): ${errorBody.slice(0, 500)}`
      );
      return { ...fallback, model };
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const outputText = extractOutputText(payload);
    if (!outputText) {
      console.warn("[AI weekly coach] using deterministic fallback: model returned no text", {
        model,
      });
      return { ...fallback, model };
    }

    const parsed = weeklyCoachSchema.safeParse(JSON.parse(outputText));
    if (!parsed.success) {
      console.warn("[AI weekly coach] using deterministic fallback: invalid model output", {
        model,
      });
      return { ...fallback, model };
    }

    const allowedNumbers = extractNumbers(source);
    const generatedNumbers = extractNumbers(Object.values(parsed.data).join(" "));
    if ([...generatedNumbers].some((number) => !allowedNumbers.has(number))) {
      console.warn("[AI weekly coach] using deterministic fallback: model changed a number", {
        model,
      });
      return { ...fallback, model };
    }

    console.info("[AI weekly coach] personalization succeeded", {
      locale,
      model,
      momentum: input.weeklyReview.weeklyMomentum,
    });
    return {
      ...parsed.data,
      personalizedByAi: true,
      model,
    };
  } catch (error) {
    console.warn("[AI weekly coach] personalization failed", error);
    return { ...fallback, model };
  } finally {
    clearTimeout(timeout);
  }
}
