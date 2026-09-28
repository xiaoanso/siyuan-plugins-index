import { autoUpdateIndex } from "../features/insert-moc/index/action";
import { autoUpdateOutline } from "../features/insert-moc/outline/action";
import { autoUpdateBuilder } from "../features/builder/auto-update";
import { autoUpdateListAVs } from "../features/av/list/auto-update";
import { isMobile } from "../shared/utils";
import { client } from "../shared/api-client";
import { shouldSkipAutoUpdate, computeFingerprint, storeFingerprint } from "../shared/utils/fingerprint";

/** 块类型解析出的 config 来源属性名 */
const INDEX_CONFIG_ATTR = "custom-index-create";
const OUTLINE_CONFIG_ATTR = "custom-outline-create";
const BUILDER_CONFIG_ATTR = "custom-tree-create";

/** 从块 IAL 解析配置 JSON */
function parseLocalConfig(ial: string, attrName: string): any {
    if (!ial) return null;
    const re = new RegExp(`${attrName}="([^"]*)"`);
    const m = ial.match(re);
    if (!m || !m[1]) return null;
    const raw = m[1]
        .replace(/"/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&/g, "&");
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/** 扩展自动更新判断：先算指纹，跳过无变化刷新；返回是否需要调用真正更新 */
async function shouldRefresh(
    block: any,
    configAttr: string
): Promise<boolean> {
    try {
        const domRes = await client.getBlockDOM({ id: block.id });
        const dom = domRes?.data?.dom || "";

        // 若指纹为空（例如无可引用文档），强制刷新一次
        const config = parseLocalConfig(block.ial || "", configAttr);
        const fingerprint = await computeFingerprint(dom, config);
        if (!fingerprint) {
            return true;
        }

        return !(await shouldSkipAutoUpdate(block.id, dom, config));
    } catch (err) {
        console.error("[AutoUpdate] Fingerprint check failed:", err);
        return true;
    }
}

/**
 * 自动更新执行完毕后，用最新 DOM 生成并落盘指纹。
 * 若更新函数因内部条件提前 return（未真正写 DOM），
 * 此处写入的是旧内容指纹 —— 内容未变本应跳过，无副作用；
 * 若更新真正写入了新内容，则写入最新指纹，下次正确跳过。
 */
async function persistFingerprintAfterRefresh(
    block: any,
    configAttr: string
) {
    try {
        const domRes = await client.getBlockDOM({ id: block.id });
        const dom = domRes?.data?.dom || "";
        const config = parseLocalConfig(block.ial || "", configAttr);
        const fingerprint = await computeFingerprint(dom, config);
        if (fingerprint) {
            await storeFingerprint(block.id, fingerprint);
        }
    } catch (err) {
        console.error("[AutoUpdate] Fingerprint persist failed:", err);
    }
}

export async function execAutoUpdate(parentId: string, notebookId: string, path: string) {
    // Single query for Index, Outline, Builder, and bound List AVs.
    // 性能优化：原 SQL 用 blocks.ial LIKE '%name%' 无法命中索引（全表扫描）；
    // 改用 attributes 表（name 有索引）JOIN blocks，按 root_id + name 精确命中，
    // 与项目其它模块（sync-service / data-db-management 等）保持一致的索引友好做法。
    let rs = await client.sql({
        stmt: `SELECT DISTINCT b.* FROM blocks b
               JOIN attributes a ON a.block_id = b.id
               WHERE b.root_id = '${parentId}'
                 AND a.name IN ('custom-index-create', 'custom-outline-create', 'custom-tree-create', 'custom-index-linked-av')
               ORDER BY b.updated DESC
               LIMIT 50`
    });

    let indexBlock = null;
    let outlineBlock = null;
    let builderBlock = null;
    let listBlocks = [];

    if (rs.data) {
        for (const block of rs.data) {
            // console.log(`[IndexPlugin] Checking block ${block.id}: ${block.ial}`);
            if (block.ial.includes("custom-index-create") && !indexBlock) {
                indexBlock = block;
            }
            if (block.ial.includes("custom-outline-create") && !outlineBlock) {
                outlineBlock = block;
            }
            if (block.ial.includes("custom-tree-create") && !builderBlock) {
                builderBlock = block;
            }
            if (block.ial.includes("custom-index-linked-av")) {
                listBlocks.push(block);
            }
        }
    }

    if (listBlocks.length > 0) {
        for (const listBlock of listBlocks) {
            await autoUpdateListAVs(listBlock);
        }
    }

    // 2. Others —— 指纹判断，无变化则跳过；真正刷新后落指纹
    if (indexBlock) {
        if (await shouldRefresh(indexBlock, INDEX_CONFIG_ATTR)) {
            await autoUpdateIndex(notebookId, path, parentId, indexBlock);
            await persistFingerprintAfterRefresh(indexBlock, INDEX_CONFIG_ATTR);
        }
    }
    if (outlineBlock) {
        if (await shouldRefresh(outlineBlock, OUTLINE_CONFIG_ATTR)) {
            await autoUpdateOutline(parentId, outlineBlock);
            await persistFingerprintAfterRefresh(outlineBlock, OUTLINE_CONFIG_ATTR);
        }
    }
    if (builderBlock) {
        if (await shouldRefresh(builderBlock, BUILDER_CONFIG_ATTR)) {
            await autoUpdateBuilder(parentId, builderBlock);
            await persistFingerprintAfterRefresh(builderBlock, BUILDER_CONFIG_ATTR);
        }
    }
}

/**
 * 文档加载完成事件回调
 * @param param0 事件细节
 * @returns void
 */
export async function updateIndex({ detail }: any) {
    // console.log(detail);
    // console.log(detail.protyle.element.className);
    //如果不为手机端且为聚焦状态，就直接返回，否则查询更新
    if (!isMobile) {
        if (
            //为搜索界面
            detail.protyle.element.className.indexOf("search") != -1 ||
            // 为浮窗
            // detail.model == undefined || 
            detail.protyle.block.showAll) {
            // || !settings.get("autoUpdate")
            return;
        }
    }
    // console.log(detail);
    // 获取笔记本id
    let notebookId = detail.protyle.notebookId;
    // 获取文档块路径
    let path = detail.protyle.path;
    // 获取文档块id
    let parentId = detail.protyle.block.rootID;

    await execAutoUpdate(parentId, notebookId, path);
}