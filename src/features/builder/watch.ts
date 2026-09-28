/**
 * watch.ts
 *
 * 构造器实时监听 (Builder Watch)
 *
 * 解决两个问题：
 * 1. 删除构造器托管的子文档时，源列表项 IAL 仍指向已删除文档（悬空引用），
 *    正文中残留 siyuan://blocks/<docId> 链接，且不会实时刷新。
 * 2. 下一次构建/自动更新时，由于悬空 IAL 不存在，会重新创建文档，
 *    与用户手动新建的文档形成"多次创建"的错觉。
 *
 * 本模块监听 ws-main 事务中的 deleteBlock 操作，当被删文档被任意列表项的
 * custom-index-subdoc-id 引用时，立即：
 *   - 清除该列表项 IAL 中的悬空引用
 *   - 移除列表项正文中指向该文档的链接（保留纯文本）
 */

import { client } from "../../shared/api-client";
import { ATTR_INDEX } from "./processor";

/** 防抖定时器 */
let debounceTimer: any = null;
/** 待处理的已删除文档 ID 集合 */
const pendingDeletedDocIds = new Set<string>();

/**
 * 监听 ws-main 事务，收集被删除的块 ID
 * @param event - 事件对象
 */
function collectDeletedBlocks(event: any): string[] {
    const detail = event?.detail || event;
    const cmd = detail?.cmd;
    if (cmd !== "transactions" && cmd !== "doOperations") {
        return [];
    }

    const ops = detail?.data?.[0]?.doOperations || detail?.data || [];
    if (!Array.isArray(ops)) {
        return [];
    }

    const deletedIds: string[] = [];
    for (const op of ops) {
        const action = op.action || "";
        // 删除块事务（文档、标题等）
        if (action === "deleteBlock") {
            const blockId = op.id || op.blockID || op.mID;
            if (blockId) {
                deletedIds.push(blockId);
            }
        }
    }
    return deletedIds;
}

/**
 * 清除单个列表项中指向被删文档的悬空引用
 * @param listItemId - 源列表项 ID
 * @param docId - 被删除的文档 ID
 */
async function clearStaleDocRef(listItemId: string, docId: string) {
    try {
        // 1. 清除 IAL 中的悬空 custom-index-subdoc-id 引用
        await client.setBlockAttrs({ id: listItemId, attrs: { [ATTR_INDEX]: "" } });

        // 2. 移除列表项正文中指向被删文档的链接，保留纯文本
        const contentRes = await client.sql({
            stmt: `SELECT id, markdown FROM blocks WHERE parent_id = '${listItemId}' AND type = 'p' ORDER BY sort ASC LIMIT 1`
        });
        const p = contentRes.data?.[0];
        if (p && p.markdown) {
            const linkRegex = new RegExp(`\\[(?:[^\\]]*)\\]\\(siyuan://blocks/${docId}\\)`, "g");
            const newMd = p.markdown.replace(linkRegex, "").replace(/\s{2,}/g, " ").trim();
            if (newMd !== p.markdown) {
                await client.updateBlock({ id: p.id, dataType: "markdown", data: newMd });
            }
        }
        console.log(`[BuilderWatch] Cleared stale doc ref ${docId} from list item ${listItemId}`);
    } catch (e) {
        console.error("[BuilderWatch] Failed to clear stale doc ref", listItemId, docId, e);
    }
}

/**
 * 防抖处理：批量清理所有悬空引用
 */
async function flushPendingCleanup() {
    if (pendingDeletedDocIds.size === 0) {
        return;
    }

    const docIds = Array.from(pendingDeletedDocIds);
    pendingDeletedDocIds.clear();

    for (const docId of docIds) {
        try {
            // 反向查找所有引用该文档的列表项（IAL 中记录了 custom-index-subdoc-id）
            const refRes = await client.sql({
                stmt: `SELECT id FROM blocks WHERE ial LIKE '%${ATTR_INDEX}="${docId}"%' LIMIT 50`
            });
            for (const item of (refRes.data || [])) {
                await clearStaleDocRef(item.id, docId);
            }
        } catch (e) {
            console.error("[BuilderWatch] Failed to query stale refs for", docId, e);
        }
    }
}

/**
 * 初始化构造器实时监听
 * @param plugin - 插件实例
 * @returns 注销函数
 */
export function initBuilderWatch(plugin: any) {
    const handler = (event: any) => {
        const deletedIds = collectDeletedBlocks(event);
        if (deletedIds.length === 0) {
            return;
        }

        for (const id of deletedIds) {
            pendingDeletedDocIds.add(id);
        }

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
            void flushPendingCleanup();
        }, 200);
    };

    plugin?.eventBus?.on("ws-main", handler);

    return () => {
        plugin?.eventBus?.off("ws-main", handler);
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        pendingDeletedDocIds.clear();
    };
}