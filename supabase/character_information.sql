-- One row per employee: their Office Floor Sim character look (body/gender, skin, hair, clothes, accessories...).
-- Written and read only by the app's server (server/), which uses the secret key.
create table public.character_information (
  user_id uuid not null,
  character_data jsonb not null,
  updated_at timestamp without time zone not null default now(),
  constraint pk_character_information primary key (user_id),
  constraint fk_character_information_employee foreign key (user_id)
    references public.employees (user_id) on delete cascade
);

-- Row Level Security on with no policies: browsers (anon key) can't touch it; the server's secret key can.
alter table public.character_information enable row level security;
