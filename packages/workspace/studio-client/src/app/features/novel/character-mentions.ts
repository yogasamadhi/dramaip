import { Extension } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/** A character the chapter text may name, with what its hover card shows. */
export interface MentionCharacter {
  id: string;
  name: string;
  aliases: string[];
  role?: string;
  summary?: string;
  state?: string;
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const fields = (payload: unknown): Record<string, unknown> =>
  payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};

/**
 * The characters of a project as mention targets: each character's title
 * and aliases, its 角色定位 and 身份背景, and the latest 当前状态 recorded
 * for it in the story memory.
 */
export function mentionCharacters(
  characters: readonly {
    id: string;
    title: string;
    payload: unknown;
  }[],
  states: readonly {
    title: string;
    payload: unknown;
    updatedAt?: string;
  }[],
): MentionCharacter[] {
  const latest = [...states].sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
  return characters.flatMap((character) => {
    const name = character.title.trim();
    if (!name) return [];
    const aliases = text(fields(character.payload)["别名"])
      .split(/[,，、;；\s]+/)
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 1 && alias !== name);
    const state = latest.find(
      (item) =>
        item.title.includes(name) ||
        text(fields(item.payload)["关联角色"]) === name ||
        text(fields(item.payload)["人物"]) === name,
    );
    return [
      {
        id: character.id,
        name,
        aliases,
        role: text(fields(character.payload)["角色定位"]) || undefined,
        summary:
          text(fields(character.payload)["身份背景"]) ||
          text(fields(character.payload)["简介"]) ||
          undefined,
        state: state
          ? text(fields(state.payload)["当前状态"]) || undefined
          : undefined,
      },
    ];
  });
}

/**
 * Where the characters' names appear in a text: non-overlapping ranges,
 * longest name first so 「林小雨」 wins over 「小雨」.
 */
export function findMentions(
  value: string,
  characters: readonly MentionCharacter[],
): { from: number; to: number; id: string }[] {
  const names = characters
    .flatMap((character) =>
      [character.name, ...character.aliases].map((name) => ({
        name,
        id: character.id,
      })),
    )
    .filter((item) => item.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  const taken = new Array<boolean>(value.length).fill(false);
  const found: { from: number; to: number; id: string }[] = [];
  for (const { name, id } of names) {
    let index = value.indexOf(name);
    while (index >= 0) {
      const end = index + name.length;
      if (!taken.slice(index, end).some(Boolean)) {
        taken.fill(true, index, end);
        found.push({ from: index, to: end, id });
      }
      index = value.indexOf(name, end);
    }
  }
  return found.sort((a, b) => a.from - b.from);
}

const mentionKey = new PluginKey<DecorationSet>("characterMentions");

function decorate(
  doc: ProseMirrorNode,
  characters: readonly MentionCharacter[],
): DecorationSet {
  if (!characters.length) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const mention of findMentions(node.text, characters))
      decorations.push(
        Decoration.inline(pos + mention.from, pos + mention.to, {
          class: "novel-character-mention",
          "data-character-id": mention.id,
        }),
      );
  });
  return DecorationSet.create(doc, decorations);
}

/** Changes the characters the editor highlights. */
export function setMentionCharacters(
  view: EditorView,
  characters: readonly MentionCharacter[],
): void {
  view.dispatch(view.state.tr.setMeta(mentionKey, characters));
}

/**
 * Highlights the project's character names in the chapter text. It only
 * decorates: the document and what gets saved are left as they are.
 */
export const CharacterMentions = Extension.create({
  name: "characterMentions",
  addProseMirrorPlugins() {
    let characters: readonly MentionCharacter[] = [];
    return [
      new Plugin<DecorationSet>({
        key: mentionKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, previous, _old, next) {
            const changed = tr.getMeta(mentionKey) as
              readonly MentionCharacter[] | undefined;
            if (changed) characters = changed;
            if (changed || tr.docChanged) return decorate(next.doc, characters);
            return previous;
          },
        },
        props: {
          decorations: (state) => mentionKey.getState(state),
        },
      }),
    ];
  },
});
