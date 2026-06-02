-- ─── Track when a member left ─────────────────────────────────────────────────
ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ DEFAULT NULL;

-- ─── Soft-delete: convert DELETE → UPDATE status='left' ──────────────────────
-- The physical row is preserved so penalties_incurred history is never lost.
-- Returning NULL from a BEFORE trigger cancels the DELETE.

CREATE OR REPLACE FUNCTION public.handle_member_leave()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.group_members
  SET    status  = 'left',
         left_at = NOW()
  WHERE  id = OLD.id;

  RETURN NULL; -- cancel the physical DELETE
END;
$$;

DROP TRIGGER IF EXISTS trg_member_leave ON public.group_members;
CREATE TRIGGER trg_member_leave
  BEFORE DELETE ON public.group_members
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_member_leave();

-- ─── Prevent rejoining after leaving ─────────────────────────────────────────
-- The existing UNIQUE(group_id, user_id) constraint prevents a plain re-INSERT
-- once the row has status='left'. This trigger provides a clear error message.

CREATE OR REPLACE FUNCTION public.check_no_rejoin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_status TEXT;
BEGIN
  SELECT status INTO existing_status
  FROM   public.group_members
  WHERE  group_id = NEW.group_id AND user_id = NEW.user_id;

  IF existing_status = 'left' THEN
    RAISE EXCEPTION 'rejoin_not_allowed: user has already left this group';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_rejoin ON public.group_members;
CREATE TRIGGER trg_check_rejoin
  BEFORE INSERT ON public.group_members
  FOR EACH ROW
  EXECUTE FUNCTION public.check_no_rejoin();

-- ─── Tighten is_group_member to active-only ───────────────────────────────────
-- Left members are excluded from token distributions and leaderboard visibility.

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE  group_id = p_group_id
      AND  user_id  = auth.uid()
      AND  status   = 'active'
  );
$$;
