'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import { BookOpen, Check, ChevronUp, ImagePlus, Keyboard, LoaderCircle, Mail, Moon, RotateCcw, Settings, ShieldCheck, SlidersHorizontal, UserRound, X } from 'lucide-react';
import { Button } from './ui/button';
import { useTheme } from './ui-theme';
import { useUserPreferences } from './user-preferences';
import SpotlightCard from './react-bits/SpotlightCard';
import { ProfileFields } from './profile-fields';

export function UserAvatar({ src, large = false }: { src: string | null; large?: boolean }) {
  return <span className={`user-avatar${large ? ' user-avatar-large' : ''}`} aria-hidden="true">{src ? <img src={src} alt=""/> : <BookOpen size={large ? 29 : 19} strokeWidth={1.7}/>}</span>;
}

export function ProfileMenu({ onSettings, triggerRef }: { onSettings: () => void; triggerRef: RefObject<HTMLButtonElement | null> }) {
  const { preferences, storageError } = useUserPreferences();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const openingSettings = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  return <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
    <DropdownMenu.Trigger asChild><button ref={triggerRef} className="profile user-profile" type="button" title={preferences.nickname} aria-label="打开个人菜单"><UserAvatar src={preferences.avatar}/><span className="user-profile-name">{preferences.nickname}</span><ChevronUp size={16}/></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content ref={contentRef} className="user-profile-menu" side="top" align="start" sideOffset={8} collisionPadding={12} onPointerDownOutside={event => {
      if (!document.documentElement.hasAttribute('data-theme-transition')) return;
      const rect = contentRef.current?.getBoundingClientRect(), pointer = event.detail.originalEvent;
      if (rect && pointer.clientX >= rect.left && pointer.clientX <= rect.right && pointer.clientY >= rect.top && pointer.clientY <= rect.bottom) event.preventDefault();
    }} onFocusOutside={event => { if (document.documentElement.hasAttribute('data-theme-transition') && (event.target === document.documentElement || event.target === document.body)) event.preventDefault(); }} onCloseAutoFocus={event => { if (openingSettings.current) { event.preventDefault(); openingSettings.current = false; } }}>
      <DropdownMenu.Item className="user-profile-menu-item" onSelect={() => { openingSettings.current = true; onSettings(); }}><Settings size={19}/><span>设置</span></DropdownMenu.Item>
      <DropdownMenu.CheckboxItem className="user-profile-menu-item" aria-label="深色模式" checked={theme === 'dark'} onSelect={event => event.preventDefault()} onClick={event => toggleTheme(event.currentTarget)}><Moon size={19}/><span>深色模式</span><span className="settings-switch-track" data-checked={theme === 'dark'} aria-hidden="true"><span/></span></DropdownMenu.CheckboxItem>
      {storageError && <p className="settings-error" role="alert">{storageError}</p>}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

const categories = [{ id: 'profile', label: '个人资料', icon: UserRound }, { id: 'appearance', label: '外观与阅读', icon: SlidersHorizontal }, { id: 'interaction', label: '对话与操作', icon: Keyboard }, { id: 'space', label: '学习空间', icon: BookOpen }] as const;
type Category = typeof categories[number]['id'];
function LoginIllustration() {
  return <svg className="settings-login-art" viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none">
    <circle cx="80" cy="57" r="44" fill="var(--theme-info-bg)" opacity=".65"/>
    <ellipse cx="80" cy="111" rx="52" ry="4" fill="var(--theme-border)" opacity=".55"/>
    <path d="M37 31 60 26 72 82 48 87Z" fill="var(--theme-subtle)" stroke="var(--theme-border-strong)" strokeWidth="1.5"/>
    <path d="m45 42 12-3m-10 13 12-3" stroke="var(--theme-border-strong)" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="85" cy="34" r="23" fill="var(--theme-surface)" stroke="currentColor" strokeOpacity=".3" strokeWidth="1.5"/>
    <circle cx="85" cy="28" r="6" stroke="currentColor" strokeWidth="1.7"/>
    <path d="M73 47a12 12 0 0 1 24 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
    <path d="M22 59c20-5 38-3 58 7v42c-20-10-38-12-58-7Z" fill="var(--theme-surface)" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M138 59c-20-5-38-3-58 7v42c20-10 38-12 58-7Z" fill="var(--theme-info-bg)" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="m34 72 29 4m-29 7 29 4m-29 7 21 3m71-25-29 4m29 7-29 4m29 7-21 3" stroke="currentColor" strokeOpacity=".3" strokeWidth="2" strokeLinecap="round"/>
    <path d="M19 32h8m-4-4v8m111-16h8m-4-4v8" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="145" cy="78" r="2" fill="currentColor" opacity=".35"/>
  </svg>;
}
function SettingRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <div className="settings-row"><div><h3>{title}</h3>{description && <p>{description}</p>}</div>{children}</div>;
}
function Switch({ label, checked, onClick }: { label: string; checked: boolean; onClick: (anchor: HTMLButtonElement) => void }) {
  return <button type="button" className="settings-switch" role="switch" aria-label={label} aria-checked={checked} onClick={event => onClick(event.currentTarget)}><span className="settings-switch-track" data-checked={checked} aria-hidden="true"><span/></span></button>;
}

