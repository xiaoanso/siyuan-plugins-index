/**
 * fingerprint.ts
 *
 * 目录/大纲/构建器自动更新指纹缓存
 *
 * 核心思想：
 * 每次自动更新时，从当前文档中**已存在**的目录/大纲/构建器块 DOM 提取：
 *   1. 其中引用的所有子文档链接（siyuan://blocks/id）
 *   2. 每个文档的 updated 时间戳（比 hpath/name 更灵敏）
 *   3. 方块绑定的配置（JSON 字符串）
 * 组成指纹。若指纹与上次一致，说明目标树与配置都没变，跳过整棵树的重新生成
 * （避免每次打开/切换标签都全量遍历 + 大量 API 请求）。
 *
 * 指纹写入：保存在块 IAL 的 custom-index-fingerprint 属性中。
 */

import { sleep } from "../utils";
import { client } from "../../shared/api-client";

/** 指纹属性名（写入在目录/大纲/构建器目标块上） */
export const ATTR_FINGERPRINT = "custom-index-fingerprint";

/** 指纹反序列化失败时视为不匹配，强制刷新 */
const FINGERPRINT_SEPARATOR = "|";

/**
 * 提取 markdown/HTML 文本中的所有 siyuan://blocks/<id> 引用
 * @param text 块内容（markdown 或 DOM）
 */
export function extractBlockRefs(text: string): string[] {
    if (!text) return [];
    const refs: string[] = [];
    const re = /siyuan:\/\/blocks\/([a-zA-Z0-9-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        refs.push(m[1]);
    }
    // 去重保持插入顺序
    return Array.from(new Set(refs));
}

/** 默认文档图标，避免对无 icon 文档误判 */
const DEFAULT_ICONS = new Set(["", "📄", "📑", "➖", "1f4c4", "1f4d1", "2796"]);

/**
 * 从 ID 列表批量读取 updated 时间戳
 * @param ids 文档/块 ID 列表
 * @returns id -> updated 字符串
 */
export async function fetchUpdatedMap(ids: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    if (!ids.length) return result;

    const idList = ids.map((id) => `'${id}'`).join(",");
    try {
        const rs = await client.sql({
            stmt: `SELECT id, updated FROM blocks WHERE id IN (${idList})`
        });
        for (const row of rs.data || []) {
            if (row.updated) result[row.id] = String(row.updated);
        }
    } catch (err) {
        console.error("[Fingerprint] Failed to fetch updated map:", err);
    }
    return result;
}

/**
 * 计算目录/大纲/构建器的内容指纹。
 * 输入为当前块文本 + 引用的所有文档 ID + 绑定配置。
 * 若块文本中已包含文档 updated 链接（如 title-img 挂 updated）则天然灵敏，
 * 这里额外用 updated 表来修正（对普通图集/摘要同样有效）。
 */
export async function computeFingerprint(
    blockText: string,
    config: any
): Promise<string | null> {
    try {
        const refs = extractBlockRefs(blockText);
        const updatedMap = await fetchUpdatedMap(refs);
        // 已按引用顺序去重，直接拼接 ID + updated
        const parts = refs.map((id) => `${id}:${updatedMap[id] || ""}`);
        // 配置信息（渲染参数变化必须触发刷新）
        const cfg = config ? JSON.stringify(config) : "";
        return [cfg, parts.join(",")].join(FINGERPRINT_SEPARATOR);
    } catch (err) {
        console.error("[Fingerprint] compute failed:", err);
        return null;
    }
}

/**
 * 读取块上缓存的指纹
 */
export async function loadStoredFingerprint(blockId: string): Promise<string | null> {
    try {
        const attrsRes = await client.getBlockAttrs({ id: blockId });
        const stored = attrsRes.data?.[ATTR_FINGERPRINT];
        return stored || null;
    } catch (err) {
        console.error("[Fingerprint] load failed:", err);
        return null;
    }
}

/**
 * 写指纹到块 IAL
 */
export async function storeFingerprint(blockId: string, fingerprint: string | null) {
    try {
        await client.setBlockAttrs({
            id: blockId,
            attrs: { [ATTR_FINGERPRINT]: fingerprint || "" }
        });
    } catch (err) {
        console.error("[Fingerprint] store failed:", err);
    }
}

/**
 * 自动更新前判断：若块无指纹 -> 需要刷新（首次），
 * 指纹与当前计算一致 -> 跳过刷新（返回 true）
 */
export async function shouldSkipAutoUpdate(
    blockId: string,
    blockText: string,
    config: any
): Promise<boolean> {
    const stored = await loadStoredFingerprint(blockId);
    if (!stored) return false; // 无指纹 => 首次生成

    const current = await computeFingerprint(blockText, config);
    if (!current) return false;

    if (stored === current) return true;

    // 若链接文档已删除，当前指纹会少了该引用，属于真实变化，刷新即可
    return false;
}

/** 等待约定毫秒数，用于等待前端渲染完成 */
export async function waitForRender(ms = 300): Promise<void> {
    await sleep(ms);
}
