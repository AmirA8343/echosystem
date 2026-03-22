create extension if not exists pgcrypto;

create table if not exists ecosystem_users (
  ecosystem_user_id uuid primary key default gen_random_uuid(),
  fitmacro_uid text unique,
  fitface_uid text unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ecosystem_profiles (
  ecosystem_user_id uuid primary key references ecosystem_users(ecosystem_user_id) on delete cascade,
  goal text not null check (goal in ('fat_loss', 'maintenance', 'muscle_gain', 'recomp')),
  age integer,
  sex text check (sex in ('male', 'female')),
  height_cm numeric(5,2),
  weight_kg numeric(5,2),
  target_weight_kg numeric(5,2),
  activity_level text check (activity_level in ('low', 'moderate', 'high')),
  workout_days_per_week integer,
  calorie_target integer,
  protein_target numeric(6,2),
  primary_focus text check (primary_focus in ('body_composition', 'looks', 'longevity', 'maintenance')),
  secondary_focus text check (secondary_focus in ('nutrition', 'recovery', 'training', 'skin', 'muscle', 'consistency')),
  experience text check (experience in ('beginner', 'intermediate', 'advanced')),
  time_constraint text check (time_constraint in ('low', 'moderate', 'high')),
  units text not null default 'metric' check (units in ('metric', 'imperial')),
  timezone text not null default 'America/Toronto',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ecosystem_daily_summaries (
  ecosystem_user_id uuid not null references ecosystem_users(ecosystem_user_id) on delete cascade,
  date date not null,
  calories_logged integer,
  protein_logged numeric(6,2),
  meals_logged integer,
  workout_minutes integer,
  steps integer,
  sleep_hours numeric(4,2),
  hydration_ml integer,
  sodium_mg integer,
  face_scan_done boolean,
  body_scan_done boolean,
  face_overall_score integer,
  body_posture_score integer,
  body_definition_score integer,
  body_fat_range_estimate text,
  nutrition_signal_label text,
  nutrition_suggestion text,
  fitmacro_updated_at timestamptz,
  fitface_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ecosystem_user_id, date)
);

alter table ecosystem_daily_summaries add column if not exists face_overall_score integer;
alter table ecosystem_daily_summaries add column if not exists body_posture_score integer;
alter table ecosystem_daily_summaries add column if not exists body_definition_score integer;
alter table ecosystem_daily_summaries add column if not exists body_fat_range_estimate text;
alter table ecosystem_daily_summaries add column if not exists nutrition_signal_label text;
alter table ecosystem_daily_summaries add column if not exists nutrition_suggestion text;

create index if not exists idx_ecosystem_users_email on ecosystem_users(email);
create index if not exists idx_daily_summaries_date on ecosystem_daily_summaries(date);
