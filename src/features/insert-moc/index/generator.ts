import { client } from "../../../shared/api-client";
import { escapeHtml, i18n } from "../../../shared/utils";
import { getProcessedDocIcon } from "../../../shared/utils/icon-utils";
import { IndexQueue, IndexQueueNode } from "../../../shared/utils/index-queue";
import { settings } from "../../../core/settings";
import { generateOutlineMarkdown } from "../outline/generator";
import { requestGetDocOutline, collectOutlineIds, getBlocksData } from "../../../shared/api-client/query";
import { StrategyRegistry, RenderContext } from "../../../shared/render/strategy";

const SUMMARY_MAX_CHARS = 80;
const CARD_IAL = `{: style="border: 1px solid var(--b3-border-color); border-radius: 4px; padding: 4px 8px;" custom-index="card"}`;
const COVER_IAL = `{: style="width: 100%; max-height: 140px; object-fit: cover; display: block; border-radius: 2px; margin: 0;"}`;
/** 卡片看板容器：扁平 row 超级块，由 CSS Grid 自适应分列 */
const BOARD_IAL = `\n{: custom-index="board"}`;

export interface IndexConfig {
    depth?: number;
    listType?: string;
    linkType?: string;
    layoutType?: string;
    icon?: boolean;
    fold?: number;
}

function resolveLayoutType(config?: IndexConfig): string {
    return config?.layoutType ?? settings.get("layoutType") ?? "list";
}

function truncateSummary(text: string, max = SUMMARY_MAX_CHARS): string {
    const chars = Array.from(text.replace(/\s+/g, " ").trim());
    if (chars.length <= max) return chars.join("");
    return chars.slice(0, max).join("") + "…";
}

/** Extract usable image URL from document IAL `title-img` (CSS background or bare path). */
function extractTitleImgUrl(titleImgAttr: string): string | null {
    if (!titleImgAttr) return null;
    const raw = titleImgAttr
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .trim();

    const urlMatch = raw.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
    if (urlMatch?.[2]) {
        const url = urlMatch[2].trim();
        // Skip CSS gradients / data URIs that are not file assets
        if (!url || /^data:/i.test(url)) return null;
        return url;
    }

    // Bare asset / http(s) path stored directly
    if (/^(assets\/|public\/|https?:\/\/|\/\/)/i.test(raw)) return raw;
    return null;
}

function getAttrFromIal(ial: string, key: string): string {
    if (!ial) return "";
    const re = new RegExp(`${key}="([^"]*)"`);
    const m = ial.match(re);
    return m?.[1] || "";
}

/** Batch-load document title-img cover URLs. */
async function fetchTitleImgUrls(docIds: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    if (!docIds.length) return result;

    const idList = docIds.map((id) => `'${id}'`).join(",");
    try {
        const rs = await client.sql({
            stmt: `SELECT id, ial FROM blocks WHERE type = 'd' AND id IN (${idList})`
        });
        for (const row of rs.data || []) {
            const titleImg = getAttrFromIal(row.ial || "", "title-img");
            const url = extractTitleImgUrl(titleImg);
            if (url) result[row.id] = url;
        }
    } catch (err) {
        console.error("[IndexPlugin] Failed to fetch document title images:", err);
    }
    return result;
}

/** First non-empty top-level paragraph per document root. */
async function fetchFirstParagraphSummaries(docIds: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    if (!docIds.length) return result;

    const idList = docIds.map((id) => `'${id}'`).join(",");
    try {
        const rs = await client.sql({
            stmt: `SELECT root_id, content FROM blocks
                   WHERE type = 'p' AND parent_id = root_id
                     AND content IS NOT NULL AND TRIM(content) != ''
                     AND root_id IN (${idList})
                   ORDER BY root_id ASC, sort ASC`
        });
        for (const row of rs.data || []) {
            if (result[row.root_id]) continue;
            const plain = truncateSummary(String(row.content || ""));
            if (plain) result[row.root_id] = escapeHtml(plain);
        }
    } catch (err) {
        console.error("[IndexPlugin] Failed to fetch document summaries:", err);
    }
    return result;
}

