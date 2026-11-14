-- Allow admins to maintain Instagram-sourced review candidates (update/delete).
-- Insert policy was added in instagram_archive; approve still happens only via review RPC.

grant update, delete on public.music_candidate to authenticated;

drop policy if exists music_candidate_admin_update on public.music_candidate;
create policy music_candidate_admin_update on public.music_candidate
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists music_candidate_admin_delete on public.music_candidate;
create policy music_candidate_admin_delete on public.music_candidate
  for delete to authenticated
  using (public.is_admin());
