# Index Plugin — Domain Context

Glossary and bounded language for the directory (MOC) feature and related settings. Prefer these terms in issues, ADRs, and implementation names.

## Glossary

| Term | Definition |
|------|------------|
| **Index** | A generated directory of child documents under the current document (插入目录). Identified by root IAL `custom-index-create`. |
| **Outline** | A generated TOC of headings inside the current document (插入大纲). Out of scope for Superblock Card v1. |
| **Notebook Index** | Directory generated for a whole notebook. Out of scope for Superblock Card v1. |
| **List Type (`listType`)** | Marker style for list items: `unordered` \| `ordered`. |
| **Link Type (`linkType`)** | How a title points to a doc: `link` \| `reference` \| `dynamic-ref`. |
| **Layout Type (`layoutType`)** | Presentation of the Index: `list` (default) \| `superblock-card`. Orthogonal to `listType` and `linkType`. |
| **Superblock Card** | One Index entry rendered as a SiYuan content superblock containing: optional Cover Image, title row (optional icon + linked title), optional summary paragraph. Direct children of the current document only; no nested child list. |
| **Cover Image** | Document header image from IAL `title-img` (题头图). Shown at the top of a Superblock Card when present; omitted if missing or not a resolvable URL. |
| **Index Root Container** | Outer `{{{row` wrapper holding all Superblock Cards as **direct children** (`custom-index="board"`). CSS Grid fence, not nested `{{{col`. Sole owner of `custom-index-create`. |
| **Summary** | Plain text from the first non-empty top-level paragraph (`type = p`) of the target document, truncated to 80 characters. If none, the summary row is omitted. |
| **Child List** | Nested ordered/unordered list used by **list** layout for deeper documents; reuses `listType`, `linkType`, `depth`, and `fold`. Superblock Card layout does not emit Child Lists. |

## Avoid

- Do not overload `listType` or `linkType` to mean Superblock Card layout.
- Do not call Summary “alias” or “description” unless the source later changes from first paragraph.
- Do not hang `custom-index-create` on individual cards; only on the Index Root Container.

## Related decisions

- [ADR 0001 — 目录超级块卡片布局](docs/adr/0001-目录超级块卡片布局.md)
