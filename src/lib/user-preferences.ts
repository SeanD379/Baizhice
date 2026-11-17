export type UserPreferences = {
  nickname: string;
  avatar: string | null;
  readingSize: 'standard' | 'comfortable' | 'large';
  reduceMotion: boolean;
  sendShortcut: 'enter' | 'mod-enter';
};
export const userPreferencesKey = 'lms.user-preferences.v1';
export const defaultUserPreferences: UserPreferences = { nickname: '私人学习者', avatar: null, readingSize: 'standard', reduceMotion: false, sendShortcut: 'enter' };

export function parseUserPreferences(saved: string | null, initialNickname?: string): UserPreferences {
  const defaults = initialNickname?.trim() && Array.from(initialNickname.trim()).length <= 20 ? { ...defaultUserPreferences, nickname: initialNickname.trim() } : defaultUserPreferences;
  try {
    const value = JSON.parse(saved ?? 'null');
    if (!value || typeof value !== 'object') return defaults;
    return {
      nickname: typeof value.nickname === 'string' && value.nickname.trim() && Array.from(value.nickname.trim()).length <= 20 ? value.nickname.trim() : defaults.nickname,
      avatar: typeof value.avatar === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(value.avatar) && value.avatar.length <= 400000 ? value.avatar : null,
      readingSize: value.readingSize === 'comfortable' || value.readingSize === 'large' ? value.readingSize : 'standard',
      reduceMotion: value.reduceMotion === true,
      sendShortcut: value.sendShortcut === 'mod-enter' ? 'mod-enter' : 'enter',
    };
  } catch { return defaults; }
}
