-- «Liberar cuenta»: undoes the claim of an agency taken over by a test account,
-- so the real agency can still claim it with its invitation link.
--
-- * Refused if the account paid (a grant with a payment): a real customer.
-- * The demo photos and their stagings go back to the team member who created
--   each demo (or the admin releasing it), like before the claim.
-- * Properties created by the account's users are deleted (their photos
--   soft-deleted); the team's properties and demos stay.
-- * Gift credits still unused by the account go back to waiting for the agency
--   (free_credits_pending); the ones already spent stay spent.
-- * The users leave the agency, open user invitations are revoked, the site is
--   unpublished and the demos lose the "Creó su panel" step. Invitation links
--   not used yet work again.
-- Only the server (service_role) calls it. Additive and idempotent.
begin;

create or replace function public.habita_release_agency(p_agency uuid, p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a agencies; members uuid[]; returned uuid[]; dropped uuid[]; props uuid[]; back integer; d uuid;
begin
 select * into a from agencies where id=p_agency for update;
 if not found then raise exception 'AGENCY_NOT_FOUND'; end if;
 if a.owner_id is null then raise exception 'NO_OWNER'; end if;
 select coalesce(array_agg(user_id),'{}') into members from agency_members where agency_id=a.id;
 members := array_append(members, a.owner_id);
 if exists(select 1 from credit_grants where user_id=any(members) and payment_id is not null) then raise exception 'AGENCY_PAID'; end if;

 -- Properties the account's users created; the team's stay.
 select coalesce(array_agg(id),'{}') into props from demo_properties where agency_id=a.id and created_by=any(members);
 select coalesce(array_agg(distinct ph.project_id),'{}') into dropped from demo_photos ph where ph.property_id=any(props);
 select coalesce(array_agg(distinct ph.project_id),'{}') into returned
  from demo_photos ph join demo_properties pr on pr.id=ph.property_id join projects p on p.id=ph.project_id
  where pr.agency_id=a.id and pr.id<>all(props) and p.user_id=any(members) and p.original_hash like 'demo:%';
 if exists(select 1 from generations where project_id=any(returned||dropped) and status in ('queued','running')) then raise exception 'BUSY'; end if;

 -- Demo photos back to whoever created each demo (or the admin releasing it).
 update projects p set user_id=coalesce(
   (select dm.created_by from demo_photos ph join demos dm on dm.property_id=ph.property_id
     where ph.project_id=p.id and dm.created_by is not null and dm.created_by<>all(members) limit 1),
   p_actor), grant_id=null
  where p.id=any(returned);
 update generations g set user_id=p.user_id from projects p where p.id=g.project_id and g.project_id=any(returned) and g.user_id=any(members);

 update projects set deleted_at=coalesce(deleted_at,now()) where id=any(dropped) and user_id=any(members);
 delete from demo_properties where id=any(props);

 -- Unused gift credits wait again for the agency.
 select coalesce(sum(remaining),0) into back from credit_grants
  where user_id=any(members) and payment_id is null and not revoked and remaining>0 and source_key like 'admin:%'
   and created_at>=coalesce(a.claimed_at,'-infinity');
 insert into credit_ledger(user_id,grant_id,delta,reason)
  select user_id,id,-remaining,'admin_adjustment' from credit_grants
  where user_id=any(members) and payment_id is null and not revoked and remaining>0 and source_key like 'admin:%'
   and created_at>=coalesce(a.claimed_at,'-infinity');
 update credit_grants set remaining=0,revoked=true
  where user_id=any(members) and payment_id is null and not revoked and remaining>0 and source_key like 'admin:%'
   and created_at>=coalesce(a.claimed_at,'-infinity');

 delete from agency_members where agency_id=a.id;
 update agency_invites set revoked_at=now() where agency_id=a.id and used_at is null and revoked_at is null;
 update agencies set owner_id=null,claimed_at=null,site_published=false,free_credits_pending=free_credits_pending+back where id=a.id;

 -- The demos lose "Creó su panel"; the rest of their activity stays.
 delete from demo_activity where kind='panel' and demo_id in (select id from demos where agency_id=a.id);
 for d in select id from demos where agency_id=a.id loop
  update demos set
   activity_level=coalesce((select max(level) from demo_activity where demo_id=d),0),
   activity_at=(select max(created_at) from demo_activity where demo_id=d),
   activity_visitors=(select count(*) from demo_activity where demo_id=d and kind='visita')
  where id=d;
 end loop;

 insert into admin_audit(actor_id,action,subject_id,details)
  values(p_actor,'agency_release',a.id::text,jsonb_build_object('owner',a.owner_id,'users',cardinality(array(select distinct unnest(members))),
   'photos',cardinality(returned),'properties',cardinality(props),'credits',back));
 return jsonb_build_object('photos',cardinality(returned),'properties',cardinality(props),'credits',back);
end $$;
revoke all on function public.habita_release_agency(uuid,uuid) from public,anon,authenticated;
grant execute on function public.habita_release_agency(uuid,uuid) to service_role;

commit;
