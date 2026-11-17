'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, X } from 'lucide-react';
import SpotlightCard from './react-bits/SpotlightCard';
import { useAppReducedMotion } from './user-preferences';

export type ProfileField = {
  id: string;
  title: string;
  icon: ReactNode;
  value: string;
  save?: (value: string) => string | null;
  characterLimit?: number;
};
type Box = { left: number; top: number; width: number; height: number };
const transition = { duration: .26, ease: [.23, 1, .32, 1] as [number, number, number, number] };

export function ProfileFields({ fields, onEditingChange }: { fields: ProfileField[]; onEditingChange: (editing: boolean) => void }) {
  const reduce = useAppReducedMotion();
  const [active, setActive] = useState<string | null>(null), [elevated, setElevated] = useState<string | null>(null);
  const [draft, setDraft] = useState(''), [error, setError] = useState('');
  const [geometry, setGeometry] = useState<{ dialog: HTMLElement; header: Box; pane: Box; extra: number; height: number } | null>(null);
  const group = useRef<HTMLDivElement>(null), rows = useRef(new Map<string, HTMLDivElement>());
  const activeRef = useRef<string | null>(null), draftRef = useRef(''), composing = useRef(false), pendingCommit = useRef(false);
  const suppressClick = useRef(false), focusFrame = useRef(0), fieldsRef = useRef(fields), changeRef = useRef(onEditingChange);
  fieldsRef.current = fields; changeRef.current = onEditingChange;

  const finish = useCallback((save: boolean, restoreFocus = true) => {
    const id = activeRef.current, field = fieldsRef.current.find(item => item.id === id);
    if (!id || !field) return true;
    if (save && composing.current) { pendingCommit.current = true; return false; }
    if (save && draftRef.current !== field.value) {
      const failure = field.save?.(draftRef.current);
      if (failure) { setError(failure); rows.current.get(id)?.querySelector('input')?.focus({ preventScroll: true }); return false; }
    }
    activeRef.current = null; pendingCommit.current = false; composing.current = false;
    setActive(null); setError(''); changeRef.current(false);
    if (restoreFocus) {
      cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(() => { if (!activeRef.current) rows.current.get(id)?.focus({ preventScroll: true }); });
    }
    return true;
  }, []);

  const measure = useCallback(() => {
    const pane = group.current?.closest<HTMLElement>('.user-settings-content');
    const dialog = group.current?.closest<HTMLElement>('.user-settings');
    const header = dialog?.querySelector<HTMLElement>('.user-settings-header');
    if (!pane || !dialog || !header || !group.current) return;
    const paneRect = pane.getBoundingClientRect(), dialogRect = dialog.getBoundingClientRect(), headerRect = header.getBoundingClientRect();
    const scale = dialog.offsetWidth ? dialogRect.width / dialog.offsetWidth : 1;
    const box = (rect: DOMRect): Box => ({ left: (rect.left - dialogRect.left) / scale, top: (rect.top - dialogRect.top) / scale, width: rect.width / scale, height: rect.height / scale });
    const width = group.current.getBoundingClientRect().width / scale;
    const visibleBottom = Math.min(paneRect.bottom, (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight));
    const availableHeight = paneRect.height ? Math.max(44, (visibleBottom - paneRect.top) / scale - 24) : 84;
    setGeometry({ dialog, pane: box(paneRect), header: box(headerRect), extra: Math.max(0, Math.min(width * .04, paneRect.width / scale - 24 - width)), height: Math.min((window.innerWidth <= 640 ? 72 : 76) + 8, availableHeight) });
  }, []);

  const reveal = useCallback(() => {
    const row = activeRef.current ? rows.current.get(activeRef.current) : null;
    const pane = group.current?.closest<HTMLElement>('.user-settings-content');
    if (!row || !pane) return;
    const rect = row.getBoundingClientRect(), bounds = pane.getBoundingClientRect();
    const top = Math.max(bounds.top, window.visualViewport?.offsetTop ?? 0) + 12;
    const bottom = Math.min(bounds.bottom, (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight)) - 12;
    const offset = rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
    if (offset) pane.scrollTop += offset;
  }, []);

  const begin = (field: ProfileField) => {
    if (!field.save || activeRef.current) return;
    activeRef.current = field.id; draftRef.current = field.value; composing.current = pendingCommit.current = false;
    setDraft(field.value); setError(''); setActive(field.id); setElevated(field.id); changeRef.current(true);
  };
  useLayoutEffect(() => {
    if (!active) return;
    const input = rows.current.get(active)?.querySelector('input');
    input?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    measure(); input?.focus({ preventScroll: true });
  }, [active, measure]);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const resize = () => { measure(); cancelAnimationFrame(frame); frame = requestAnimationFrame(reveal); };
    const observer = new ResizeObserver(resize);
    const pane = group.current?.closest<HTMLElement>('.user-settings-content');
    if (pane) { observer.observe(pane); pane.addEventListener('scroll', measure, { passive: true }); }
    window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize); window.visualViewport?.addEventListener('scroll', resize);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); pane?.removeEventListener('scroll', measure); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize); };
  }, [active, measure, reveal]);
  useEffect(() => {
    const outside = (event: Event) => !!activeRef.current && !rows.current.get(activeRef.current)?.contains(event.target as Node);
    const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const pointer = (event: Event) => {
      suppressClick.current = false;
      if (outside(event)) { consume(event); suppressClick.current = true; finish(true); }
    };
    const click = (event: Event) => {
      if (suppressClick.current) { consume(event); suppressClick.current = false; }
      else if (outside(event)) { consume(event); finish(true); }
    };
    const keyboard = (event: KeyboardEvent) => {
      suppressClick.current = false;
      if (event.key === 'Escape' && activeRef.current && !event.isComposing && !composing.current) { consume(event); finish(false); }
    };
    const cancel = () => { suppressClick.current = false; };
    document.addEventListener('pointerdown', pointer, true); document.addEventListener('click', click, true);
    document.addEventListener('keydown', keyboard, true); document.addEventListener('pointercancel', cancel, true);
    return () => { cancelAnimationFrame(focusFrame.current); document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', keyboard, true); document.removeEventListener('pointercancel', cancel, true); };
  }, [finish]);

  const activeIndex = fields.findIndex(field => field.id === active);
  const duration = reduce ? { duration: .12 } : transition;
  const overlay = geometry && createPortal(<AnimatePresence onExitComplete={() => { if (!activeRef.current) setElevated(null); }}>
    {active && <motion.div key="profile-focus" className="settings-profile-focus-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>
      <div className="settings-profile-focus-shade" style={geometry.header}/><div className="settings-profile-focus-shade" style={geometry.pane}/>
    </motion.div>}
  </AnimatePresence>, geometry.dialog);

  return <div ref={group} className="settings-profile-field-region">
    <SpotlightCard className="settings-profile-fields" spotlightColor="var(--theme-info)" intensity={elevated ? 0 : .06} borderGlow={0} proximity={0} flare={false}>
      {fields.map((field, index) => {
        const editing = active === field.id, first = index === 0 || activeIndex === index - 1 || editing;
        const last = index === fields.length - 1 || activeIndex === index + 1 || editing;
        const inputId = `settings-${field.id}`, errorId = `${inputId}-error`, counterId = `${inputId}-count`;
        return <motion.div key={field.id} ref={node => { if (node) rows.current.set(field.id, node); else rows.current.delete(field.id); }} layout onLayoutAnimationComplete={reveal}
          className="settings-profile-field" data-field={field.id} data-editing={editing} data-detached={editing || activeIndex === index - 1}
          role={field.save ? editing ? 'group' : 'button' : undefined} aria-label={field.save ? `编辑${field.title}` : undefined} aria-expanded={field.save ? editing : undefined}
          tabIndex={field.save && !editing ? 0 : -1} onClick={() => begin(field)}
          onKeyDown={event => { if (!activeRef.current && field.save && event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); begin(field); } }}
          onBlurCapture={event => { if (activeRef.current === field.id && !event.currentTarget.contains(event.relatedTarget as Node | null)) finish(true, false); }}
          style={{ zIndex: elevated === field.id ? 3 : 0, width: editing && !reduce ? `calc(100% + ${geometry?.extra ?? 0}px)` : '100%', height: editing && !reduce ? geometry?.height : undefined, marginInline: editing && !reduce ? -(geometry?.extra ?? 0) / 2 : 0, marginBlock: editing && !reduce ? 12 : 0 }}
          animate={{ borderTopLeftRadius: first ? 20 : 0, borderTopRightRadius: first ? 20 : 0, borderBottomLeftRadius: last ? 20 : 0, borderBottomRightRadius: last ? 20 : 0 }} transition={duration}>
          <motion.label layout="position" transition={duration} className="settings-profile-label" htmlFor={field.save ? inputId : undefined}><span className="settings-profile-field-icon">{field.icon}</span><span>{field.title}</span></motion.label>
          <motion.div layout="position" transition={duration} className="settings-profile-field-value">{field.save ? <div className="settings-nickname-field">
            <input id={inputId} className="settings-nickname-input" aria-label={field.title} aria-hidden={!editing} inert={!editing} tabIndex={editing ? 0 : -1} readOnly={!editing}
              value={editing ? draft : field.value} maxLength={field.characterLimit ? field.characterLimit * 2 : undefined} aria-invalid={editing && !!error} aria-describedby={editing ? [field.characterLimit ? counterId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined : undefined}
              onChange={event => { draftRef.current = event.target.value; setDraft(event.target.value); setError(''); }}
              onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; draftRef.current = event.currentTarget.value; setDraft(event.currentTarget.value); if (pendingCommit.current) finish(true); }}
              onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); event.stopPropagation(); finish(true); } }}/>
            {editing && field.characterLimit && <span id={counterId} className="settings-nickname-count" data-invalid={!!error}>{Array.from(draft.trim()).length}/{field.characterLimit}</span>}
            {editing ? <button type="button" className="settings-profile-edit" aria-label={`取消编辑${field.title}`} onPointerDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); finish(false); }}><X size={17}/></button> : <ChevronRight size={18} aria-hidden="true"/>}
          </div> : <span className="settings-account-email" title={field.value}>{field.value}</span>}</motion.div>
          {editing && error && <p id={errorId} className="settings-profile-field-error" role="alert" title={error}>{error}</p>}
        </motion.div>;
      })}
    </SpotlightCard>
    {overlay}
  </div>;
}
