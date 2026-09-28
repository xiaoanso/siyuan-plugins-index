import { client } from "../../shared/api-client";
import { IBlockProcessor, ATTR_INDEX, ATTR_OUTLINE, ACTION_PUSH_TO_BOTTOM, ACTION_PUSH_TO_DOC } from "./processor";
import { ATTR_LINKED_AV, ATTR_LINKED_AV_BLOCK } from "../../shared/constants";
import { loadDbConfig } from "../av/av-setting/db-config";
import { buildAvHierarchy, getColIDMap } from "../../shared/utils/av-utils";

/**
 * 构建锁：防止同一列表块的并发构建/自动更新导致重复创建子文档。
 * 以 sourceBlockId 为键，串行化同一列表的构建任务。
 */
const buildLocks = new Map<string, Promise<void>>();

/**
 * 以列表块 ID 为粒度串行执行构建任务
 * @param sourceBlockId - 顶层列表块 ID
 * @param task - 构建任务
 */
export async function runWithBuildLock(sourceBlockId: string, task: () => Promise<void>) {
    const prev = buildLocks.get(sourceBlockId) || Promise.resolve();
    let nextRef: Promise<void>;
    const next = prev.then(() => task()).finally(() => {
        // 仅当队列尾仍是本次 promise 时才清理，避免误删后续排队任务
        if (buildLocks.get(sourceBlockId) === nextRef) {
            buildLocks.delete(sourceBlockId);
        }
    });
    nextRef = next;
    buildLocks.set(sourceBlockId, nextRef);
    await nextRef;
}

/**
 * 文档排序辅助函数
 * @param notebook - 笔记本 ID
 * @param paths - 文档路径数组
 */
async function changeSort(notebook: string, paths: string[]) {
    try {
        await fetch("/api/filetree/changeSort", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notebook, paths })
        });
    } catch (e) {
        console.error("Failed to sort docs", e);
    }
}

/**
 * ListProcessor - 列表处理器
 * 
 * Builder 核心处理器，负责递归处理列表块并同步到目标文档。
 * 支持两种构建模式：
 * - PUSH_TO_DOC: 推送到独立文档
 * - PUSH_TO_BOTTOM: 推送到文档底部标题
 * 
 * @example
 * ```typescript
 * const processor = new ListProcessor();
 * await processor.processRecursive(blockId, "NodeListItem", "PUSH_TO_DOC");
 * if (processor.errors.length > 0) {
 *     console.error("Build errors:", processor.errors);
 * }
 * ```
 */
export class ListProcessor {
    /** 错误信息收集 */
    errors: string[] = [];
    /** 底层块处理器实例 */
    ibp: IBlockProcessor;

    /**
     * 创建列表处理器实例
     */
    constructor() {
        this.ibp = new IBlockProcessor(this.errors);
    }

    /**
     * 递归处理列表块
     * @param blockId - 当前处理的块 ID
     * @param type - 块类型 ("NodeListItem" | "i" | "NodeList" | "l")
     * @param actionType - 构建动作类型
     * @param ctx - 处理上下文（可选）
     * @returns 处理结果
     */
    async processRecursive(blockId: string, type: string, actionType: string, ctx: any = null) {
        if (!ctx) {
            ctx = { previousId: null, parentId: null, level: 1 };
        }

        if (type === "NodeListItem" || type === "i") {
            const result = await this.ibp.processSingleItem(blockId, actionType, ctx);

            const resultId = (result && typeof result === 'object') ? result.id : result;
            if (resultId) ctx.previousId = resultId;

            const childCtx = {
                ...ctx,
                previousId: ctx.previousId,
                parentId: (actionType === "PUSH_TO_DOC") ? resultId : ctx.parentId,
                level: ctx.level + 1,
                parentInfo: ((actionType === "PUSH_TO_DOC") && result && typeof result === 'object') ? result : ctx.parentInfo
            };

            let childrenRes = await client.sql({
                stmt: `SELECT id, type, subtype FROM blocks WHERE parent_id = '${blockId}' AND type = 'l' ORDER BY sort ASC`
            });
            let children = childrenRes.data || [];

            for (const child of children) {
                await this.processRecursive(child.id, "NodeList", actionType, childCtx);
                ctx.previousId = childCtx.previousId;
            }
            return result;

        } else if (type === "NodeList" || type === "l") {
            let nextCtx = { ...ctx };
            const attrs = await client.getBlockAttrs({ id: blockId });

            if (attrs.data && attrs.data[ATTR_LINKED_AV]) {
                const avId = attrs.data[ATTR_LINKED_AV];
                const avBlockId = attrs.data[ATTR_LINKED_AV_BLOCK] || blockId;

                nextCtx.avId = avId;
                nextCtx.dbConfig = await loadDbConfig(avBlockId);
                const colInfo = await getColIDMap(avId);
                nextCtx.colIDMap = colInfo;
                nextCtx.parentMap = await buildAvHierarchy(colInfo.keyValues, colInfo.itemToBlock);
            }
            await this.processListBatch(blockId, actionType, nextCtx);
        }
    }

