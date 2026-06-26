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
  yesterday: Record<string, unknown> | null;
  recentSummaries: Array<Record<string, unknown>>;
  micronutrientSuggestion?: Record<string, unknown> | null;
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

const valueForKey = (
  source: Record<string, unknown> | null | undefined,
  snakeKey: string,
  camelKey?: string
): unknown => {
  if (!source) return null;
  return source[snakeKey] ?? (camelKey ? source[camelKey] : null) ?? null;
};

const numberOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const stringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const latestValue = (
  summaries: Array<Record<string, unknown>>,
  snakeKey: string,
  camelKey?: string
): unknown => {
  for (const summary of summaries) {
    const value = valueForKey(summary, snakeKey, camelKey);
    if (value !== null && value !== undefined) return value;
  }
  return null;
};

const compactSummaryForAi = (summary: Record<string, unknown> | null) => {
  if (!summary) return null;
  return {
    caloriesLogged: numberOrNull(valueForKey(summary, "calories_logged", "caloriesLogged")),
    proteinLogged: numberOrNull(valueForKey(summary, "protein_logged", "proteinLogged")),
    mealsLogged: numberOrNull(valueForKey(summary, "meals_logged", "mealsLogged")),
    workoutMinutes: numberOrNull(valueForKey(summary, "workout_minutes", "workoutMinutes")),
    steps: numberOrNull(valueForKey(summary, "steps")),
    sleepHours: numberOrNull(valueForKey(summary, "sleep_hours", "sleepHours")),
    hydrationMl: numberOrNull(valueForKey(summary, "hydration_ml", "hydrationMl")),
    faceScanDone: valueForKey(summary, "face_scan_done", "faceScanDone") === true,
    bodyScanDone: valueForKey(summary, "body_scan_done", "bodyScanDone") === true,
    faceOverallScore: numberOrNull(valueForKey(summary, "face_overall_score", "faceOverallScore")),
    bodyPostureScore: numberOrNull(valueForKey(summary, "body_posture_score", "bodyPostureScore")),
    bodyDefinitionScore: numberOrNull(
      valueForKey(summary, "body_definition_score", "bodyDefinitionScore")
    ),
    bodyFatRangeEstimate: stringOrNull(
      valueForKey(summary, "body_fat_range_estimate", "bodyFatRangeEstimate")
    ),
    nutritionSignalLabel: stringOrNull(
      valueForKey(summary, "nutrition_signal_label", "nutritionSignalLabel")
    ),
    nutritionSuggestion: stringOrNull(
      valueForKey(summary, "nutrition_suggestion", "nutritionSuggestion")
    ),
  };
};

const buildCrossAppContext = (input: PersonalizeCoachNudgeInput) => {
  const calorieTarget = numberOrNull(valueForKey(input.profile, "calorie_target", "calorieTarget"));
  const proteinTarget = numberOrNull(valueForKey(input.profile, "protein_target", "proteinTarget"));
  const yesterdayCalories = numberOrNull(
    valueForKey(input.yesterday, "calories_logged", "caloriesLogged")
  );
  const yesterdayProtein = numberOrNull(
    valueForKey(input.yesterday, "protein_logged", "proteinLogged")
  );
  const latestNutritionSignal = stringOrNull(
    latestValue(input.recentSummaries, "nutrition_signal_label", "nutritionSignalLabel")
  );
  const latestNutritionSuggestion = stringOrNull(
    latestValue(input.recentSummaries, "nutrition_suggestion", "nutritionSuggestion")
  );

  return {
    fitmacroNutrition: {
      hasLoggedNutrition: yesterdayCalories !== null || yesterdayProtein !== null,
      calorieTarget,
      proteinTarget,
      yesterdayCalorieGap:
        calorieTarget !== null && yesterdayCalories !== null
          ? Math.round(calorieTarget - yesterdayCalories)
          : null,
      yesterdayProteinGap:
        proteinTarget !== null && yesterdayProtein !== null
          ? Number((proteinTarget - yesterdayProtein).toFixed(1))
          : null,
      micronutrientSuggestion: input.micronutrientSuggestion ?? null,
    },
    fitfaceRecoveryAndScan: {
      hasFitfaceSignals: input.recentSummaries.some(
        (summary) =>
          valueForKey(summary, "fitface_updated_at", "fitfaceUpdatedAt") != null ||
          valueForKey(summary, "face_scan_done", "faceScanDone") === true ||
          valueForKey(summary, "body_scan_done", "bodyScanDone") === true ||
          numberOrNull(valueForKey(summary, "sleep_hours", "sleepHours")) !== null ||
          numberOrNull(valueForKey(summary, "workout_minutes", "workoutMinutes")) !== null
      ),
      latestFaceOverallScore: numberOrNull(
        latestValue(input.recentSummaries, "face_overall_score", "faceOverallScore")
      ),
      latestBodyPostureScore: numberOrNull(
        latestValue(input.recentSummaries, "body_posture_score", "bodyPostureScore")
      ),
      latestBodyDefinitionScore: numberOrNull(
        latestValue(input.recentSummaries, "body_definition_score", "bodyDefinitionScore")
      ),
      latestBodyFatRangeEstimate: stringOrNull(
        latestValue(input.recentSummaries, "body_fat_range_estimate", "bodyFatRangeEstimate")
      ),
      latestNutritionSignal,
      latestNutritionSuggestion,
    },
    bridgeRules: [
      "Use FitMacro facts for meals, calories, protein, and micronutrients.",
      "Use FitFace facts for scan, workout, recovery, sleep, steps, hydration, and body composition signals.",
      "When both apps have data, connect them in one action instead of giving two separate recommendations.",
    ],
  };
};

