export type Goal = "fat_loss" | "maintenance" | "muscle_gain" | "recomp";
export type Sex = "male" | "female";
export type ActivityLevel = "low" | "moderate" | "high";
export type Units = "metric" | "imperial";
export type SummarySource = "fitmacro" | "fitface";
export type PrimaryFocus = "body_composition" | "looks" | "longevity" | "maintenance";
export type SecondaryFocus =
  | "nutrition"
  | "recovery"
  | "training"
  | "skin"
  | "muscle"
  | "consistency";
export type ExperienceLevel = "beginner" | "intermediate" | "advanced";
export type TimeConstraint = "low" | "moderate" | "high";

export type EcosystemUser = {
  ecosystemUserId: string;
  fitmacroUid: string | null;
  fitfaceUid: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EcosystemProfile = {
  ecosystemUserId: string;
  goal: Goal;
  age: number | null;
  sex: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  targetWeightKg: number | null;
  activityLevel: ActivityLevel | null;
  workoutDaysPerWeek: number | null;
  calorieTarget: number | null;
  proteinTarget: number | null;
  primaryFocus: PrimaryFocus | null;
  secondaryFocus: SecondaryFocus | null;
  experience: ExperienceLevel | null;
  timeConstraint: TimeConstraint | null;
  units: Units;
  timezone: string;
  createdAt: string;
  updatedAt: string;
};

export type EcosystemDailySummary = {
  ecosystemUserId: string;
  date: string;
  caloriesLogged: number | null;
  proteinLogged: number | null;
  mealsLogged: number | null;
  workoutMinutes: number | null;
  steps: number | null;
  sleepHours: number | null;
  hydrationMl: number | null;
  sodiumMg: number | null;
  faceScanDone: boolean | null;
  bodyScanDone: boolean | null;
  faceOverallScore: number | null;
  bodyPostureScore: number | null;
  bodyDefinitionScore: number | null;
  bodyFatRangeEstimate: string | null;
  nutritionSignalLabel: string | null;
  nutritionSuggestion: string | null;
  fitmacroUpdatedAt: string | null;
  fitfaceUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Nudge = {
  type: string;
  message: string;
};

export type RecommendedApp = "fitmacro" | "fitface" | "either";

export type CoachPrimaryAction = {
  title: string;
  detail: string;
  recommendedApp: RecommendedApp;
  ctaLabel: string;
  routeHint: "nutrition" | "recovery" | "training" | "scan" | "consistency";
  destinationKey:
    | "meal_plan"
    | "meal_history"
    | "coach_hub"
    | "daily_tracking"
    | "ai_health_coach"
    | "face_workout"
    | "body_workout"
    | "home";
  destinationLabel: string;
};

export type WeeklyMomentum = "building" | "steady" | "slipping";

export type EcosystemWeeklyReview = {
  bestHabit: string;
  weakestHabit: string;
  weeklyMomentum: WeeklyMomentum;
  nextWeekFocus: string;
};
