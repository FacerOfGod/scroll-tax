-- ============================================================
-- RLS hardening: token-mint lockdown, group_members tamper-proofing,
-- invite-only group visibility
-- ============================================================
-- A 2026-06-24 access-control audit found three gaps:
--
--   CRITICAL  Any authenticated user could mint in-app tokens, two ways:
--             (a) adjust_tokens() accepted a positive delta (self-credit), and
--             (b) the user_profiles UPDATE policy let the client write `tokens`
--                 on its own row directly. Both bypass the atomic token RPCs.
--   HIGH      A member could rewrite their own group_members row — inflate
--             staked_amount, zero penalties_incurred, or flip status
--             'left'→'active' to bypass the INSERT-only rejoin protection —
--             because the INSERT/UPDATE policies only checked user_id and RLS
--             cannot restrict columns.
--   MEDIUM    Every group (incl. wallet_address) was world-readable, even to
--             the anon role. The product is invite-only.
--
-- Fix: money/stat columns become writable ONLY through SECURITY DEFINER RPCs;
-- clients keep read-own + benign-column (wallet_address) access. Group config is
-- visible to members/creator, with a narrow by-id lookup for prospective joiners.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. user_profiles — clients get SELECT-own only; tokens move via RPC / trigger
-- ─────────────────────────────────────────────────────────────────────────────

-- Direct client writes to `tokens` are the mint vector — remove both policies and
-- the underlying table privileges. (SECURITY DEFINER RPCs run as the function
-- owner and are unaffected; the service_role policy is likewise untouched.)
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
REVOKE INSERT, UPDATE, DELETE ON public.user_profiles FROM authenticated, anon;

-- Profile provisioning moves server-side: a new auth user automatically gets a
-- profile row with the starting balance. Clients can never choose the balance.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, tokens)
  VALUES (NEW.id, 100)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_handle_new_user ON auth.users;
CREATE TRIGGER trg_handle_new_user
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Idempotent self-provision for existing sessions (TokenService.ensureProfile).
-- Server-controlled starting balance; a no-op if the row already exists.
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  INSERT INTO public.user_profiles (user_id, tokens)
  VALUES (v_user, 100)
  ON CONFLICT (user_id) DO NOTHING;
END; $$;

REVOKE ALL    ON FUNCTION public.ensure_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;

