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

export type LocalizedMessage = {
  key: string;
  params?: Record<string, string | number>;
};

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

export type MicronutrientTotals = {
  fiberG?: number;
  potassiumMg?: number;
  calciumMg?: number;
  ironMg?: number;
  magnesiumMg?: number;
  zincMg?: number;
  vitaminAMcg?: number;
  vitaminCMg?: number;
  vitaminDMcg?: number;
  vitaminEMg?: number;
  vitaminKMcg?: number;
  vitaminB12Mcg?: number;
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
  activeEnergyKcal: number | null;
  sodiumMg: number | null;
  micronutrients?: MicronutrientTotals | null;
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

export type WeeklyTargetAdjustment = {
  confidence: CoachBriefConfidence;
  calorieChange: number;
  proteinChange: number;
  shouldAdjust: boolean;
  reason: string;
  nextCheckInDays: number;
};

export type EcosystemWeeklyReview = {
  bestHabit: string;
  weakestHabit: string;
  weeklyMomentum: WeeklyMomentum;
  nextWeekFocus: string;
  targetAdjustment: WeeklyTargetAdjustment;
};

export type CoachBriefRecoveryState =
  | "low_sleep"
  | "under_recovered"
  | "hydration_low"
  | "sodium_high"
  | "ready"
  | "unknown";

export type CoachBriefConfidence = "low" | "medium" | "high";

export type CoachBriefMacroTargets = {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

export type CoachBriefAdjustment = {
  calorieChange: number;
  proteinChange: number;
  reason: string;
  shouldChangeGoal: boolean;
};

export type CoachBriefSuggestion = {
  title: string;
  detail: string;
  reason: string;
};

export type CoachFollowThroughAdherence = "strong" | "mixed" | "low" | "unknown";

export type CoachFollowThroughSummary = {
  viewedBriefs: number;
  actionOpens: number;
  mealsLogged: number;
  scansCompleted: number;
  workoutsOpened: number;
  aiChatsSent: number;
  lastEventAt: string | null;
  adherence: CoachFollowThroughAdherence;
};

export type CoachBrief = {
  ecosystemUserId: string;
  date: string | null;
  generatedAt: string;
  confidence: CoachBriefConfidence;
  recoveryState: CoachBriefRecoveryState;
  followThrough: CoachFollowThroughSummary;
  todayTargets: CoachBriefMacroTargets;
  adjustment: CoachBriefAdjustment;
  foodSuggestion: CoachBriefSuggestion;
  trainingSuggestion: CoachBriefSuggestion;
  coachMessage: string;
  evidence: string[];
  cautions: string[];
};

export type CoachEventSourceApp = "fitmacro" | "fitface";

export type CoachEventType =
  | "brief_viewed"
  | "brief_action_opened"
  | "meal_logged"
  | "daily_tracking_updated"
  | "scan_completed"
  | "workout_opened"
  | "ai_chat_sent";

export type CoachEvent = {
  id: string;
  ecosystemUserId: string;
  sourceApp: CoachEventSourceApp;
  eventType: CoachEventType;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type PushTokenSourceApp = CoachEventSourceApp;

export type EcosystemPushToken = {
  id: string;
  ecosystemUserId: string;
  sourceApp: PushTokenSourceApp;
  expoPushToken: string;
  platform: "ios" | "android" | "web" | "unknown";
  deviceId: string | null;
  enabled: boolean;
  lastRegisteredAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CoachPushNudge = {
  type: string;
  title: string;
  body: string;
  recommendedApp: "fitmacro" | "fitface" | "either";
  destinationKey:
    | "meal_plan"
    | "meal_history"
    | "coach_hub"
    | "daily_tracking"
    | "ai_health_coach"
    | "face_workout"
    | "body_workout"
    | "home";
};
