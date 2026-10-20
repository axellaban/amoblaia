begin;
create table if not exists public.contact_requests (
 id uuid primary key default gen_random_uuid(), kind text not null,
 email text not null, message text not null, rate_key text not null,
 created_at timestamptz not null default now(), status text not null default 'new'
);
alter table public.contact_requests enable row level security;
revoke all on public.contact_requests from anon,authenticated;
grant all on public.contact_requests to service_role;
create index if not exists contact_requests_rate on public.contact_requests(rate_key,created_at);
create or replace function public.amobla_contact(p_kind text,p_email text,p_message text,p_rate_key text)
 returns uuid language plpgsql security definer set search_path=public as $$
declare ticket uuid;
begin
 perform pg_advisory_xact_lock(hashtext(p_rate_key));
 if (select count(*) from contact_requests where rate_key=p_rate_key and created_at>now()-interval '1 hour')>=5 then raise exception 'CONTACT_LIMIT'; end if;
 select id into ticket from contact_requests where email=p_email and kind=p_kind and message=p_message and created_at>now()-interval '1 day' limit 1;
 if ticket is not null then return ticket; end if;
 insert into contact_requests(kind,email,message,rate_key) values(p_kind,p_email,p_message,p_rate_key) returning id into ticket;
 return ticket;
end $$;
revoke all on function public.amobla_contact(text,text,text,text) from public,anon,authenticated;
grant execute on function public.amobla_contact(text,text,text,text) to service_role;
commit;