-- adjust_tokens is now DEDUCT-ONLY for clients: a positive delta (self-credit) is
-- rejected. All credits happen inside SECURITY DEFINER RPCs (record_penalty,
-- settle_self_bet, …) or atomically in join_group below.
CREATE OR REPLACE FUNCTION public.adjust_tokens(p_delta NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_new     NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  -- Clients may only DEDUCT. Credits are not a client-callable primitive.
  IF p_delta > 0 THEN RAISE EXCEPTION 'credit_not_allowed'; END IF;

  UPDATE public.user_profiles
  SET    tokens = tokens + p_delta
  WHERE  user_id = v_user_id
    AND  tokens + p_delta >= 0
  RETURNING tokens INTO v_new;

  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_tokens'; END IF;
  RETURN v_new;
END; $$;

REVOKE ALL    ON FUNCTION public.adjust_tokens(NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_tokens(NUMERIC) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. group_members — money/stat columns become read-only to the member
-- ─────────────────────────────────────────────────────────────────────────────
-- Membership is created through join_group() (below). Leaving stays a DELETE,
-- soft-deleted by the existing trigger. The only column a member may write
-- directly is wallet_address; staked_amount / penalties_incurred / status are
-- server-authoritative. This also closes the status 'left'→'active' rejoin
-- bypass, since status is no longer client-updatable.

REVOKE INSERT, UPDATE ON public.group_members FROM authenticated, anon;
GRANT  UPDATE (wallet_address) ON public.group_members TO authenticated;

-- The old INSERT policy is now moot (no INSERT privilege); drop it for clarity.
-- The UPDATE policy is kept: combined with the wallet_address column grant it
-- means "a member may update only their own row's wallet_address".
DROP POLICY IF EXISTS "Users can join groups"              ON public.group_members;
DROP POLICY IF EXISTS "Authenticated users can join groups" ON public.group_members;

-- Atomic, server-authoritative join. staked_amount is read from the group's
-- min_deposit (never client-supplied). For a token group the stake is deducted
-- from the joiner's balance in the SAME transaction, so a failed insert can never
-- leave tokens debited (no client-side refund needed). The group creator is not
-- charged (mirrors create-group behaviour). The unique(group,user) constraint and
-- the rejoin-protection trigger still apply — a violation aborts the whole
-- function, rolling back any token debit.
CREATE OR REPLACE FUNCTION public.join_group(p_group_id UUID, p_wallet TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user        UUID := auth.uid();
  v_status      TEXT;
  v_stake_type  TEXT;
  v_min_deposit NUMERIC;
  v_creator     UUID;
  v_existing    TEXT;
  v_rows        INTEGER;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT status, stake_type, min_deposit, creator_id
  INTO   v_status, v_stake_type, v_min_deposit, v_creator
  FROM   public.groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'group_not_found');
  END IF;
  IF v_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'group_not_active');
  END IF;

  -- Clean responses for already-joined / previously-left (before any token debit).
  SELECT status INTO v_existing
  FROM   public.group_members WHERE group_id = p_group_id AND user_id = v_user;
  IF FOUND THEN
    IF v_existing = 'left' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'rejoin_not_allowed');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'already_member');
  END IF;

  -- Token groups: lock the stake up-front (creator exempt, mirrors create flow).
  IF v_stake_type = 'tokens' AND v_user <> v_creator THEN
    UPDATE public.user_profiles
    SET    tokens = tokens - v_min_deposit
    WHERE  user_id = v_user AND tokens >= v_min_deposit;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_tokens');
    END IF;
  END IF;

  INSERT INTO public.group_members (group_id, user_id, wallet_address, staked_amount)
  VALUES (p_group_id, v_user, p_wallet, v_min_deposit);

  RETURN jsonb_build_object('ok', true, 'staked_amount', v_min_deposit);
END; $$;

REVOKE ALL    ON FUNCTION public.join_group(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_group(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. groups — invite-only visibility
-- ─────────────────────────────────────────────────────────────────────────────
-- Members and the creator see their groups directly (the embedded reads in
-- GroupService.fetchGroups / getActiveGroupForUser go through this policy). A
-- prospective joiner is not yet a member, so it fetches just the joinable fields
-- of one group by id through get_group_for_join() — no member list, no listing
-- of all groups, and UUID ids are unguessable (invite-by-link).

DROP POLICY IF EXISTS "Anyone can view groups" ON public.groups;
CREATE POLICY "Members and creator can view group" ON public.groups
  FOR SELECT TO authenticated
  USING (creator_id = auth.uid() OR public.is_group_member(id, auth.uid()));

CREATE OR REPLACE FUNCTION public.get_group_for_join(p_group_id UUID)
RETURNS TABLE (
  id                           UUID,
  name                         TEXT,
  wallet_address               TEXT,
  min_deposit                  NUMERIC,
  duration_days                INTEGER,
  penalty_amount               NUMERIC,
  penalty_trigger_time_minutes INTEGER,
  banned_apps                  TEXT[],
  stake_type                   TEXT,
  status                       TEXT,
  creator_id                   UUID,
  end_time                     TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, wallet_address, min_deposit, duration_days, penalty_amount,
         penalty_trigger_time_minutes, banned_apps, stake_type, status,
         creator_id, end_time
  FROM   public.groups
  WHERE  id = p_group_id AND status = 'active';
$$;

REVOKE ALL    ON FUNCTION public.get_group_for_join(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_group_for_join(UUID) TO authenticated;
