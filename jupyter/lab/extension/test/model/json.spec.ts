import * as Automerge from '@automerge/automerge';
import { setAutomerge } from '../../src/model';
import { readString } from '../../src/model/json';

setAutomerge(Automerge);

describe('readString', () => {
  test('joins an nbformat multiline string stored as a list of lines', () => {
    const doc = Automerge.from({ source: ['import this\n', 'import math'] });
    expect(readString(doc.source)).toBe('import this\nimport math');
  });

  test('reads text and immutable strings as they are', () => {
    const doc = Automerge.from({
      text: 'print(1)',
      frozen: new Automerge.ImmutableString('print(2)')
    });
    expect(readString(doc.text)).toBe('print(1)');
    expect(readString(doc.frozen)).toBe('print(2)');
    expect(readString(undefined)).toBe('');
  });
});