async function prepareAvatar(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
  if (file.size > 5 * 1024 * 1024) throw new Error('图片不能超过 5 MB，请换一张较小的图片。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context || !image.naturalWidth || !image.naturalHeight) throw new Error('无法读取这张图片，请换一张重试。');
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 256, 256);
    return canvas.toDataURL('image/webp', 0.82);
  } finally { URL.revokeObjectURL(url); }
}

type SettingsPanelProps = {
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  courseName: string;
  counts: { materials: number | null; conversations: number | null; versions: number | null };
  statisticsLoading: boolean;
  statisticsError: string;
  onRetryStatistics: () => void;
  sidebarCollapsed: boolean;
  onSidebarChange: (collapsed: boolean) => boolean;
  accountEmail: string | null;
  onLogin: () => Promise<void>;
  privateCloud: boolean;
  onSignOut: () => Promise<void>;
};

export function SettingsPanel({ onClose, triggerRef, courseName, counts, statisticsLoading, statisticsError, onRetryStatistics, sidebarCollapsed, onSidebarChange, accountEmail, onLogin, privateCloud, onSignOut }: SettingsPanelProps) {
  const { preferences, savePreferences, resetPreferences, storageError, reducedMotion, reportStorageError } = useUserPreferences();
  const { theme, toggleTheme, setTheme } = useTheme();
  const [category, setCategory] = useState<Category>('profile');
  const [profileEditing, setProfileEditing] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [working, setWorking] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const avatarMounted = useRef(true);
  useEffect(() => { avatarMounted.current = true; return () => { avatarMounted.current = false; }; }, []);
  const saved = (success: boolean) => { setNotice(success ? '偏好已保存' : ''); if (!success) reportStorageError(); return success; };
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="user-settings-overlay"/>
    <Dialog.Content asChild aria-describedby={undefined} onEscapeKeyDown={event => { if (profileEditing) event.preventDefault(); }} onPointerDownOutside={event => { if (profileEditing) event.preventDefault(); }} onCloseAutoFocus={event => { event.preventDefault(); const mobileNavigation = window.innerWidth < 1024 && !triggerRef.current?.closest('.sidebar-open'); const target = mobileNavigation ? document.querySelector<HTMLButtonElement>('button[aria-label="展开课程导航"]') : triggerRef.current; target?.focus({ preventScroll: true }); }}><motion.div layoutRoot className="user-settings">
      <header className="user-settings-header"><Dialog.Title>设置</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="关闭设置"><X size={20}/></Button></Dialog.Close></header>
      <div className="user-settings-layout">
        <nav className="user-settings-tabs" role="tablist" aria-label="设置分类">{categories.map(({ id, label, icon: Icon }, index) => <button key={id} type="button" role="tab" id={`settings-tab-${id}`} aria-selected={category === id} aria-controls={`settings-panel-${id}`} tabIndex={category === id ? 0 : -1} onClick={() => { setCategory(id); setError(''); setNotice(''); }} onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length;
          setCategory(categories[next].id); document.getElementById(`settings-tab-${categories[next].id}`)?.focus();
        }}><Icon size={17}/><span>{label}</span></button>)}</nav>
        <motion.div layoutScroll className="user-settings-content" role="tabpanel" id={`settings-panel-${category}`} aria-labelledby={`settings-tab-${category}`} tabIndex={0}>
          {category === 'profile' && (accountEmail ? <section className="settings-profile-section" data-editing={profileEditing && !reducedMotion}>
            <LayoutGroup><div className="settings-profile-form">
              <motion.div layout="position" transition={{ duration: reducedMotion ? .12 : .26, ease: [.23, 1, .32, 1] }} className="settings-avatar-row"><div className="settings-avatar-editor"><button type="button" className="settings-avatar-trigger" aria-label="更换头像" aria-busy={working} onClick={() => avatarInput.current?.click()} disabled={working} title="PNG、JPEG 或 WebP，最大 5 MB"><UserAvatar src={preferences.avatar} large/><span className="settings-avatar-overlay" aria-hidden="true">{working ? <LoaderCircle size={20} className="spin"/> : <ImagePlus size={20}/>}<span>{working ? '处理中' : '更换头像'}</span></span></button>{preferences.avatar && <button type="button" className="settings-avatar-reset" aria-label="恢复默认头像" title="恢复默认头像" onClick={() => { setError(''); setNotice(savePreferences({ avatar: null }) ? '头像已保存' : ''); }} disabled={working}><RotateCcw size={13}/></button>}</div><div className="settings-profile-summary"><strong>{preferences.nickname}</strong><span className="settings-account-status"><Check size={12} strokeWidth={2.5}/>已登录</span></div></motion.div>
              <input ref={avatarInput} type="file" aria-label="上传头像" accept="image/png,image/jpeg,image/webp" hidden disabled={working} onChange={async event => {
                const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
                setWorking(true); setError(''); setNotice('');
                try { const avatar = await prepareAvatar(file); if (avatarMounted.current && savePreferences({ avatar })) setNotice('头像已保存'); }
                catch (cause) { if (avatarMounted.current) setError(cause instanceof Error && cause.message.startsWith('请选择') || cause instanceof Error && cause.message.includes('5 MB') ? cause.message : '无法读取这张图片，请换一张重试。'); }
                finally { if (avatarMounted.current) setWorking(false); }
              }}/>
              <ProfileFields onEditingChange={setProfileEditing} fields={[
                { id: 'nickname', title: '昵称', icon: <UserRound size={18}/>, value: preferences.nickname, characterLimit: 20, save: value => { const name = value.trim(); if (!name || Array.from(name).length > 20) return '昵称请输入 1–20 个字。'; if (name !== preferences.nickname && !savePreferences({ nickname: name })) return '无法保存，请检查浏览器存储。'; setError(''); setNotice('昵称已保存'); return null; } },
                { id: 'email', title: '邮箱', icon: <Mail size={17}/>, value: accountEmail },
              ]}/>
            </div></LayoutGroup>
          </section> : <section className="settings-login-prompt"><LoginIllustration/><h2>请先登录</h2><Button className="settings-login-button" variant="primary" disabled={working} onClick={async () => { setWorking(true); setError(''); try { await onLogin(); } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法前往登录，请重试。'); } finally { setWorking(false); } }}>{working ? '正在准备…' : '登录'}</Button></section>)}
          {category === 'appearance' && <section><div className="settings-section-heading"><h2>外观与阅读</h2></div>
            <SettingRow title="深色模式"><Switch label="深色模式" checked={theme === 'dark'} onClick={toggleTheme}/></SettingRow>
            <div className="settings-block"><h3>阅读字号</h3><p>调整对话、文字资料与笔记正文的大小。</p><fieldset className="settings-choices" aria-label="阅读字号">{([{ value: 'standard', label: '标准', sample: '100%' }, { value: 'comfortable', label: '较大', sample: '112%' }, { value: 'large', label: '大', sample: '125%' }] as const).map(item => <label key={item.value} data-selected={preferences.readingSize === item.value}><input type="radio" name="reading-size" value={item.value} checked={preferences.readingSize === item.value} onChange={() => saved(savePreferences({ readingSize: item.value }))}/><span>{item.label}</span><small>{item.sample}</small></label>)}</fieldset>
              <SpotlightCard className="settings-reading-preview" intensity={0.12} borderGlow={0.1} proximity={0} flare={false} ambient={false}><p className="settings-preview-text">阅读字号预览</p><p className="settings-preview-description">这是一段用于预览字号的学习内容。</p></SpotlightCard><p className="settings-field-hint">原始 PDF、Word 与试卷版面仍使用各自的缩放。</p>
            </div><SettingRow title="减少动效" description={reducedMotion && !preferences.reduceMotion ? '系统已开启减少动态效果，百知册正在跟随。' : '简化主题、菜单和对话中的动画，保留必要的状态提示。'}><Switch label="减少动效" checked={preferences.reduceMotion} onClick={() => saved(savePreferences({ reduceMotion: !preferences.reduceMotion }))}/></SettingRow>
          </section>}
          {category === 'interaction' && <section><div className="settings-section-heading"><h2>对话与操作</h2></div><div className="settings-block"><h3>发送消息</h3><fieldset className="settings-send-choices" aria-label="发送快捷键">{([{ value: 'enter', title: 'Enter 发送', hint: 'Shift + Enter 换行' }, { value: 'mod-enter', title: 'Ctrl / ⌘ + Enter 发送', hint: 'Enter 换行，适合输入较长的问题' }] as const).map(item => <label key={item.value} data-selected={preferences.sendShortcut === item.value}><input type="radio" name="send-shortcut" checked={preferences.sendShortcut === item.value} onChange={() => saved(savePreferences({ sendShortcut: item.value }))}/><span><b>{item.title}</b><small>{item.hint}</small></span></label>)}</fieldset></div><SettingRow title="展开侧栏"><Switch label="展开侧栏" checked={!sidebarCollapsed} onClick={() => saved(onSidebarChange(!sidebarCollapsed))}/></SettingRow></section>}
          {category === 'space' && <section><div className="settings-section-heading"><h2>学习空间</h2><p className="settings-course-name">{courseName}</p></div>{statisticsLoading && <p className="settings-field-hint" role="status">正在读取当前课程的学习概况…</p>}{statisticsError && <div className="settings-error" role="alert">{statisticsError}<Button size="sm" onClick={onRetryStatistics}>重试读取</Button></div>}<div className="settings-space-stats">{[{ value: counts.materials, label: '份课程资料' }, { value: counts.conversations, label: '段对话记录' }, { value: counts.versions, label: '个复习版本' }].map(item => <div key={item.label}><b>{item.value ?? '—'}</b><span>{item.label}</span></div>)}</div><div className="settings-info"><ShieldCheck size={18}/><div><h3>你的私人学习空间</h3><p>上传的文件、对话历史和复习版本不会自动公开。发送给 AI 前，系统会在操作处明确提示。</p></div></div><SettingRow title="恢复默认偏好" description="恢复主题、字号、动效、发送方式和侧栏状态。保留头像、昵称与所有学习数据。"><Button onClick={() => { const preferencesSaved = resetPreferences(); const themeSaved = setTheme('light'); const sidebarSaved = onSidebarChange(true); saved(preferencesSaved && themeSaved && sidebarSaved); }}>恢复默认</Button></SettingRow>{privateCloud && <SettingRow title="退出登录" description="退出前会保存当前笔记。"><Button disabled={working} onClick={async () => { setWorking(true); setError(''); try { await onSignOut(); } catch (cause) { setError(cause instanceof Error ? cause.message : '退出暂未完成，请重试。'); } finally { setWorking(false); } }}>退出登录</Button></SettingRow>}</section>}
          {(error || storageError) && !profileEditing && <p className="settings-error" role="alert">{error || storageError}</p>}
          {notice && !error && !storageError && <p className="settings-save-status" role="status"><Check size={14}/>{notice}</p>}
        </motion.div>
      </div>
    </motion.div></Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
