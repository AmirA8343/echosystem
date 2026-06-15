import type {
  CoachBrief,
  CoachPrimaryAction,
  EcosystemWeeklyReview,
  LocalizedMessage,
} from "../types.js";

const message = (
  key: string,
  params?: Record<string, string | number>
): LocalizedMessage => (params ? { key, params } : { key });

const exactMessage = (
  value: string,
  keys: Record<string, string>
): LocalizedMessage | null => (keys[value] ? message(keys[value]) : null);

export function getPrimaryActionMessages(action: CoachPrimaryAction) {
  const titleMessage = exactMessage(action.title, {
    "Close your protein gap": "coach.action.closeProteinGap.title",
    "Log your next meal": "coach.action.logNextMeal.title",
    "Refresh your visual baseline": "coach.action.refreshVisualBaseline.title",
    "Recover harder tonight": "coach.action.recoverTonight.title",
    "Finish hydration and movement": "coach.action.finishHydrationMovement.title",
    "Get movement on the board": "coach.action.getMovement.title",
    "Keep the ecosystem streak alive": "coach.action.keepStreak.title",
  });

  const proteinMatch = action.detail.match(
    /^Open FitMacro and add (\d+(?:\.\d+)?)g protein to support recovery and lean-body goals\.$/
  );
  const sleepMatch = action.detail.match(
    /^Open FitFace AI and prioritize sleep recovery after only (\d+(?:\.\d+)?) hours\.$/
  );
  const detailMessage = proteinMatch
    ? message("coach.action.closeProteinGap.detail", { grams: proteinMatch[1] })
    : sleepMatch
      ? message("coach.action.recoverTonight.detail", { hours: sleepMatch[1] })
      : exactMessage(action.detail, {
          "Open FitMacro and finish nutrition logging before the day slips off target.":
            "coach.action.logNextMeal.detail",
          "Open FitFace AI and run a face or body scan so appearance-focused coaching stays current.":
            "coach.action.refreshVisualBaseline.appearanceDetail",
          "Open FitFace AI and finish hydration plus a short walk to reduce fatigue and puffiness.":
            "coach.action.finishHydrationMovement.detail",
          "Open FitFace AI and complete today’s session or a short walk block.":
            "coach.action.getMovement.detail",
          "Open FitFace AI and run a face or body scan to keep progress tracking honest.":
            "coach.action.refreshVisualBaseline.trackingDetail",
          "Both apps are aligned today. Check in once more tonight and keep consistency high.":
            "coach.action.keepStreak.detail",
        });

  return { titleMessage, detailMessage };
}

export function getWeeklyReviewMessages(review: EcosystemWeeklyReview) {
  const keys: Record<string, string> = {
    "No synced habit pattern is clear yet.": "coach.weekly.bestHabit.none",
    "Nutrition adherence held up best this week.": "coach.weekly.bestHabit.nutrition",
    "Movement consistency was your strongest habit this week.": "coach.weekly.bestHabit.movement",
    "Recovery basics were the most stable habit this week.": "coach.weekly.bestHabit.recovery",
    "Visual tracking cadence stayed active this week.": "coach.weekly.bestHabit.scans",
    "Daily summaries are missing, so the coach cannot judge the week yet.":
      "coach.weekly.weakestHabit.noData",
    "Scan cadence was weakest. Keep face or body tracking active.":
      "coach.weekly.weakestHabit.scans",
    "Recovery consistency slipped this week.": "coach.weekly.weakestHabit.recovery",
    "Movement consistency was the weakest habit this week.":
      "coach.weekly.weakestHabit.movement",
    "Nutrition adherence was the weakest habit this week.":
      "coach.weekly.weakestHabit.nutrition",
    "Sync meals, sleep, steps, hydration, and scans so weekly target changes are based on real behavior.":
      "coach.weekly.focus.syncData",
    "Tighten protein and meal completion earlier in the day.":
      "coach.weekly.focus.nutrition",
    "Add one short daily walk or training block to keep circulation high.":
      "coach.weekly.focus.movement",
    "Protect sleep and hydration before chasing harder training.":
      "coach.weekly.focus.recovery",
    "Refresh face or body scans on schedule so the coach can track visible change.":
      "coach.weekly.focus.scans",
    "Weekly targets cannot adapt until calorie and protein targets are synced from FitMacro.":
      "coach.weekly.adjustment.targetsMissing",
    "Keep targets stable this week; the coach needs more logged meals, recovery data, and follow-through before changing goals.":
      "coach.weekly.adjustment.moreData",
    "Targets are not the bottleneck yet. Complete more suggested actions before changing calories.":
      "coach.weekly.adjustment.followThrough",
    "Protein averaged below target on logged days, so raise the protein target before increasing calories.":
      "coach.weekly.adjustment.raiseProtein",
    "Logged calories averaged above target; improve adherence before lowering the calorie target.":
      "coach.weekly.adjustment.improveAdherence",
    "Recovery and follow-through are strong enough for a small weekly deficit push.":
      "coach.weekly.adjustment.smallDeficit",
    "Logging and recovery are stable, so a small lean-gain calorie increase is reasonable.":
      "coach.weekly.adjustment.leanGain",
    "Current weekly targets look appropriate; keep collecting data before changing goals.":
      "coach.weekly.adjustment.hold",
  };

  return {
    bestHabitMessage: exactMessage(review.bestHabit, keys),
    weakestHabitMessage: exactMessage(review.weakestHabit, keys),
    nextWeekFocusMessage: exactMessage(review.nextWeekFocus, keys),
    targetAdjustmentReasonMessage: exactMessage(review.targetAdjustment.reason, keys),
  };
}