async function generateSuperblockCardIndex(
    notebookId: any,
    ppath: any,
    pitem: IndexQueue,
    config?: IndexConfig
) {
    const listTypeSetting = config?.listType !== undefined ? config.listType : settings.get("listType");
    const linkTypeSetting = config?.linkType !== undefined ? config.linkType : settings.get("linkType");
    const iconEnabled = config?.icon !== undefined ? config.icon : (settings.get("icon") ?? false);

    let docs;
    try {
        docs = await client.listDocsByPath({
            notebook: notebookId,
            path: ppath
        });
    } catch (err) {
        console.error(`Failed to list docs for path "${ppath}":`, err);
        return;
    }

    if (!docs?.data?.files?.length) return;

    const files = docs.data.files;
    const docIds = files.map((f: any) => f.id);
    const [summaries, covers] = await Promise.all([
        fetchFirstParagraphSummaries(docIds),
        fetchTitleImgUrls(docIds)
    ]);
    const allHaveSySuffix = files.every((f: any) => f.name.endsWith(".sy"));

    const titleContext: RenderContext = {
        linkType: linkTypeSetting,
        iconEnabled: iconEnabled,
        listType: listTypeSetting as "unordered" | "ordered",
        isOutline: false,
        omitListMarker: true
    };
    const strategy = StrategyRegistry.get(linkTypeSetting);

    for (const doc of files) {
        const id = doc.id;
        const rawName = allHaveSySuffix ? doc.name.slice(0, -3) : doc.name;
        const name = escapeHtml(rawName);
        const subFileCount = doc.subFileCount;
        const iconStr = iconEnabled ? getProcessedDocIcon(doc.icon, subFileCount != 0) : "";
        const titleLine = strategy.render(
            { id, text: name, anchor: iconStr || undefined },
            titleContext,
            ""
        );

        let card = "{{{row\n";
        const coverUrl = covers[id];
        if (coverUrl) {
            // Escape ")" in URL for markdown image syntax
            const safeUrl = coverUrl.replace(/\)/g, "%29");
            card += `![cover](${safeUrl})\n${COVER_IAL}\n\n`;
        }
        card += `${titleLine}\n`;
        const summary = summaries[id];
        if (summary) {
            card += `\n${summary}\n`;
        }

        card += `}}}\n${CARD_IAL}\n`;
        pitem.push(new IndexQueueNode(1, card));
    }
}

export async function generateIndex(notebookId: any, ppath: any, pitem: IndexQueue, tab = 0, config?: IndexConfig) {
    if (resolveLayoutType(config) === "superblock-card" && tab === 0) {
        await generateSuperblockCardIndex(notebookId, ppath, pitem, config);
        return;
    }

    const depth = config?.depth !== undefined ? config.depth : settings.get("depth");
    const listTypeSetting = config?.listType !== undefined ? config.listType : settings.get("listType");
    const linkTypeSetting = config?.linkType !== undefined ? config.linkType : settings.get("linkType");
    const iconEnabled = config?.icon !== undefined ? config.icon : (settings.get("icon") ?? false);

    if (depth !== 0 && tab >= depth) return;

    let docs;
    try {
        docs = await client.listDocsByPath({
            notebook: notebookId,
            path: ppath
        });
    } catch (err) {
        console.error(`Failed to list docs for path "${ppath}":`, err);
        return;
    }

    if (!docs?.data?.files) return;

    const renderContext: RenderContext = {
        linkType: linkTypeSetting,
        iconEnabled: iconEnabled,
        listType: listTypeSetting as "unordered" | "ordered",
        isOutline: false
    };

    const strategy = StrategyRegistry.get(linkTypeSetting);
    tab++;

    const allHaveSySuffix = docs.data.files.every((f: any) => f.name.endsWith(".sy"));

    for (let doc of docs.data.files) {
        const id = doc.id;
        const rawName = allHaveSySuffix ? doc.name.slice(0, -3) : doc.name;
        const name = escapeHtml(rawName);
        const subFileCount = doc.subFileCount;
        const path = doc.path;

        let indent = "";
        for (let n = 1; n < tab; n++) {
            indent += '    ';
        }

        let iconStr = iconEnabled ? getProcessedDocIcon(doc.icon, subFileCount != 0) : "";

        const renderItem = {
            id: id,
            text: name,
            anchor: iconStr || undefined
        };

        const markdown = strategy.render(renderItem, renderContext, indent) + "\n";
        
        let item = new IndexQueueNode(tab, markdown);
        pitem.push(item);

        if (subFileCount > 0) {
            await generateIndex(notebookId, path, item.children, tab, config);
        }
    }
}

