import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, SafeAreaView } from 'react-native';
import { Colors } from '../../theme/colors';
import { useAuth } from '../../services/AuthContext';
import { supabase } from '../../services/supabaseClient';

const LinkTelegramScreen = ({ route }: any) => {
  const { user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'linked' | 'already' | 'error'>('loading');

  useEffect(() => {
    const telegramId = route?.params?.telegram_id;
    if (!telegramId || !user?.id) {
      setStatus('error');
      return;
    }

    supabase
      .from('linked_accounts')
      .select('telegram_id')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setStatus('already');
          return;
        }
        return supabase
          .from('linked_accounts')
          .insert({ telegram_id: telegramId, user_id: user.id })
          .then(({ error }) => {
            if (error) console.error('[LinkTelegram] insert error:', error.message, error.code);
            setStatus(error ? 'error' : 'linked');
          });
      });
  }, [user?.id, route?.params?.telegram_id]);

  const content = {
    loading: { icon: '⏳', title: 'Linking…', sub: '' },
    linked:  { icon: '✅', title: 'Telegram linked!', sub: 'Go back to the bot and run /wallet to set up your TON wallet.' },
    already: { icon: '👍', title: 'Already linked', sub: 'Your Telegram account is already connected.' },
    error:   { icon: '❌', title: 'Something went wrong', sub: 'Please try again from the bot.' },
  }[status];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        {status === 'loading' ? (
          <ActivityIndicator color={Colors.primary} size="large" />
        ) : (
          <Text style={styles.icon}>{content.icon}</Text>
        )}
        <Text style={styles.title}>{content.title}</Text>
        {!!content.sub && <Text style={styles.sub}>{content.sub}</Text>}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    marginHorizontal: 32,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.6)',
    gap: 12,
  },
  icon: {
    fontSize: 48,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },
  sub: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default LinkTelegramScreen;
