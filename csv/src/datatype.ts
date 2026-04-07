export type CsvDoc = {
  '@patchwork': { type: 'csv' };
  title?: string;
  content: string;
};

export const CsvDatatype = {
  init(doc: CsvDoc) {
    doc.content = '';
  },
  getTitle(doc: CsvDoc) {
    return doc.title || 'Untitled CSV';
  },
  setTitle(doc: CsvDoc, title: string) {
    doc.title = title;
  },
};
