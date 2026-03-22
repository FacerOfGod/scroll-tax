import React, {createContext, useContext, useState, useEffect} from 'react';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {xrplService} from '../services/XrplService';
import {supabase} from './supabaseClient';
import {Session} from '@supabase/supabase-js';

interface User {
  id: string;
  email?: string;
  address?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{error: any}>;
  signUp: (email: string, password: string) => Promise<{error: any, data?: any}>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [user, setUser] = useState<User | null>(null);
  const [, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for initial session
    supabase.auth.getSession().then(({data: {session}}) => {
      setSession(session);
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
          address: session.user.user_metadata?.address,
        });
      }
      setIsLoading(false);
    });

    // Listen for auth changes
    const {data: {subscription}} = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
          address: session.user.user_metadata?.address,
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const {data, error} = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // If login succeeded, check the wallet seed is still in Keychain.
    // It can go missing if the user previously signed out (which used to wipe it)
    // or if the app was uninstalled and reinstalled.
    if (!error && data.user) {
      const existing = await Keychain.getGenericPassword({
        service: `xrpl-${data.user.id}`,
      });
      if (!existing) {
        // Seed is gone — generate a fresh wallet and update the address on the account
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
    }

    return {error};
  };

  const signUp = async (email: string, password: string) => {
    // 1. Generate XRPL Wallet
    const wallet = xrplService.generateWallet();

    // 1.b Fund wallet from testnet faucet (Testnet only)
    try {
      if (wallet.seed) {
        await xrplService.fundTestnetWallet(wallet.seed);
      }
    } catch (e) {
      console.warn('Could not fund testnet wallet automatically.', e);
    }

    // 2. Sign up with Supabase and include address in metadata
    const {data, error} = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          address: wallet.address,
        },
      },
    });

    if (!error && data.user) {
      // 3. Store seed securely in Keychain
      await Keychain.setGenericPassword(wallet.address, wallet.seed!, {
        service: `xrpl-${data.user.id}`,
      });
    }

    return {error, data};
  };

  const signOut = async () => {
    // Do NOT clear the Keychain — the wallet seed must survive sign-out
    // so it's available when the user signs back in on the same device.
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{user, isLoading, signIn, signUp, signOut}}>
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