function getBriefTextMessage(text: string): LocalizedMessage | null {
  const proteinMatch = text.match(/^Add about (\d+)g protein today using /);
  if (proteinMatch) {
    return message("coach.brief.food.proteinGap.detail", { grams: proteinMatch[1] });
  }
  const sleepMatch = text.match(
    /^Sleep is low at (\d+(?:\.\d+)?)h; avoid pushing the deficit harder today\.$/
  );
  if (sleepMatch) {
    return message("coach.brief.adjustment.lowSleep", { hours: sleepMatch[1] });
  }

  return exactMessage(text, {
    "Targets are missing, so the coach is staying conservative.":
      "coach.brief.adjustment.targetsMissing",
    "Not enough synced history yet to safely adjust calories.":
      "coach.brief.adjustment.moreHistory",
    "Follow-through is still low, so the coach is keeping targets stable and focusing on one completed action first.":
      "coach.brief.adjustment.followThrough",
    "Recent intake is already above target, so execution matters more than lowering calories.":
      "coach.brief.adjustment.executionFirst",
    "Protein has been under target; improve protein before adding more calories.":
      "coach.brief.adjustment.proteinFirst",
    "Recovery looks stable and logging confidence is high, so a small deficit push is reasonable.":
      "coach.brief.adjustment.smallDeficit",
    "Current targets look reasonable for today.": "coach.brief.adjustment.hold",
    "Recovery meal, not a crash diet": "coach.brief.food.recovery.title",
    "Choose a protein-forward meal with slow carbs: eggs or Greek yogurt with oats and fruit, or chicken/rice/vegetables.":
      "coach.brief.food.recovery.detail",
    "Low sleep raises hunger and lowers training readiness, so today needs steady fuel and high protein.":
      "coach.brief.food.recovery.reason",
    "Lower-sodium reset": "coach.brief.food.lowSodium.title",
    "Keep the next meal simple: lean protein, potatoes or rice, fruit, and water. Avoid salty sauces and late packaged food.":
      "coach.brief.food.lowSodium.detail",
    "Higher sodium can mask progress through water retention and puffiness.":
      "coach.brief.food.lowSodium.reason",
    "Close the protein gap": "coach.brief.food.proteinGap.title",
    "Protein is the most useful nutrition lever for body composition and recovery.":
      "coach.brief.food.proteinGap.reason",
    "Lean-gain support": "coach.brief.food.leanGain.title",
    "Pair protein with carbs around training: rice, oats, potatoes, fruit, or bread with a lean protein source.":
      "coach.brief.food.leanGain.detail",
    "Muscle gain needs training fuel and enough protein, not just higher calories.":
      "coach.brief.food.leanGain.reason",
    "Stay on-plan": "coach.brief.food.onPlan.title",
    "Build the next meal around protein, colorful produce, and one controlled carb or fat source.":
      "coach.brief.food.onPlan.detail",
    "A simple balanced meal keeps the day on track without overcorrecting.":
      "coach.brief.food.onPlan.reason",
    "Keep training light": "coach.brief.training.light.title",
    "Use walking, mobility, or an easy pump session. Avoid max effort work today.":
      "coach.brief.training.light.detail",
    "Recovery is limited, so consistency beats intensity.":
      "coach.brief.training.light.reason",
    "Move before the day closes": "coach.brief.training.move.title",
    "Do a 20-30 minute walk or a short body session.":
      "coach.brief.training.move.detail",
    "Low movement weakens calorie control, circulation, and recovery.":
      "coach.brief.training.move.reason",
    "Training is available": "coach.brief.training.available.title",
    "If energy is normal, complete the planned body session. If not, keep a brisk walk as the minimum.":
      "coach.brief.training.available.detail",
    "Your recovery signals do not require backing off today.":
      "coach.brief.training.available.reason",
  });
}

export function getCoachBriefMessages(brief: CoachBrief) {
  return {
    adjustmentReasonMessage: getBriefTextMessage(brief.adjustment.reason),
    foodSuggestionMessages: {
      title: getBriefTextMessage(brief.foodSuggestion.title),
      detail: getBriefTextMessage(brief.foodSuggestion.detail),
      reason: getBriefTextMessage(brief.foodSuggestion.reason),
    },
    trainingSuggestionMessages: {
      title: getBriefTextMessage(brief.trainingSuggestion.title),
      detail: getBriefTextMessage(brief.trainingSuggestion.detail),
      reason: getBriefTextMessage(brief.trainingSuggestion.reason),
    },
  };
}
