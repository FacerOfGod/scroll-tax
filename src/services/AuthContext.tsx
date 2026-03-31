import React, {createContext, useContext, useState, useEffect} from 'react';
import {Linking} from 'react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {xrplService} from '../services/XrplService';
import {tokenService} from '../services/TokenService';
import {supabase} from './supabaseClient';
import {Session} from '@supabase/supabase-js';

interface User {
  id: string;
  email?: string;
  address?: string;
  tokens?: number;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{error: any}>;
  signUp: (email: string, password: string) => Promise<{error: any, data?: any}>;
  signInWithGoogle: () => Promise<{error: any}>;
  signOut: () => Promise<void>;
  refreshTokenBalance: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ensureXrplWallet = async (userId: string) => {
  const existing = await Keychain.getGenericPassword({service: `xrpl-${userId}`});
  if (!existing) {
    const wallet = xrplService.generateWallet();
    try {
      if (wallet.seed) await xrplService.fundTestnetWallet(wallet.seed);
    } catch (e) {
      console.warn('Could not auto-fund wallet:', e);
    }
    await Keychain.setGenericPassword(wallet.address, wallet.seed!, {
      service: `xrpl-${userId}`,
    });
    await supabase.auth.updateUser({data: {address: wallet.address}});
  }
  // Ensure token profile exists (idempotent — no-ops if already present)
  await tokenService.ensureProfile(userId);
};

export const AuthProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [user, setUser] = useState<User | null>(null);
  const [, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUser = (supabaseUser: any) => {
    // Set user immediately (no async wait) so the loading screen is dismissed quickly
    setUser({
      id: supabaseUser.id,
      email: supabaseUser.email,
      address: supabaseUser.user_metadata?.address,
    });
    // Load token balance in the background and patch it in once available
    tokenService.getBalance(supabaseUser.id).then(tokens => {
      setUser(prev => (prev?.id === supabaseUser.id ? {...prev, tokens} : prev));
    }).catch(() => {});
  };

  useEffect(() => {
    // Identical shape to original — no async, setIsLoading(false) always called
    supabase.auth.getSession().then(({data: {session}}) => {
      setSession(session);
      if (session?.user) {
        loadUser(session.user);
      }
      setIsLoading(false);
    });

    const {data: {subscription}} = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      if (session?.user) {
        loadUser(session.user);
        // Create XRPL wallet + token profile for new Google OAuth users on first sign-in
        if (event === 'SIGNED_IN' && !session.user.user_metadata?.address) {
          await ensureXrplWallet(session.user.id);
          // Reload with updated address and wallet
          loadUser(session.user);
        }
      } else {
        setUser(null);
      }
    });

    // Handle OAuth redirect when app is already open
    const linkingSub = Linking.addEventListener('url', ({url}) => {
      if (url.startsWith('scrolltax://')) {
        supabase.auth.exchangeCodeForSession(url).catch(console.warn);
      }
    });

    // Handle OAuth redirect when app was launched cold via deep link
    Linking.getInitialURL().then(url => {
      if (url?.startsWith('scrolltax://')) {
        supabase.auth.exchangeCodeForSession(url).catch(console.warn);
      }
    });

    return () => {
      subscription.unsubscribe();
      linkingSub.remove();
    };
  }, []);

  const refreshTokenBalance = async () => {
    if (!user) return;
    const tokens = await tokenService.getBalance(user.id);
    setUser(prev => prev ? {...prev, tokens} : prev);
  };

  const signIn = async (email: string, password: string) => {
    const {data, error} = await supabase.auth.signInWithPassword({email, password});

    if (!error && data.user) {
      const existing = await Keychain.getGenericPassword({
        service: `xrpl-${data.user.id}`,
      });
      if (!existing) {
        const wallet = xrplService.generateWallet();
        try {
          if (wallet.seed) await xrplService.fundTestnetWallet(wallet.seed);
        } catch (e) {
          console.warn('Could not auto-fund recovery wallet:', e);
        }
        await Keychain.setGenericPassword(wallet.address, wallet.seed!, {
          service: `xrpl-${data.user.id}`,
        });
        await supabase.auth.updateUser({data: {address: wallet.address}});
      }
      // Ensure token profile exists for existing users logging in for the first time
      await tokenService.ensureProfile(data.user.id);
    }

    return {error};
  };

  const signUp = async (email: string, password: string) => {
    const wallet = xrplService.generateWallet();

    try {
      if (wallet.seed) await xrplService.fundTestnetWallet(wallet.seed);
    } catch (e) {
      console.warn('Could not fund testnet wallet automatically.', e);
    }

    const {data, error} = await supabase.auth.signUp({
      email,
      password,
      options: {data: {address: wallet.address}},
    });

    if (!error && data.user) {
      await Keychain.setGenericPassword(wallet.address, wallet.seed!, {
        service: `xrpl-${data.user.id}`,
      });
      await tokenService.ensureProfile(data.user.id);
    }

    return {error, data};
  };

  const signInWithGoogle = async (): Promise<{error: any}> => {
    try {
      const {data, error} = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'scrolltax://auth-callback',
          skipBrowserRedirect: true,
        },
      });

      if (error) return {error};
      if (!data.url) return {error: new Error('No OAuth URL returned.')};

      await Linking.openURL(data.url);
      return {error: null};
    } catch (err: any) {
      return {error: err};
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{user, isLoading, signIn, signUp, signInWithGoogle, signOut, refreshTokenBalance}}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