    async processListBatch(blockId: string, actionType: string, ctx: any) {
        let children: any[] = [];
        try {
            const response = await fetch("/api/block/getChildBlocks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: blockId })
            });
            const res = await response.json();
            if (res.code === 0 && res.data) {
                children = res.data;
            }
        } catch (e) {
            console.error("[Builder] Failed to get AST", e);
            return;
        }

        if (children.length === 0) return;

        const itemIds = children.map((c: any) => `'${c.id}'`).join(",");

        const [sourceItemsRes, sourceContentRes] = await Promise.all([
            client.sql({ stmt: `SELECT id, ial FROM blocks WHERE id IN (${itemIds})` }),
            client.sql({ stmt: `SELECT parent_id, id, markdown, content FROM blocks WHERE parent_id IN (${itemIds}) AND type='p'` })
        ]);

        const sourceMap = new Map();
        sourceItemsRes.data?.forEach((i: any) => sourceMap.set(i.id, i));

        const contentMap = new Map();
        sourceContentRes.data?.forEach((p: any) => {
            if (!contentMap.has(p.parent_id)) contentMap.set(p.parent_id, []);
            contentMap.get(p.parent_id).push(p);
        });

        const targetIds = new Set<string>();
        sourceItemsRes.data?.forEach((i: any) => {
            const ial = i.ial || "";
            const docMatch = ial.match(new RegExp(`${ATTR_INDEX}="([^"]+)"`));
            if (docMatch) targetIds.add(`'${docMatch[1]}'`);
            const headingMatch = ial.match(new RegExp(`${ATTR_OUTLINE}="([^"]+)"`));
            if (headingMatch) targetIds.add(`'${headingMatch[1]}'`);
        });

        let targetMap = new Map();
        if (targetIds.size > 0) {
            const targetRes = await client.sql({
                stmt: `SELECT id, content, type, sort, ial, markdown, box, path, hpath FROM blocks WHERE id IN (${Array.from(targetIds).join(",")})`
            });
            targetRes.data?.forEach((t: any) => targetMap.set(t.id, t));
        }

        let docPaths: string[] = [];
        let notebookId: string | null = null;

