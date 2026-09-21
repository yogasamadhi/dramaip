export type DraftSnapshot = {
  documentId: string;
  revision: number;
  title: string;
  content: string;
};

/** Serializes saves per document while allowing different documents to proceed independently. */
export class DocumentSaveQueue {
  readonly #chains = new Map<string, Promise<unknown>>();

  enqueue<Value>(
    documentId: string,
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const previous = this.#chains.get(documentId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.#chains.set(documentId, current);
    const clean = () => {
      if (this.#chains.get(documentId) === current)
        this.#chains.delete(documentId);
    };
    void current.then(clean, clean);
    return current;
  }
}

export function responseMatchesCurrentDraft(input: {
  snapshot: DraftSnapshot;
  activeDocumentId: string;
  currentRevision: number;
  currentTitle: string;
  currentContent: string;
}): boolean {
  return (
    input.activeDocumentId === input.snapshot.documentId &&
    input.currentRevision === input.snapshot.revision &&
    input.currentTitle.trim() === input.snapshot.title &&
    input.currentContent === input.snapshot.content
  );
}
