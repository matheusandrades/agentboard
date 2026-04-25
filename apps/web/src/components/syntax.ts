/**
 * Tiny wrapper around Prism that pulls in the languages we actually
 * encounter in connected repos. Imports are sorted by frequency so the
 * common case (TS/TSX/JSON) is paid for first.
 *
 * `highlight(el, language)` removes any prior highlight class and
 * re-highlights the element. Re-runs are cheap because Prism is purely
 * synchronous over the textContent.
 */
import Prism from 'prismjs';
// Languages — order matters for some grammars (markup before others, jsx after js).
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
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
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-makefile';

export function highlight(el: HTMLElement, language: string): void {
  el.className = el.className
    .split(/\s+/)
    .filter((c) => !c.startsWith('language-'))
    .concat(`language-${language}`)
    .join(' ');
  Prism.highlightElement(el);
}
