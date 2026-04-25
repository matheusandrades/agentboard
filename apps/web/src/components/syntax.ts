/**
 * Tiny wrapper around Prism that pulls in the languages we actually
 * encounter in connected repos. Order matters — Prism grammars often
 * depend on earlier ones (jsx → javascript → clike → core, php needs
 * markup-templating, etc.). The imports below resolve those deps.
 *
 * `highlight(el, language)` rewrites the element's `language-*` class
 * and asks Prism to tokenize. If the requested grammar isn't loaded
 * (or fails halfway), we degrade to a plain `language-text` block — the
 * file still renders, just without colours.
 */
import Prism from 'prismjs';

// 1. Core grammar deps (must come before anything that builds on them)
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-markup-templating'; // PHP, EJS, etc.

// 2. JS family (each builds on `javascript`)
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';

// 3. Standalone / lower-dep grammars
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-php'; // depends on markup-templating
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-makefile';

const FALLBACK = 'text';

function setLangClass(el: HTMLElement, language: string): void {
  el.className = el.className
    .split(/\s+/)
    .filter((c) => !c.startsWith('language-'))
    .concat(`language-${language}`)
    .join(' ');
}

export function highlight(el: HTMLElement, language: string): void {
  // Resolve to a grammar Prism actually has loaded; fall back to plain
  // text so a missing grammar can never crash the page.
  const grammar = (Prism.languages as Record<string, unknown>)[language]
    ? language
    : FALLBACK;
  setLangClass(el, grammar);
  if (grammar === FALLBACK) return;
  try {
    Prism.highlightElement(el);
  } catch (err) {
    // Some grammars throw on edge-case input (unterminated strings,
    // template-literal weirdness, etc.). Don't blow up the file pane.
    setLangClass(el, FALLBACK);
    // eslint-disable-next-line no-console
    console.warn('[syntax] Prism highlight failed for', language, err);
  }
}
