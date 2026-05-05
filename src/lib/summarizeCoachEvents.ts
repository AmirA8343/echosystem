import type { CoachEvent, CoachFollowThroughSummary } from "../types.js";

export function summarizeCoachEvents(events: CoachEvent[]): CoachFollowThroughSummary {
  const summary: CoachFollowThroughSummary = {
    viewedBriefs: 0,
    actionOpens: 0,
    mealsLogged: 0,
    scansCompleted: 0,
    workoutsOpened: 0,
    aiChatsSent: 0,
    lastEventAt: events[0]?.createdAt ?? null,
    adherence: "unknown",
  };

  for (const event of events) {
    if (event.eventType === "brief_viewed") summary.viewedBriefs += 1;
    if (event.eventType === "brief_action_opened") summary.actionOpens += 1;
    if (event.eventType === "meal_logged") summary.mealsLogged += 1;
    if (event.eventType === "scan_completed") summary.scansCompleted += 1;
    if (event.eventType === "workout_opened") summary.workoutsOpened += 1;
    if (event.eventType === "ai_chat_sent") summary.aiChatsSent += 1;
  }

  const actedEvents =
    summary.actionOpens + summary.mealsLogged + summary.scansCompleted + summary.workoutsOpened;
  if (events.length === 0) {
    summary.adherence = "unknown";
  } else if (summary.mealsLogged >= 5 || actedEvents >= 6) {
    summary.adherence = "strong";
  } else if (summary.mealsLogged >= 2 || actedEvents >= 2) {
    summary.adherence = "mixed";
  } else {
    summary.adherence = "low";
  }

  return summary;
}
