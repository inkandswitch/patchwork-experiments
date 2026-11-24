// The reference panel: the whole formula language on one searchable page, generated from
// lang/reference.ts. Clicking an example puts it in the formula bar to try.

import { For, Show, createMemo, createSignal } from 'solid-js';
import { FUNCTIONS, NOTES, SYNTAX, type Category, type FunctionDoc } from '../lang/reference';
import { FunctionHelp } from './Assist';
import { useSheet } from './state';

const CATEGORIES: Category[] = ['Logic', 'Math', 'Text and lookup'];

export function Reference() {
  const s = useSheet();
  const [query, setQuery] = createSignal('');
  const words = () => query().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (...texts: (string | undefined)[]) => {
    const haystack = texts.join(' ').toLowerCase();
    return words().every((word) => haystack.includes(word));
  };

  const matchingFunctions = (category: Category) =>
    FUNCTIONS.filter(
      (doc) =>
        doc.category === category &&
        matches(doc.name, doc.summary, doc.category, ...(doc.keywords ?? []), ...doc.params.flatMap((p) => [p.name, p.doc])),
    );
  const matchingForms = (section: (typeof SYNTAX)[number]) =>
    section.forms.filter((form) => matches(section.title, form.syntax, form.doc));

  // The page, top to bottom: the ways to make a cell hold several values (syntax first,
  // then functions), formulas in general, the other functions, and some notes.
  const [ambs, formulas] = SYNTAX;
  const sections = createMemo(() =>
    [
      { title: ambs.title, intro: ambs.intro, forms: matchingForms(ambs), docs: matchingFunctions('Several values') },
      { title: formulas.title, intro: formulas.intro, forms: matchingForms(formulas), docs: [] },
      ...CATEGORIES.map((category) => ({
        title: category as string,
        intro: undefined,
        forms: [],
        docs: matchingFunctions(category),
      })),
    ].filter((section) => section.forms.length + section.docs.length > 0),
  );
  const notes = createMemo(() => NOTES.filter((note) => matches(note.title, ...note.paragraphs)));
  const nothing = () => sections().length + notes().length === 0;

  /** Puts an example in the formula bar, for the selected cell. Enter keeps it, Esc doesn't. */
  const tryIt = (e: MouseEvent, text: string) => {
    s.beginEdit('bar', text);
    const bar = (e.currentTarget as HTMLElement).closest('.ambsheet')?.querySelector<HTMLInputElement>('.formula-bar input');
    bar?.focus();
  };

  const Example = (props: { text: string }) => (
    <button class="example-code" title="Try this in the selected cell" onClick={(e) => tryIt(e, props.text)}>
      {props.text}
    </button>
  );

  const FunctionEntry = (props: { doc: FunctionDoc }) => (
    <div class="entry">
      <FunctionHelp doc={props.doc} param={-1} />
      <Example text={props.doc.example} />
    </div>
  );

  return (
    <div class="reference">
      <input
        class="search"
        type="search"
        placeholder="Search the reference"
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      <Show when={!query()}>
        <p class="hint">
          While typing a formula, suggestions appear as you go (Ctrl+Space shows them all). Click any example here to
          try it in the selected cell.
        </p>
      </Show>
      <Show when={nothing()}>
        <p class="hint">Nothing matches “{query()}”.</p>
      </Show>

      <For each={sections()}>
        {(section) => (
          <section>
            <h3>{section.title}</h3>
            <Show when={section.intro && !query()}>
              <p class="hint">{section.intro}</p>
            </Show>
            <For each={section.forms}>
              {(form) => (
                <div class="entry">
                  <Show when={!form.syntax.startsWith('"')} fallback={<code>{form.syntax}</code>}>
                    <Example text={form.syntax} />
                  </Show>
                  <div class="summary">{form.doc}</div>
                </div>
              )}
            </For>
            <For each={section.docs}>{(doc) => <FunctionEntry doc={doc} />}</For>
          </section>
        )}
      </For>

      <For each={notes()}>
        {(note) => (
          <section>
            <h3>{note.title}</h3>
            <For each={note.paragraphs}>{(paragraph) => <p class="note-text">{paragraph}</p>}</For>
          </section>
        )}
      </For>
    </div>
  );
}
