import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { personalizeCoachNudge, type PersonalizedCoachNudge } from "../lib/aiCoachNudge.js";
import { buildDailyMorningReview } from "../lib/dailyMorningCoach.js";
import { getLocalDateKey } from "../lib/date.js";
import { deriveMicronutrientCoachSuggestion } from "../lib/micronutrientCoach.js";

const querySchema = z.object({
  ecosystemUserId: z.string().uuid(),
  sourceApp: z.enum(["fitmacro", "fitface"]).default("fitmacro"),
  locale: z.string().trim().min(2).max(16).optional(),
});

type CacheEntry = {
  contextHash: string;
  expiresAt: number;
  personalized: PersonalizedCoachNudge;
  rescuePlan: DailyRescuePlan;
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

type DailyRescuePlan = {
  status: "on_track" | "tight" | "over_target" | "protein_rescue";
  title: string;
  message: string;
  mealSuggestion?: {
    title: string;
    items: string[];
    note: string;
    personalizedByAi: boolean;
  } | null;
  nextMealCalories: number;
  nextMealProtein: number;
  movementMinutes: number;
  remainingCalories: number;
  remainingProtein: number;
  activeEnergyKcal: number | null;
  tomorrowNote: string;
} | null;

const rescuePlanAiSchema = z.object({
  title: z.string().trim().min(4).max(70),
  message: z.string().trim().min(20).max(260),
  mealSuggestion: z.object({
    title: z.string().trim().min(4).max(70),
    items: z.array(z.string().trim().min(2).max(70)).min(2).max(4),
    note: z.string().trim().min(10).max(180),
  }),
  tomorrowNote: z.string().trim().min(10).max(180),
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

const normalizeLocale = (locale?: string | null): string => {
  const value = String(locale ?? "en").trim();
  if (localeNames[value]) return value;
  const base = value.split("-")[0];
  return localeNames[base] ? base : "en";
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

const extractNumbers = (value: string): Set<string> =>
  new Set(value.match(/\d+(?:[.,]\d+)?/g) ?? []);

const rescuePlanPreservesNumbers = (
  fallback: NonNullable<DailyRescuePlan>,
  generated: z.infer<typeof rescuePlanAiSchema>
): boolean => {
  const allowed = extractNumbers(JSON.stringify(fallback));
  const outputNumbers = extractNumbers(JSON.stringify(generated));
  return [...outputNumbers].every((number) => allowed.has(number));
};

const positiveNumberOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const stringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const firstNumberOrNull = (
  primary: Record<string, unknown> | null,
  secondary: Record<string, unknown> | null,
  key: string
): number | null => positiveNumberOrNull(primary?.[key]) ?? positiveNumberOrNull(secondary?.[key]);

const firstStringOrNull = (
  primary: Record<string, unknown> | null,
  secondary: Record<string, unknown> | null,
  key: string
): string | null => stringOrNull(primary?.[key]) ?? stringOrNull(secondary?.[key]);

const firstBooleanOrNull = (
  primary: Record<string, unknown> | null,
  secondary: Record<string, unknown> | null,
  key: string
): boolean | null => {
  const value = primary?.[key] ?? secondary?.[key];
  return typeof value === "boolean" ? value : null;
};

const buildDailyRescuePlan = (
  profile: Record<string, unknown> | null,
  summary: Record<string, unknown> | null
): DailyRescuePlan => {
  if (!summary) return null;

  const calorieTarget = positiveNumberOrNull(profile?.calorie_target);
  const proteinTarget = positiveNumberOrNull(profile?.protein_target);
  const caloriesLogged = positiveNumberOrNull(summary.calories_logged) ?? 0;
  const proteinLogged = positiveNumberOrNull(summary.protein_logged) ?? 0;
  const activeEnergyKcal = positiveNumberOrNull(summary.active_energy_kcal);
  if (!calorieTarget && !proteinTarget) return null;
  if (caloriesLogged <= 0 && proteinLogged <= 0) return null;

  const movementCredit = activeEnergyKcal ? Math.min(activeEnergyKcal, 300) : 0;
  const effectiveCalorieTarget = (calorieTarget ?? 0) + movementCredit;
  const remainingCalories =
    calorieTarget !== null ? Math.round(effectiveCalorieTarget - caloriesLogged) : 0;
  const remainingProtein =
    proteinTarget !== null ? Math.round(proteinTarget - proteinLogged) : 0;
  const proteinRescueNeeded = proteinTarget !== null && remainingProtein >= 25;
  const isOverTarget = calorieTarget !== null && remainingCalories < -100;
  const isTight = calorieTarget !== null && remainingCalories >= -100 && remainingCalories < 350;

  if (!isOverTarget && !isTight && !proteinRescueNeeded) return null;

  const nextMealProtein = Math.max(25, Math.min(45, Math.max(remainingProtein, 25)));
  const nextMealCalories = isOverTarget
    ? 350
    : isTight
      ? Math.max(300, Math.min(450, remainingCalories + 100))
      : Math.max(350, Math.min(600, Math.round(Math.max(remainingCalories, 450) * 0.45)));
  const movementMinutes = isOverTarget ? 20 : isTight ? 15 : 10;
  const tomorrowNote =
    "Tomorrow returns to the normal target. Do not punish today with a crash diet.";

  if (isOverTarget) {
    return {
      status: "over_target",
      title: "Rescue the day, do not restart it",
      message: `You are about ${Math.abs(remainingCalories)} kcal over the adjusted target. Keep the next meal calm: lean protein, vegetables or fruit, water, and no extra snacking.`,
      nextMealCalories,
      nextMealProtein,
      movementMinutes,
      remainingCalories,
      remainingProtein: Math.max(0, remainingProtein),
      activeEnergyKcal,
      tomorrowNote,
    };
  }

  if (isTight) {
    return {
      status: "tight",
      title: "Keep the landing clean",
      message: "Calories are tight, but the day is still controllable. Use one simple protein-forward meal and a short walk instead of skipping food.",
      nextMealCalories,
      nextMealProtein,
      movementMinutes,
      remainingCalories,
      remainingProtein: Math.max(0, remainingProtein),
      activeEnergyKcal,
      tomorrowNote,
    };
  }

  return {
    status: "protein_rescue",
    title: "Protein can still save the day",
    message: `You still need about ${Math.max(0, remainingProtein)}g protein. Make the next meal protein-first, with calories controlled around appetite.`,
    nextMealCalories,
    nextMealProtein,
    movementMinutes,
    remainingCalories,
    remainingProtein: Math.max(0, remainingProtein),
    activeEnergyKcal,
    tomorrowNote,
  };
};

const personalizeDailyRescuePlan = async (input: {
  rescuePlan: DailyRescuePlan;
  locale?: string | null;
  profile: Record<string, unknown> | null;
  today: Record<string, unknown> | null;
  yesterday: Record<string, unknown> | null;
}): Promise<DailyRescuePlan> => {
  if (!input.rescuePlan) return null;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return input.rescuePlan;

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
        max_output_tokens: 360,
        instructions: [
          "You personalize a Day Rescue card for a nutrition and healthy-aging coach.",
          "The backend already calculated the safe calorie, protein, movement, and remaining-target numbers. Do not change those numbers or create new numeric targets.",
          "Rewrite the title, message, tomorrowNote, and add one practical mealSuggestion that fits the provided nextMealCalories and nextMealProtein.",
          "The meal idea must be normal food, not medical advice. Do not shame the user. Do not suggest fasting, crash dieting, detoxes, supplements, medications, or treating disease.",
          "Use only supplied facts. If active energy or steps are low, make the movement suggestion gentle.",
          "Avoid adding numbers unless they exactly appear in the supplied rescuePlan.",
          `Write in ${localeNames[locale]}. Keep it concise for a mobile card.`,
        ].join(" "),
        input: JSON.stringify({
          rescuePlan: input.rescuePlan,
          profile: input.profile,
          today: input.today,
          yesterday: input.yesterday,
        }),
        text: {
          format: {
            type: "json_schema",
            name: "daily_rescue_plan",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                message: { type: "string" },
                mealSuggestion: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    items: {
                      type: "array",
                      items: { type: "string" },
                      minItems: 2,
                      maxItems: 4,
                    },
                    note: { type: "string" },
                  },
                  required: ["title", "items", "note"],
                  additionalProperties: false,
                },
                tomorrowNote: { type: "string" },
              },
              required: ["title", "message", "mealSuggestion", "tomorrowNote"],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.warn(
        `[AI daily rescue] OpenAI request failed (${response.status}): ${errorBody.slice(0, 500)}`
      );
      return input.rescuePlan;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const outputText = extractOutputText(payload);
    if (!outputText) {
      console.warn("[AI daily rescue] using deterministic rescue: model returned no text", {
        model,
      });
      return input.rescuePlan;
    }

    const parsed = rescuePlanAiSchema.safeParse(JSON.parse(outputText));
    if (!parsed.success || !rescuePlanPreservesNumbers(input.rescuePlan, parsed.data)) {
      console.warn("[AI daily rescue] using deterministic rescue: invalid model output", {
        model,
      });
      return input.rescuePlan;
    }

    console.info("[AI daily rescue] personalization succeeded", {
      locale,
      model,
      status: input.rescuePlan.status,
    });
    return {
      ...input.rescuePlan,
      title: parsed.data.title,
      message: parsed.data.message,
      mealSuggestion: {
        ...parsed.data.mealSuggestion,
        personalizedByAi: true,
      },
      tomorrowNote: parsed.data.tomorrowNote,
    };
  } catch (error) {
    console.warn("[AI daily rescue] personalization failed", error);
    return input.rescuePlan;
  } finally {
    clearTimeout(timeout);
  }
};

export async function registerDailyCoachRoutes(app: FastifyInstance) {
  app.get("/v1/ecosystem/daily-coach", async (request, reply) => {
    const query = querySchema.parse(request.query ?? {});
    const [userResult, profileResult] = await Promise.all([
      pool.query(
        `select ecosystem_user_id from ecosystem_users where ecosystem_user_id = $1 limit 1`,
        [query.ecosystemUserId]
      ),
      pool.query(
        `select * from ecosystem_profiles where ecosystem_user_id = $1 limit 1`,
        [query.ecosystemUserId]
      ),
    ]);

    if (!userResult.rows[0]) {
      return reply.code(404).send({ error: "User not found." });
    }

    const profile = (profileResult.rows[0] as Record<string, unknown> | undefined) ?? null;
    const timezone = String(profile?.timezone ?? "America/Toronto");
    const todayDate = getLocalDateKey(timezone);
    const yesterdayDate = getLocalDateKey(
      timezone,
      new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    const [todayResult, yesterdayResult, recentResult] = await Promise.all([
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1 and date = $2::date limit 1`,
        [query.ecosystemUserId, todayDate]
      ),
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1 and date = $2::date limit 1`,
        [query.ecosystemUserId, yesterdayDate]
      ),
      pool.query(
        `select * from ecosystem_daily_summaries
         where ecosystem_user_id = $1 order by date desc limit 7`,
        [query.ecosystemUserId]
      ),
    ]);

    const today = (todayResult.rows[0] as Record<string, unknown> | undefined) ?? null;
    const yesterday =
      (yesterdayResult.rows[0] as Record<string, unknown> | undefined) ?? null;
    const recentSummaries = recentResult.rows as Record<string, unknown>[];
    const micronutrientSuggestion = deriveMicronutrientCoachSuggestion({
      ecosystemUserId: query.ecosystemUserId,
      profile,
      summaries: recentSummaries,
    });
    const fallback = buildDailyMorningReview({
      sourceApp: query.sourceApp,
      profile,
      today,
      yesterday,
    });
    const baseRescuePlan = buildDailyRescuePlan(profile, today);
    const locale = query.locale ?? "en";
    const contextHash = createHash("sha256")
      .update(
        JSON.stringify({
          profile,
          today,
          yesterday,
          fallback,
          baseRescuePlan,
          locale,
          micronutrientSuggestion,
        })
      )
      .digest("hex");
    const cacheKey = `${query.ecosystemUserId}:${query.sourceApp}:${locale}`;
    const cached = cache.get(cacheKey);
    let personalized: PersonalizedCoachNudge;
    let rescuePlan: DailyRescuePlan;
    let cacheHit = false;

    if (cached && cached.contextHash === contextHash && cached.expiresAt > Date.now()) {
      personalized = cached.personalized;
      rescuePlan = cached.rescuePlan;
      cacheHit = true;
    } else {
      [personalized, rescuePlan] = await Promise.all([
        personalizeCoachNudge({
          fallback,
          sourceApp: query.sourceApp,
          locale,
          profile,
          today,
          yesterday,
          recentSummaries,
          micronutrientSuggestion,
        }),
        personalizeDailyRescuePlan({
          rescuePlan: baseRescuePlan,
          locale,
          profile,
          today,
          yesterday,
        }),
      ]);
      if (personalized.personalizedByAi) {
        if (cache.size >= 500) cache.clear();
        cache.set(cacheKey, {
          contextHash,
          expiresAt: Date.now() + CACHE_TTL_MS,
          personalized,
          rescuePlan,
        });
      } else {
        cache.delete(cacheKey);
      }
    }

    const sleepHours = firstNumberOrNull(today, yesterday, "sleep_hours");
    const caloriesLogged = firstNumberOrNull(today, yesterday, "calories_logged");
    const proteinLogged = firstNumberOrNull(today, yesterday, "protein_logged");
    const hydrationMl = firstNumberOrNull(today, yesterday, "hydration_ml");
    const activeEnergyKcal = firstNumberOrNull(today, yesterday, "active_energy_kcal");
    const steps = firstNumberOrNull(today, yesterday, "steps");
    const workoutMinutes = firstNumberOrNull(today, yesterday, "workout_minutes");
    const hasFitmacroNutrition =
      positiveNumberOrNull(yesterday?.calories_logged) !== null ||
      positiveNumberOrNull(yesterday?.protein_logged) !== null ||
      positiveNumberOrNull(today?.calories_logged) !== null ||
      positiveNumberOrNull(today?.protein_logged) !== null;
    const hasFitfaceSignals =
      firstBooleanOrNull(yesterday, today, "face_scan_done") === true ||
      firstBooleanOrNull(yesterday, today, "body_scan_done") === true ||
      firstNumberOrNull(yesterday, today, "sleep_hours") !== null ||
      firstNumberOrNull(yesterday, today, "workout_minutes") !== null ||
      firstNumberOrNull(yesterday, today, "face_overall_score") !== null ||
      firstNumberOrNull(yesterday, today, "body_definition_score") !== null;
    const nutritionSignalLabel = firstStringOrNull(
      yesterday,
      today,
      "nutrition_signal_label"
    );
    const userRef = query.ecosystemUserId.slice(-8);
    app.log.info(
      {
        cached: cacheHit,
        hasFitfaceSignals,
        hasFitmacroNutrition,
        nutritionSignalLabel,
        rescuePlanStatus: rescuePlan?.status ?? null,
        rescuePersonalizedByAi: rescuePlan?.mealSuggestion?.personalizedByAi === true,
        micronutrientCoachingApplied: micronutrientSuggestion !== null,
        personalizedByAi: personalized.personalizedByAi,
        sourceApp: query.sourceApp,
        usedYesterdayData: yesterday !== null,
        userRef,
      },
      "Daily coach prepared"
    );

    return {
      dailyCoach: {
        date: todayDate,
        reviewedDate: yesterdayDate,
        headline: personalized.nudge.title,
        message: personalized.nudge.body,
        personalizedByAi: personalized.personalizedByAi,
        model: personalized.model,
        signals: {
          sleepHours,
          caloriesLogged,
          proteinLogged,
          hydrationMl,
          activeEnergyKcal,
          steps,
          workoutMinutes,
          faceScanDone: firstBooleanOrNull(yesterday, today, "face_scan_done"),
          bodyScanDone: firstBooleanOrNull(yesterday, today, "body_scan_done"),
          faceOverallScore: firstNumberOrNull(yesterday, today, "face_overall_score"),
          bodyPostureScore: firstNumberOrNull(yesterday, today, "body_posture_score"),
          bodyDefinitionScore: firstNumberOrNull(
            yesterday,
            today,
            "body_definition_score"
          ),
          bodyFatRangeEstimate: firstStringOrNull(
            yesterday,
            today,
            "body_fat_range_estimate"
          ),
          nutritionSignalLabel,
          nutritionSuggestion: firstStringOrNull(
            yesterday,
            today,
            "nutrition_suggestion"
          ),
        },
        action: {
          recommendedApp: query.sourceApp,
          destinationKey: query.sourceApp === "fitmacro" ? "meal_plan" : "daily_tracking",
        },
        rescuePlan,
        micronutrientSuggestion,
      },
      cached: cacheHit,
    };
  });
}
