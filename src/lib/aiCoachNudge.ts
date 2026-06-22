import { z } from "zod";
import type { CoachPushNudge } from "../types.js";

const aiCoachTextSchema = z.object({
  title: z.string().trim().min(4).max(55),
  body: z.string().trim().min(20).max(220),
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

type PersonalizeCoachNudgeInput = {
  fallback: CoachPushNudge;
  sourceApp: "fitmacro" | "fitface";
  locale?: string | null;
  profile: Record<string, unknown> | null;
  today: Record<string, unknown> | null;
  recentSummaries: Array<Record<string, unknown>>;
};

export type PersonalizedCoachNudge = {
  nudge: CoachPushNudge;
  personalizedByAi: boolean;
  model: string | null;
};

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

const normalizeLocale = (locale?: string | null): string => {
  const value = String(locale ?? "en").trim();
  if (localeNames[value]) return value;
  const base = value.split("-")[0];
  return localeNames[base] ? base : "en";
};

const extractNumbers = (value: string): Set<string> =>
  new Set(value.match(/\d+(?:[.,]\d+)?/g) ?? []);

const preservesKnownNumbers = (fallback: CoachPushNudge, title: string, body: string) => {
  const allowed = extractNumbers(`${fallback.title} ${fallback.body}`);
  const generated = extractNumbers(`${title} ${body}`);
  return [...generated].every((number) => allowed.has(number));
};

export async function personalizeCoachNudge(
  input: PersonalizeCoachNudgeInput
): Promise<PersonalizedCoachNudge> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { nudge: input.fallback, personalizedByAi: false, model: null };
  }

  const model = process.env.OPENAI_COACH_MODEL?.trim() || "gpt-5.4-nano";
  const locale = normalizeLocale(input.locale);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
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
        reasoning: { effort: "low" },
        max_output_tokens: 220,
        instructions: [
          "You write one concise mobile push notification for a nutrition and recovery coach.",
          "The deterministic fallback already chose the safe action. Rewrite it to sound personal and specific, but do not change its recommendation, destination, or any numbers.",
          "Use only supplied facts. Never diagnose, prescribe treatment, shame the user, promise outcomes, or invent measurements.",
          "Mention a FitFace recovery signal only when it is present in the supplied data.",
          `Write in ${localeNames[locale]}. Keep the title under 55 characters and body under 220 characters.`,
        ].join(" "),
        input: JSON.stringify({
          sourceApp: input.sourceApp,
          fallback: {
            title: input.fallback.title,
            body: input.fallback.body,
            type: input.fallback.type,
          },
          profile: input.profile,
          today: input.today,
          recentSummaries: input.recentSummaries.slice(0, 7),
        }),
        text: {
          format: {
            type: "json_schema",
            name: "personalized_coach_nudge",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                body: { type: "string" },
              },
              required: ["title", "body"],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      return { nudge: input.fallback, personalizedByAi: false, model };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const outputText = extractOutputText(payload);
    if (!outputText) {
      return { nudge: input.fallback, personalizedByAi: false, model };
    }

    const parsed = aiCoachTextSchema.safeParse(JSON.parse(outputText));
    if (
      !parsed.success ||
      !preservesKnownNumbers(input.fallback, parsed.data.title, parsed.data.body)
    ) {
      return { nudge: input.fallback, personalizedByAi: false, model };
    }

    return {
      nudge: {
        ...input.fallback,
        title: parsed.data.title,
        body: parsed.data.body,
      },
      personalizedByAi: true,
      model,
    };
  } catch {
    return { nudge: input.fallback, personalizedByAi: false, model };
  } finally {
    clearTimeout(timeout);
  }
}