export async function personalizeCoachNudge(
  input: PersonalizeCoachNudgeInput
): Promise<PersonalizedCoachNudge> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[AI coach nudge] using deterministic fallback: OPENAI_API_KEY is missing");
    return { nudge: input.fallback, personalizedByAi: false, model: null };
  }

  const model = process.env.OPENAI_COACH_MODEL?.trim() || "gpt-4o-mini";
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
        max_output_tokens: 220,
        instructions: [
          "You write one concise mobile push notification for a healthy-aging, nutrition, and recovery coach.",
          "The deterministic fallback already chose the safe action. Rewrite it to sound personal and specific, but do not change its recommendation, destination, or any numbers.",
          "Use only supplied facts. Never diagnose, prescribe treatment, shame the user, promise outcomes, or invent measurements.",
          "Frame the message around sustainable energy, recovery, strength, nutrition, and consistency without claiming to reverse aging.",
          "Mention a FitFace recovery, scan, or body composition signal only when it is present in the supplied data.",
          "Use FitMacro nutrition facts and FitFace recovery or scan facts together when both are present. Example: if protein is low and a body workout was done, suggest a protein-forward meal; if sleep is low, make the training or nutrition action lighter and practical.",
          "Mention micronutrients only when a micronutrientSuggestion is supplied, and keep it food-based rather than medical.",
          "For a daily morning review, clearly connect yesterday's supplied facts to one practical action for today.",
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
          crossAppContext: buildCrossAppContext(input),
          today: compactSummaryForAi(input.today),
          yesterday: compactSummaryForAi(input.yesterday),
          recentSummaries: input.recentSummaries.slice(0, 7).map(compactSummaryForAi),
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
      const errorBody = await response.text().catch(() => "");
      console.warn(
        `[AI coach nudge] OpenAI request failed (${response.status}): ${errorBody.slice(0, 500)}`
      );
      return { nudge: input.fallback, personalizedByAi: false, model };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const outputText = extractOutputText(payload);
    if (!outputText) {
      console.warn("[AI coach nudge] using deterministic fallback: model returned no text", {
        model,
      });
      return { nudge: input.fallback, personalizedByAi: false, model };
    }

    const parsed = aiCoachTextSchema.safeParse(JSON.parse(outputText));
    if (!parsed.success) {
      console.warn("[AI coach nudge] using deterministic fallback: invalid model output", {
        model,
      });
      return { nudge: input.fallback, personalizedByAi: false, model };
    }
    if (!preservesKnownNumbers(input.fallback, parsed.data.title, parsed.data.body)) {
      console.warn("[AI coach nudge] using deterministic fallback: model changed a number", {
        model,
      });
      return { nudge: input.fallback, personalizedByAi: false, model };
    }

    console.info("[AI coach nudge] personalization succeeded", {
      locale,
      model,
      nudgeType: input.fallback.type,
      sourceApp: input.sourceApp,
    });
    return {
      nudge: {
        ...input.fallback,
        title: parsed.data.title,
        body: parsed.data.body,
      },
      personalizedByAi: true,
      model,
    };
  } catch (error) {
    console.warn("[AI coach nudge] personalization failed", error);
    return { nudge: input.fallback, personalizedByAi: false, model };
  } finally {
    clearTimeout(timeout);
  }
}