        for (const child of children) {
            const sourceItem = sourceMap.get(child.id);
            const pBlocks = contentMap.get(child.id) || [];
            const core = this.ibp.parseItemContent(child.id, pBlocks);
            if (!core) {
                continue;
            }
            let docTargetId = null;
            let headingTargetId = null;
            if (sourceItem?.ial) {
                const dM = sourceItem.ial.match(new RegExp(`${ATTR_INDEX}="([^"]+)"`));
                if (dM) docTargetId = dM[1];
                const hM = sourceItem.ial.match(new RegExp(`${ATTR_OUTLINE}="([^"]+)"`));
                if (hM) headingTargetId = hM[1];
            }

            const docTarget = docTargetId ? targetMap.get(docTargetId) : null;
            const headingTarget = headingTargetId ? targetMap.get(headingTargetId) : null;

            // --- Database-Driven Inheritance ---
            // Inheritance is now fully handled in the database side (syncInheritanceToDb).
            // We simply serve what the database provides to the documents!
            let currentItemResolved: any = {};
            if (ctx.avId) {
                const itemAttrs = this.ibp.parseIAL(sourceItem?.ial);
                currentItemResolved = await this.ibp.getLinkedAVData(child.id, itemAttrs, ctx.avId) || {};
            }

            const itemCtx = {
                ...ctx,
                inheritedAttrs: currentItemResolved,
                itemResolvedAttrs: currentItemResolved
            };

            let needsUpdate = false;

            if (actionType === "PUSH_TO_DOC") {
                if (!docTarget) {
                    console.log(`[Builder] Item ${child.id} has no target doc, PUSH needed.`);
                    needsUpdate = true;
                } else {
                    if (docTarget.content !== core.syncText) {
                        console.log(`[Builder] Item ${child.id} content mismatch: "${docTarget.content}" !== "${core.syncText}". Update needed.`);
                        needsUpdate = true;
                    } else {
                        const localValues = await this.ibp.getLinkedAVData(child.id, this.ibp.parseIAL(sourceItem?.ial), ctx.avId);

                        let desiredIcon = localValues?.icon ? (/[^\u0000-\u007F]/.test(localValues.icon) ? this.ibp.emojiToHex(localValues.icon) : localValues.icon) : (core.currentIcon ? this.ibp.emojiToHex(core.currentIcon) : "");

                        // USER REQUEST: Ignore default text emojis 📄, 📑 and separator ➖ to prevent infinite update loop.
                        if (desiredIcon === "📄" || desiredIcon === "📑" || desiredIcon === "➖" ||
                            desiredIcon === "1f4c4" || desiredIcon === "1f4d1" || desiredIcon === "2796") {
                            desiredIcon = "";
                        }

                        // USER REQUEST: Ignore dynamic icons and custom SVG images for target property inheritance.
                        if (desiredIcon.startsWith("api/icon/") || desiredIcon.includes(".")) {
                            desiredIcon = "";
                        }

                        const desiredImg = localValues?.["title-img"] || "";

                        const iconMatch = (docTarget.ial || "").match(/icon="([^"]+)"/);
                        const currentDocIcon = iconMatch ? iconMatch[1] : "";
                        const imgMatch = (docTarget.ial || "").match(/title-img="([^"]+)"/);
                        const currentDocImg = imgMatch ? imgMatch[1] : "";

                        if (currentDocIcon !== desiredIcon) {
                            console.log(`[Builder] Update needed due to Icon mismatch for ${child.id}: ${currentDocIcon} !== ${desiredIcon}`);
                            needsUpdate = true;
                        } else if (currentDocImg !== desiredImg) {
                            console.log(`[Builder] Update needed due to Image mismatch for ${child.id}: ${currentDocImg} !== ${desiredImg}`);
                            needsUpdate = true;
                        }
                    }
                }
            }

            if (actionType === "PUSH_TO_BOTTOM") {
                if (!headingTarget) needsUpdate = true;
                else if (!headingTarget.content.includes(core.syncText)) needsUpdate = true;
            }

            let result = null;
            if (needsUpdate) {
                result = await this.processRecursive(child.id, "NodeListItem", actionType, itemCtx);
            } else {
                const combinedResult: any = {};
                if (docTarget) {
                    combinedResult.id = docTarget.id;
                    combinedResult.notebook = docTarget.box;
                    combinedResult.path = docTarget.path;
                    combinedResult.hpath = docTarget.hpath;
                }
                if (headingTarget) combinedResult.id = headingTarget.id;
                if (combinedResult.id) result = combinedResult;

                const resultId = (result && typeof result === 'object') ? result.id : result;
                if (resultId) ctx.previousId = resultId;

                const childCtx = {
                    ...ctx,
                    previousId: ctx.previousId,
                    parentId: (actionType === "PUSH_TO_DOC") ? resultId : ctx.parentId,
                    level: ctx.level + 1,
                    parentInfo: ((actionType === "PUSH_TO_DOC") && result && typeof result === 'object') ? result : ctx.parentInfo,
                    inheritedAttrs: currentItemResolved // Propagate inheritance to children even if skip update
                };

                let subListsRes = await client.sql({
                    stmt: `SELECT id, type, subtype FROM blocks WHERE parent_id = '${child.id}' AND type = 'l' ORDER BY sort ASC`
                });
                let subLists = subListsRes.data || [];

                for (const subList of subLists) {
                    await this.processRecursive(subList.id, "NodeList", actionType, childCtx);
                    ctx.previousId = childCtx.previousId;
                }
            }

            if (actionType === "PUSH_TO_DOC" && result && typeof result === 'object' && result.path) {
                docPaths.push(result.path);
                notebookId = result.notebook;
            }
        }

        if (docPaths.length > 0 && notebookId) {
            await changeSort(notebookId, docPaths);
        }
    }
}