export type NoteDoc = {
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  fields: Record<string, any>;
};
