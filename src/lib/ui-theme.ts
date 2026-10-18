export type ThemeMode = 'light' | 'dark';

export const themeStorageKey = 'lms.theme';
export const themeInitScript = `(function(){var t='light';try{var s=localStorage.getItem('${themeStorageKey}');if(s==='light'||s==='dark')t=s;}catch(e){}document.documentElement.dataset.theme=t;})();`;
