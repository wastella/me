'use client';
// Voice input for a text box. Three ways in, best first:
//  - Mac app: asks macOS to start its own Dictation in the focused field.
//  - Browsers with speech recognition (Safari on iPhone and Mac, Chrome):
//    we listen and append what you say.
//  - Otherwise: a hint to use the keyboard's mic key.
import { useEffect, useRef, useState } from 'react';

const Recognition = () => (typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

export function dictationMode() {
  if (typeof window === 'undefined') return 'none';
  if (window.meDesktop?.dictate) return 'native';
  if (Recognition()) return 'web';
  return 'none';
}

// `append(text)` gets each finished phrase.
export function useDictation({ fieldRef, append }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [hint, setHint] = useState('');
  const rec = useRef(null);
  const appendRef = useRef(append);
  appendRef.current = append;
  useEffect(() => () => rec.current?.abort(), []);

  const keyboardHint = () => setHint(/iPhone|iPad/.test(navigator.userAgent)
    ? 'Tap the mic on your keyboard to dictate.'
    : 'Press the Dictation key (or Fn twice) to dictate.');

  const start = () => {
    setHint('');
    const mode = dictationMode();
    fieldRef.current?.focus();
    if (mode === 'native') { window.meDesktop.dictate(); return; }
    if (mode !== 'web') { keyboardHint(); return; }
    const R = Recognition();
    const r = new R();
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) appendRef.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live.trim());
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      keyboardHint();
    };
    r.onend = () => { setListening(false); setInterim(''); rec.current = null; };
    try { r.start(); rec.current = r; setListening(true); } catch { keyboardHint(); }
  };
  const stop = () => rec.current?.stop();
  return { listening, interim, hint, start, stop, toggle: () => (listening ? stop() : start()) };
}

// Adds a phrase to the end of existing text with sensible spacing.
export function joinSpoken(text, phrase) {
  if (!phrase) return text;
  if (!text) return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  const sep = /\n$/.test(text) ? '' : /[.!?]$/.test(text.trim()) ? ' ' : /\s$/.test(text) ? '' : ' ';
  const p = /[.!?]\s*$/.test(text.trim()) ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
  return text + sep + p;
}

export function MicButton({ dictation, small }) {
  return (
    <button type="button" className={`icon-btn mic ${dictation.listening ? 'on' : ''} ${small ? 'small' : ''}`}
      title={dictation.listening ? 'Stop dictating' : 'Dictate'} aria-label={dictation.listening ? 'Stop dictating' : 'Dictate'}
      onMouseDown={(e) => e.preventDefault()} onClick={dictation.toggle}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      </svg>
    </button>
  );
}
