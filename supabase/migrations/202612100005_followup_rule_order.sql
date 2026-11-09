create function public.habita_rule_group(p_stage text) returns text
language sql immutable strict set search_path = '' as $$
  select case when p_stage in ('sin-demo','sin-enviar') then 'interesado'
    when p_stage in ('no-abrio','sin-interaccion','sin-cuenta') then 'demo-enviada'
    else p_stage end
$$;

create function public.habita_append_rule() returns trigger
language plpgsql set search_path = '' as $$
declare scope text := public.habita_rule_group(new.stage);
begin
  perform pg_advisory_xact_lock(hashtext('followup-order:' || scope));
  select coalesce(max(position),0)+1 into new.position from public.followup_rules
    where public.habita_rule_group(stage)=scope;
  return new;
end $$;
create trigger followup_append_rule before insert on public.followup_rules
for each row execute function public.habita_append_rule();

create function public.habita_reorder_rules(p_before text[], p_after text[], p_actor uuid)
returns void language plpgsql set search_path = '' as $$
declare scope text; actual text[]; n integer := cardinality(p_before);
begin
  if n is null or n < 1 or n > 1000 or cardinality(p_after) is distinct from n
    or not(p_before @> p_after and p_after @> p_before)
    or (select count(distinct k) from unnest(p_before) k) <> n then
    raise exception 'INVALID_ORDER';
  end if;
  select public.habita_rule_group(stage) into scope from public.followup_rules where key=p_before[1];
  if scope is null then raise exception 'ORDER_CHANGED'; end if;
  perform pg_advisory_xact_lock(hashtext('followup-order:' || scope));
  perform 1 from public.followup_rules where key=any(p_before) order by key for update;
  select array_agg(key order by position,key collate "C") into actual from public.followup_rules
    where key=any(p_before) and public.habita_rule_group(stage)=scope;
  if actual is distinct from p_before then raise exception 'ORDER_CHANGED'; end if;
  update public.followup_rules r set position=o.rank,updated_by=p_actor,updated_at=now()
    from unnest(p_after) with ordinality as o(key,rank) where r.key=o.key;
end $$;
revoke all on function public.habita_reorder_rules(text[],text[],uuid) from public,anon,authenticated;
grant execute on function public.habita_reorder_rules(text[],text[],uuid) to service_role;
