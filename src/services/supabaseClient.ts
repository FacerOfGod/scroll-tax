import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL as _SUPABASE_URL, SUPABASE_ANON_KEY as _SUPABASE_ANON_KEY } from '@env';

export const SUPABASE_URL: string = _SUPABASE_URL;
export const SUPABASE_ANON_KEY: string = _SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
