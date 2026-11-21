-- Correct the hangul short name for ずっと真夜中でいいのに。 (즛, not 줏).
update public.artist_alias x
set alias = '즛토마요'
from public.artist a
where x.artist_id = a.id
  and a.name = 'ずっと真夜中でいいのに。'
  and public.normalize_music_text(x.alias) = public.normalize_music_text('줏토마요');

insert into public.artist_alias (artist_id, alias)
select a.id, '즛토마요'
from public.artist a
where a.name = 'ずっと真夜中でいいのに。'
  and a.status = 'PUBLISHED'
  and not exists (
    select 1 from public.artist_alias x
    where public.normalize_music_text(x.alias) = public.normalize_music_text('즛토마요')
  );