export async function generateIndexAndOutline(notebookId: any, ppath: any, pitem: IndexQueue, tab = 0, config?: IndexConfig) {
    const depth = config?.depth !== undefined ? config.depth : settings.get("depth");
    const listTypeSetting = config?.listType !== undefined ? config.listType : settings.get("listType");
    const linkTypeSetting = config?.linkType !== undefined ? config.linkType : settings.get("linkType");
    const iconEnabled = config?.icon !== undefined ? config.icon : (settings.get("icon") ?? false);

    if (depth !== 0 && tab >= depth) return;

    let docs;
    try {
        docs = await client.listDocsByPath({
            notebook: notebookId,
            path: ppath
        });
    } catch (err) {
        console.error(`Failed to list docs for path "${ppath}":`, err);
        return;
    }

    if (!docs?.data?.files?.length) return;

    const renderContext: RenderContext = {
        linkType: linkTypeSetting,
        iconEnabled: iconEnabled,
        listType: listTypeSetting as "unordered" | "ordered",
        isOutline: false
    };

    const strategy = StrategyRegistry.get(linkTypeSetting);
    tab++;

    const allHaveSySuffix = docs.data.files.every((f: any) => f.name.endsWith(".sy"));

    for (let doc of docs.data.files) {
        try {
            const id = doc.id;
            const rawName = allHaveSySuffix ? doc.name.slice(0, -3) : doc.name;
            const name = escapeHtml(rawName);
            const subFileCount = doc.subFileCount;
            const path = doc.path;

            let indent = "";
            for (let n = 1; n < tab; n++) {
                indent += '    ';
            }

            let iconStr = iconEnabled ? getProcessedDocIcon(doc.icon, subFileCount != 0) : "";

            const renderItem = {
                id: id,
                text: name,
                anchor: iconStr || undefined
            };

            let markdown = strategy.render(renderItem, renderContext, indent) + "\n";

            const outlineData = await requestGetDocOutline(id);
            const outlineIds = collectOutlineIds(outlineData);
            const extraData = await getBlocksData(outlineIds);
            
            markdown += generateOutlineMarkdown(outlineData, tab, tab, extraData);

            let item = new IndexQueueNode(tab, markdown);
            pitem.push(item);

            if (subFileCount > 0) {
                await generateIndexAndOutline(notebookId, path, item.children, tab, config);
            }
        } catch (err) {
            console.error(`Failed to process document "${doc.id}"`, err);
        }
    }
}

function queuePopAllSuperblockCards(queue: IndexQueue, data: string) {
    if (queue.getFront()?.depth == undefined) {
        return data;
    }

    const queuedNodes = queue.toArray();
    if (queuedNodes.length === 0) return data;

    const inner = queuedNodes.map((node) => node.text).join("\n");
    return `${data}{{{row\n${inner}}}}\n${BOARD_IAL}`;
}

export function queuePopAll(queue: IndexQueue, data: string, config?: IndexConfig) {
    if (resolveLayoutType(config) === "superblock-card") {
        return queuePopAllSuperblockCards(queue, data);
    }

    if (queue.getFront()?.depth == undefined) {
        return "";
    }

    // 列表布局（layoutType = "list"）：单列垂直层级目录树。
    // 性能优化：避免两处 O(n²)——queue.shift() 数组前移 与 data += 不可变字符串复制，
    // 改为数组索引遍历 + 引用数组收集（O(1) 摊销 push，整体 O(n)）。
    const foldSetting = Number(config?.fold !== undefined ? config.fold : settings.get("fold")) || 0;
    const listTypeSetting = config?.listType !== undefined ? config.listType : settings.get("listType");

    const parts: string[] = [];
    collectListParts(queue, parts, foldSetting, listTypeSetting);

    return data + parts.join("");
}

/**
 * 递归收集列表层级文本到 parts 数组（引用传递，整体 O(n)）
 * @param queue - 当前层队列
 * @param parts - 结果收集数组（引用）
 * @param foldSetting - 折叠层级设置
 * @param listTypeSetting - 列表类型（unordered / ordered）
 */
function collectListParts(
    queue: IndexQueue,
    parts: string[],
    foldSetting: number,
    listTypeSetting: string
) {
    const nodes = queue.toArray();
    // 通过数组索引遍历，避免 pop() 内部 shift() 造成的 O(n) 元素前移
    for (let i = 0; i < nodes.length; i++) {
        const item = nodes[i];

        if (!item.children.isEmpty() && foldSetting != 0 && foldSetting <= item.depth) {
            let n = 0;
            if (listTypeSetting == "unordered") {
                n = item.text.indexOf("*");
                if (n !== -1)
                    item.text = item.text.substring(0, n + 2) + '{: fold="1"}' + item.text.substring(n + 2);
            } else {
                n = item.text.indexOf("1");
                if (n !== -1)
                    item.text = item.text.substring(0, n + 3) + '{: fold="1"}' + item.text.substring(n + 3);
            }
        }
        parts.push(item.text);

        if (!item.children.isEmpty()) {
            collectListParts(item.children, parts, foldSetting, listTypeSetting);
        }
    }
}
