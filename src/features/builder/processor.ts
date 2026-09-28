import { client } from "../../shared/api-client";
import { getProcessedDocIcon } from "../../shared/utils/icon-utils";

import { ATTR_LINKED_AV, ATTR_ITEM_ID } from "../../shared/constants";
import { getColIDMap } from "../../shared/utils/av-utils";


/**
 * Builder 构造器常量定义
 * @module builder/processor
 */

// 块属性常量
/** 关联子文档 ID 的属性名 */
export const ATTR_INDEX = "custom-index-subdoc-id";
/** 关联标题块 ID 的属性名 */
export const ATTR_OUTLINE = "custom-index-heading-id";
/** 构建器托管标记：标记由构建器创建的文档/标题块，用于安全清理 */
export const ATTR_BUILDER_MANAGED = "custom-builder-managed";
/** 列表项分隔符字符 */
export const SEP_CHAR = "➖";
/** 默认文档图标 */
export const DEFAULT_ICON = "📄";

// Action Types
/** 构建类型：将列表项推送到独立文档 */
export const ACTION_PUSH_TO_DOC = "PUSH_TO_DOC";
/** 构建类型：将列表项推送到文档底部标题 */
export const ACTION_PUSH_TO_BOTTOM = "PUSH_TO_BOTTOM";

/**
 * 通用 POST 请求辅助函数
 * @param url - API 端点路径
 * @param data - 请求数据对象
 * @returns API 响应数据
 * @throws Error 当响应 code 不为 0 时抛出
 */
async function post(url: string, data: any) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    const res = await response.json();
    if (res.code !== 0) throw new Error(res.msg);
    return res.data;
}

/**
 * IBlockProcessor - 列表块处理器
 * 
 * 负责将列表项同步到目标文档或标题块，支持：
 * - 增量更新（仅同步变更的项目）
 * - 属性继承（从属性视图继承图标、封面、模板）
 * - 样式保留（保留块的原始样式属性）
 * 
 * @example
 * ```typescript
 * const processor = new IBlockProcessor([]);
 * await processor.processSingleItem(listItemId, "PUSH_TO_DOC", ctx);
 * ```
 */
export class IBlockProcessor {
    /** 错误信息收集数组 */
    errors: string[];
    /** 属性视图列信息缓存 */
    avCache: Map<string, any> = new Map();

    /**
     * 创建列表块处理器实例
     * @param errors - 错误信息收集数组引用
     */
    constructor(errors: string[]) {
        this.errors = errors;
    }

    async getLinkedAVData(listItemId: string, itemAttrs: any, avId?: string) {
        if (!avId) {
            const parentRes = await client.sql({ stmt: `SELECT parent_id FROM blocks WHERE id = '${listItemId}'` });
            const parentId = parentRes.data?.[0]?.parent_id;
            if (!parentId) return null;

            const parentAttrsRes = await client.getBlockAttrs({ id: parentId });
            avId = parentAttrsRes.data?.[ATTR_LINKED_AV];
        }

        if (!avId) return null;

        const itemId = itemAttrs[ATTR_ITEM_ID];
        if (!itemId) return null;

        if (!this.avCache.has(avId)) {
            this.avCache.set(avId, await getColIDMap(avId));
        }
        const { nameToID, keyValues } = this.avCache.get(avId);

        const result: any = {};

        // 1. Fetch values from AV using row ID stored in ATTR_ITEM_ID
        const keyMap: any = {};
        ["icon", "title-img", "template"].forEach(name => {
            const kn = Object.keys(nameToID).find(k => k.toLowerCase() === name.toLowerCase());
            if (kn) keyMap[name] = nameToID[kn];
        });

        if (Object.keys(keyMap).length > 0) {
            for (const [name, keyId] of Object.entries(keyMap)) {
                const kv = keyValues.find((v: any) => v.key.id === keyId);
                if (kv && kv.values) {
                    const cellVal = kv.values.find((v: any) => v.blockID === itemId);
                    if (cellVal) {
                        let finalVal = null;
                        if (cellVal.type === "text") finalVal = cellVal.text?.content;
                        else if (cellVal.type === "mAsset") finalVal = cellVal.mAsset?.[0]?.content;
                        else if (cellVal.type === "template") finalVal = cellVal.template?.content;
                        else if (cellVal.type === "select") finalVal = cellVal.mOption?.[0]?.content;
                        else if (cellVal.type === "mSelect") finalVal = cellVal.mOption?.map((o: any) => o.content).join(",");
                        else if (cellVal.content) finalVal = cellVal.content;

                        result[name] = finalVal;
                        // Build tool expects raw ID for weak inheritance
                        result[keyId as string] = finalVal;
                    }
                }
            }
        }

        return result;
    }

    parseIAL(ial: string) {
        const itemAttrs: any = {};
        if (ial) {
            const matches = ial.matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g);
            for (const m of matches) {
                itemAttrs[m[1]] = m[2];
            }
        }
        return itemAttrs;
    }

    async processSingleItem(listItemId: string, actionType: string, ctx: any) {
        const core = await this.getCoreContentInfo(listItemId);
        if (!core) return ctx.previousId;

        const containerAttrsRes = await client.getBlockAttrs({ id: core.containerId });
        const containerAttrs = containerAttrsRes.data;
        let result = ctx.previousId;

        switch (actionType) {
            case "PUSH_TO_DOC":
                result = await this.handlePushToDoc(core, containerAttrs, ctx);
                break;
            case "PUSH_TO_BOTTOM":
                result = await this.handlePushToBottom(core, containerAttrs, ctx);
                break;
        }
        return result || ctx.previousId;
    }

    async handlePushToBottom(core: any, containerAttrs: any, ctx: any) {
        let contentToPush = core.syncMd;
        if (!contentToPush) contentToPush = "Untitled";

        const prefix = "#".repeat(Math.min(ctx.level, 6));
        const titleContent = `${prefix} ${contentToPush}`;

        const coreAttrsRes = await client.getBlockAttrs({ id: core.contentId });
        const stylesToKeep = this.filterSystemAttrs(coreAttrsRes.data);
        let targetId = containerAttrs[ATTR_OUTLINE];
        const previousTargetId = ctx.previousId;

        let targetExists = false;
        if (targetId) {
            const checkRes = await client.sql({ stmt: `SELECT id FROM blocks WHERE id = '${targetId}' LIMIT 1` });
            targetExists = !!checkRes.data[0];
        }

        if (!targetId || !targetExists) {
            let r;
            if (previousTargetId) {
                r = await client.insertBlock({ previousID: previousTargetId, dataType: "markdown", data: titleContent });
            } else {
                const rootIdRes = await client.sql({ stmt: `SELECT root_id FROM blocks WHERE id = '${core.containerId}' LIMIT 1` });
                const rootId = rootIdRes.data[0]?.root_id;
                r = await client.appendBlock({ parentID: rootId, dataType: "markdown", data: titleContent });
            }

            targetId = r?.data?.[0]?.doOperations?.[0]?.id;
            if (targetId) {
                const promises = [];
                promises.push(client.setBlockAttrs({ id: core.containerId, attrs: { [ATTR_OUTLINE]: targetId } }));
                promises.push(client.setBlockAttrs({ id: targetId, attrs: { ...stylesToKeep, [ATTR_BUILDER_MANAGED]: "true" } }));
                await Promise.all(promises);
            }
        } else {
            await client.updateBlock({ id: targetId, dataType: "markdown", data: titleContent });
            await client.setBlockAttrs({ id: targetId, attrs: { ...stylesToKeep, [ATTR_BUILDER_MANAGED]: "true" } });
        }

        const finalMd = await this.constructListItemMarkdown(containerAttrs, targetId, core.syncMd, undefined, core.currentIcon);
        const updatePromises = [];
        updatePromises.push(client.updateBlock({ id: core.contentId, dataType: "markdown", data: finalMd }));
        if (Object.keys(stylesToKeep).length > 0) updatePromises.push(client.setBlockAttrs({ id: core.contentId, attrs: stylesToKeep }));
        await Promise.all(updatePromises);

        return targetId;
    }

    async handlePushToDoc(core: any, containerAttrs: any, ctx: any) {
        const title = core.syncText;
        if (!title) return null;

        const coreAttrsRes = await client.getBlockAttrs({ id: core.contentId });
        const stylesToKeep = this.filterSystemAttrs(coreAttrsRes.data);
        let docId = containerAttrs[ATTR_INDEX];

        let existingDocIcon = "";
        if (docId) {
            const checkRes = await client.sql({ stmt: `SELECT id, icon FROM blocks WHERE id = '${docId}' LIMIT 1` });
            if (!checkRes.data[0]) {
                docId = null;
            } else {
                existingDocIcon = checkRes.data[0].icon || "";
            }
        }

        let isDocEmpty = false;
        if (docId) {
            const checkRes = await client.sql({ stmt: `SELECT id, type, content FROM blocks WHERE root_id = '${docId}' AND parent_id = '${docId}' ORDER BY sort ASC LIMIT 2` });
            if (!checkRes.data || checkRes.data.length === 0) {
                isDocEmpty = true;
            } else if (checkRes.data.length === 1) {
                const b = checkRes.data[0];
                if (b.type === 'p' && (!b.content || b.content.trim() === '')) {
                    isDocEmpty = true;
                }
            }
        }

        const linkedData = await this.getLinkedAVData(core.containerId, containerAttrs, ctx.avId);
        let targetIcon = linkedData?.icon ? (/[^\u0000-\u007F]/.test(linkedData.icon) ? this.emojiToHex(linkedData.icon) : linkedData.icon) : (core.currentIcon ? this.emojiToHex(core.currentIcon) : null);

        // USER REQUEST: Ignore default text emojis 📄 and 📑 completely, as well as the separator ➖.
        if (targetIcon === "📄" || targetIcon === "📑" || targetIcon === "➖") {
            // Also need to check hex representation of these:
            // 📄 is 1f4c4
            // 📑 is 1f4d1
            // ➖ is 2796
            targetIcon = null;
        }
        if (targetIcon === "1f4c4" || targetIcon === "1f4d1" || targetIcon === "2796") {
            targetIcon = null;
        }

        // USER REQUEST: Ignore dynamic icons and custom SVG images
        if (targetIcon && (targetIcon.startsWith("api/icon/") || targetIcon.includes("."))) {
            targetIcon = null;
        }

        // Prevent default fallback icons from overwriting actual custom document image aliases
        // (This original check is now mostly redundant but kept for safety if someone uses other fallbacks)
        if ((core.currentIcon === "📄" || core.currentIcon === "📑") && existingDocIcon && (existingDocIcon.includes(".") || existingDocIcon.includes("/"))) {
            targetIcon = null;
        }

        let targetImage = linkedData?.["title-img"] || null;

        // GET TEMPLATE IF WE ARE CREATING A NEW DOCUMENT OR IF EXISTING DOCUMENT IS EMPTY
        const templatePath = ((!docId || isDocEmpty) && linkedData?.template) ? linkedData.template : "";

        let finalMarkdown = "";
        if (templatePath) {
            // @ts-ignore
            const dataDir = window.siyuan?.config?.system?.dataDir;
            let absPath = templatePath;
            if (dataDir) {
                let relPath = templatePath.startsWith("/") ? templatePath : "/" + templatePath;
                if (!relPath.startsWith("/templates/")) relPath = "/templates" + relPath;
                const fullPath = relPath.endsWith(".md") ? relPath : relPath + ".md";
                absPath = (dataDir + fullPath).replace(/\//g, "\\").replace(/\\\\/g, "\\");
            }
            try {
                const renderRes = await post("/api/template/render", { id: core.containerId, path: absPath, preview: false });
                const dom = renderRes.content || renderRes.dom || "";
                if (dom) {
                    // @ts-ignore
                    const lute = window.Lute.New();
                    finalMarkdown = lute.BlockDOM2Md(dom);
                    if (isDocEmpty && docId) {
                        try {
                            const checkRs = await client.sql({
                                stmt: `SELECT id, type, content FROM blocks WHERE root_id = '${docId}' AND parent_id = '${docId}' ORDER BY sort ASC`
                            });
                            let emptyBlockId: string | undefined;
                            if (checkRs.data && checkRs.data.length === 1) {
                                const b = checkRs.data[0];
                                if (b.type === 'p' && (!b.content || b.content.trim() === '')) {
                                    emptyBlockId = b.id;
                                }
                            }
                            await client.prependBlock({
                                data: finalMarkdown,
                                dataType: 'markdown',
                                parentID: docId
                            });
                            if (emptyBlockId) {
                                await client.deleteBlock({ id: emptyBlockId });
                            }
                        } catch (e) { console.error("[Builder] Failed to apply template to empty doc", e); }
                    }
                }
            } catch (e) {
                console.error("[Builder] Template render failed", e);
            }
        }

        const applyInherited = async (id: string, existingDocAttrs: any = {}) => {
            const resultOverrides: any = {};
            if (!ctx.inheritedAttrs) return resultOverrides;
            const docAttrs: any = { ...existingDocAttrs };
            let nameMap: any = null;
            if (ctx.avId && this.avCache.has(ctx.avId)) {
                const cached = this.avCache.get(ctx.avId);
                nameMap = cached.nameToID ? Object.fromEntries(Object.entries(cached.nameToID).map(([n, id]) => [id, n])) : null;
            }

            for (const [colId, resolvedVal] of Object.entries(ctx.inheritedAttrs as any)) {
                let valStr = "";
                if (resolvedVal) {
                    if (typeof resolvedVal === 'string') valStr = resolvedVal;
                    else if ((resolvedVal as any).text) valStr = (resolvedVal as any).text.content;
                    else if ((resolvedVal as any).number) valStr = String((resolvedVal as any).number.content);
                    else if ((resolvedVal as any).mOption) valStr = (resolvedVal as any).mOption.map((o: any) => o.content).join(",");
                    else if ((resolvedVal as any).content) valStr = (resolvedVal as any).content;
                }

                if (valStr) {
                    let attrName = colId;
                    if (nameMap && nameMap[colId]) attrName = nameMap[colId];
                    const systemNames = ["icon", "title-img", "template"];
                    const lowerName = attrName.toLowerCase();
                    if (systemNames.includes(lowerName)) {
                        if (lowerName === "icon" && /[^\u0000-\u007F]/.test(valStr)) {
                            valStr = this.emojiToHex(valStr);
                        }
                        docAttrs[lowerName] = valStr;
                        if (lowerName === "icon") resultOverrides.icon = valStr;
                        if (lowerName === "title-img") resultOverrides.titleImg = valStr;
                        if (lowerName === "template") resultOverrides.template = valStr;
                    } else {
                        attrName = `custom-${attrName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()}`;
                        docAttrs[attrName] = valStr;
                    }
                }
            }
            if (Object.keys(docAttrs).length > 0) {
                await client.setBlockAttrs({ id, attrs: docAttrs });
            }
            return resultOverrides;
        };

        if (docId) {
            let notebook, path, hpath;
            try {
                const pathRes = await post("/api/filetree/getPathByID", { id: docId });
                if (pathRes) {
                    notebook = pathRes.notebook;
                    path = pathRes.path;
                    hpath = await post("/api/filetree/getHPathByID", { id: docId });
                    await client.renameDoc({ notebook, path, title });

                    const existingDocAttrs: any = {};
                    existingDocAttrs.icon = targetIcon || "";
                    existingDocAttrs["title-img"] = targetImage || "";
                    existingDocAttrs[ATTR_BUILDER_MANAGED] = "true"; // 补打托管标记

                    const overrides = await applyInherited(docId, existingDocAttrs);
                    if (overrides.icon !== undefined) targetIcon = overrides.icon;
                    if (overrides.titleImg !== undefined) targetImage = overrides.titleImg;
                }
            } catch (e) {
                console.error(`[Builder-Debug] Error updating existing document ${docId}:`, e);
            }
            const displayIcon = getProcessedDocIcon(targetIcon || core.currentIcon || "", false);
            const newMd = await this.constructListItemMarkdown(containerAttrs, containerAttrs[ATTR_OUTLINE], core.syncMd, docId, displayIcon);
            await client.updateBlock({ id: core.contentId, dataType: "markdown", data: newMd });
            if (Object.keys(stylesToKeep).length > 0) await client.setBlockAttrs({ id: core.contentId, attrs: stylesToKeep });
            return { id: docId, notebook, path, hpath };
        }

        let notebook, path, hpath = "";
        if (ctx.parentInfo) {
            notebook = ctx.parentInfo.notebook;
            hpath = `${ctx.parentInfo.hpath}/${title}`;
            path = hpath;
        } else if (ctx.parentId) {
            const parentPathRes = await post("/api/filetree/getPathByID", { id: ctx.parentId });
            const parentHPathRes = await post("/api/filetree/getHPathByID", { id: ctx.parentId });
            if (parentPathRes && parentHPathRes) {
                notebook = parentPathRes.notebook;
                hpath = `${parentHPathRes}/${title}`;
                path = hpath;
            }
        }

        if (!notebook || !path) {
            const hPathRes = await post("/api/filetree/getHPathByID", { id: core.containerId });
            const pathRes = await post("/api/filetree/getPathByID", { id: core.containerId });
            notebook = pathRes.notebook;
            hpath = `${hPathRes}/${title}`;
            path = hpath;
        }

        const newIdRes = await client.createDocWithMd({ notebook, path, markdown: finalMarkdown });
        const newId = newIdRes.data;

        if (newId) {
            let physicalPath = null;
            try {
                const pRes = await post("/api/filetree/getPathByID", { id: newId });
                if (pRes) physicalPath = pRes.path;
            } catch (e) { }
            await client.setBlockAttrs({ id: core.containerId, attrs: { [ATTR_INDEX]: newId } });
            // 托管标记：标记该文档由构建器创建，便于安全清理
            await client.setBlockAttrs({ id: newId, attrs: { [ATTR_BUILDER_MANAGED]: "true" } });

            const existingDocAttrs: any = {};
            existingDocAttrs.icon = targetIcon || "";
            existingDocAttrs["title-img"] = targetImage || "";

            const overrides = await applyInherited(newId, existingDocAttrs);
            if (overrides.icon !== undefined) targetIcon = overrides.icon;
            if (overrides.titleImg !== undefined) targetImage = overrides.titleImg;

            const displayIcon = getProcessedDocIcon(targetIcon || core.currentIcon || "", false);
            const newMd = await this.constructListItemMarkdown(containerAttrs, containerAttrs[ATTR_OUTLINE], core.syncMd, newId, displayIcon);
            await client.updateBlock({ id: core.contentId, dataType: "markdown", data: newMd });
            if (Object.keys(stylesToKeep).length > 0) await client.setBlockAttrs({ id: core.contentId, attrs: stylesToKeep });
            return { id: newId, notebook, path: physicalPath, hpath: hpath || path };
        }
        return null;
    }

    emojiToHex(icon: string) {
        if (!icon) return "";
        if (icon.includes(".") || icon.includes("/")) return icon;
        if (/[^\u0000-\u007F]/.test(icon)) return Array.from(icon).map(c => c.codePointAt(0)?.toString(16)).join("-");
        return icon;
    }

    async constructListItemMarkdown(_containerAttrs: any, headingId: string, syncText: string, docId?: string, docIcon?: string) {
        // Builder items ALWAYS use plain text for the body to avoid redundant links and infinite update loops.
        // The icon already provides the navigation link to the document.
        
        const parts = [];
        if (docId) {
            const icon = docIcon || DEFAULT_ICON;
            parts.push(`[${icon}](siyuan://blocks/${docId})`);
        }
        
        if (headingId) {
            // 标题行跳转：正文文字本身作为链接，移除 ➖ 小竖线分隔符
            parts.push(`[${syncText.trim()}](siyuan://blocks/${headingId})`);
        } else {
            parts.push(syncText.trim());
        }
        return parts.join(" ");
    }

    async getCoreContentInfo(listItemId: string) {
        const selfRes = await client.sql({ stmt: `SELECT type FROM blocks WHERE id = '${listItemId}' LIMIT 1` });
        if (!selfRes.data[0] || selfRes.data[0].type !== "i") return null;
        const childrenRes = await client.sql({
            stmt: `SELECT id, type, markdown, content FROM blocks WHERE parent_id = '${listItemId}' AND type = 'p' ORDER BY sort ASC`
        });
        const children = childrenRes.data;
        if (!children || children.length === 0) return null;
        return this.parseItemContent(listItemId, children);
    }

    parseItemContent(listItemId: string, children: any[]) {
        if (!children || children.length === 0) return null;

        const sepRegex = /(\[➖\]\(siyuan:\/\/blocks\/[a-zA-Z0-9-]+\)|➖)/;
        const iconRegex = /\s*\[.*?\]\(siyuan:\/\/blocks\/.*?\)\s*/;
        let targetBlock = children.find((child: any) => {
            const md = child.markdown || "";
            return sepRegex.test(md) || iconRegex.test(md);
        });
        if (!targetBlock) targetBlock = children[0];

        if (!targetBlock) return null; // Additional safety check

        const contentId = targetBlock.id;
        const md = targetBlock.markdown || "";
        const content = targetBlock.content || "";
        let tempMd = md.replace(/\{:[^}]+\}/g, "").trim();
        let hasSeparator = false;
        let currentIcon = null;
        const docLinkRegex = /^\s*\[(.*?)\]\(siyuan:\/\/blocks\/[a-zA-Z0-9-]+\)\s*/;
        const docMatch = tempMd.match(docLinkRegex);
        if (docMatch) {
            const anchor = docMatch[1];
            // 仅当 anchor 是图标样式时才视为文档图标链接（避免误删新格式标题链接）
            const isIconAnchor = anchor !== SEP_CHAR && (
                /^(\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation}|:[^:]+:|\p{So})$/u.test(anchor)
                || (anchor.length <= 2 && !/[\u4e00-\u9fff]/.test(anchor))
            );
            if (isIconAnchor) {
                currentIcon = anchor;
                tempMd = tempMd.replace(docLinkRegex, "");
            }
        } else {
            const explicitIconRegex = /^\s*(?:(\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation})|(:[^:]+:))\s*/u;
            const iconMatch = tempMd.match(explicitIconRegex);
            if (iconMatch) {
                currentIcon = iconMatch[1] || iconMatch[2];
                tempMd = tempMd.replace(explicitIconRegex, "");
            }
        }
        const sepLinkRegex = /^(.*?)(\[➖\]\(siyuan:\/\/blocks\/[a-zA-Z0-9-]+\)|➖)\s*/u;
        const sepMatch = tempMd.match(sepLinkRegex);
        if (sepMatch) {
            hasSeparator = true;
            const prefix = sepMatch[1].trim();
            if (!currentIcon && prefix) {
                const emojiTest = /^(\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation}|:[^:]+:)$/u;
                if (emojiTest.test(prefix)) currentIcon = prefix;
            }
            tempMd = tempMd.replace(sepLinkRegex, "");
        }
        // 新格式：标题行正文本身作为跳转链接 [正文](siyuan://blocks/headingId)，剥离为纯文本
        const headingLinkRegex = /^\[(.*?)\]\(siyuan:\/\/blocks\/[a-zA-Z0-9-]+\)\s*/;
        const headingMatch = tempMd.match(headingLinkRegex);
        if (headingMatch) {
            hasSeparator = true;
            tempMd = tempMd.replace(headingLinkRegex, "$1");
        }
        let syncMd = tempMd.trim();
        // Derive syncText from SQL `content` field.
        // STRIP all MD markers (refs, links) to treat the body as pure text for unified builder logic.
        const sepCharIdx = content.indexOf("➖");
        let rawSyncText = sepCharIdx !== -1
            ? content.substring(sepCharIdx + 1).trim()
            : content.replace(/^(\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation}|:[^:]+:)\s*/u, "").trim();
        
        // Strip all MD link/ref markers to maintain pure-text syncText.
        // This regex handles various anchor styles and multi-level escaping that might occur in the SQL 'content' field.
        const syncText = rawSyncText
            // 1. Remove block references with specific anchors ((id "anchor")) or just ((id))
            .replace(/\(\([a-zA-Z0-9-]{16,22}(?:\s+.*?)?\)\)/g, (match) => {
                // Extract inner anchor text if present
                const innerMatch = match.match(/\(\([a-zA-Z0-9-]{16,22}\s+(.*)\)\)/);
                if (innerMatch && innerMatch[1]) {
                    // Strip potential outer quotes (including escaped ones)
                    let anchor = innerMatch[1].trim();
                    anchor = anchor.replace(/^(['"]|&quot;|&apos;)(.*)\1$/, "$2");
                    return anchor;
                }
                return "";
            })
            // 2. Remove standard Markdown links [text](url) and SiYuan-style links
            .replace(/\[(.*?)\]\((?:siyuan:\/\/blocks\/[a-zA-Z0-9-]+|#.*?|.*?)\)/g, "$1")
            // 3. Cleanup HTML-like artifacts of Dynamic Ref Spans
            .replace(/<span data-type="block-ref".*?>(.*?)<\/span>/g, "$1")
            .trim();

        return { containerId: listItemId, contentId: contentId, hasSeparator, syncText, syncMd, markdown: md, content: content, currentIcon };
    }

    filterSystemAttrs(attrs: any) {
        const validAttrs: any = {};
        const whitelist = new Set(["style", "class"]);
        for (const [key, val] of Object.entries(attrs)) {
            if (whitelist.has(key)) validAttrs[key] = val;
        }
        return validAttrs;
    }

    /**
     * 清理残留的构建器目标（孤儿清理）
     * 
     * 扫描列表块，找出列表中已不存在的列表项所关联的目标文档/标题块，并回收：
     * - 子文档：仅当带有 ATTR_BUILDER_MANAGED 标记时才移入回收站 (removeDoc)
     * - 标题块：仅当标题下没有子块（光杆保护）且带标记时才 deleteBlock
     * 
     * @param listBlockId - 顶层列表块 ID
     */
    async cleanupOrphans(listBlockId: string) {
        try {
            // 1. 收集顶层列表块下的所有列表项 ID 及其 IAL 中记录的目标 ID
            const itemRes = await client.sql({
                stmt: `SELECT id, ial FROM blocks WHERE type = 'i' AND parent_id = '${listBlockId}'`
            });
            // 空列表保护：若列表块已无任何列表项，不清除任何内容（避免误判）
            if (!itemRes.data || itemRes.data.length === 0) return;

            const targetDocIds = new Set<string>();
            const targetHeadingIds = new Set<string>();

            (itemRes.data).forEach((it: any) => {
                const ia = it.ial || "";
                const dM = ia.match(new RegExp(`${ATTR_INDEX}="([^"]+)"`));
                if (dM) targetDocIds.add(dM[1]);
                const hM = ia.match(new RegExp(`${ATTR_OUTLINE}="([^"]+)"`));
                if (hM) targetHeadingIds.add(hM[1]);
            });

            // 1.5 获取 source 文档作用域，将清理范围从全库收窄到当前源文档，杜绝跨文档误删
            const listInfoRes = await client.sql({
                stmt: `SELECT root_id FROM blocks WHERE id = '${listBlockId}' LIMIT 1`
            });
            const rootId = listInfoRes.data?.[0]?.root_id;
            if (!rootId) return;

            let srcBox = "";
            let srcPathPrefix = "/";
            try {
                const srcDocRes = await client.sql({
                    stmt: `SELECT box, path FROM blocks WHERE id = '${rootId}' LIMIT 1`
                });
                const srcDoc = srcDocRes.data?.[0];
                srcBox = srcDoc?.box || "";
                const srcPath = srcDoc?.path || "";
                if (srcPath) {
                    const idx = srcPath.lastIndexOf("/");
                    srcPathPrefix = idx > 0 ? srcPath.substring(0, idx + 1) : "/";
                }
            } catch (e) {
                console.error("[Builder] Failed to fetch source doc scope", e);
            }

            // 2. 清理子文档：仅当前笔记本、当前源文档目录树下的托管文档，且未被当前列表项引用
            if (srcBox) {
                const managedDocsRes = await client.sql({
                    stmt: `SELECT id, box, path FROM blocks WHERE type = 'd' AND box = '${srcBox}' AND path LIKE '${srcPathPrefix}%' AND ial LIKE '%${ATTR_BUILDER_MANAGED}="true"%'`
                });
                for (const doc of (managedDocsRes.data || [])) {
                    if (targetDocIds.has(doc.id)) continue; // 仍被引用，跳过
                    try {
                        await post("/api/filetree/removeDoc", { notebook: doc.box, path: doc.path });
                        console.log("[Builder] Cleanup orphan doc", doc.id);
                    } catch (e) {
                        console.error("[Builder] Failed to cleanup orphan doc", doc.id, e);
                    }
                }
            }

            // 3. 清理标题块：仅当前源文档 root 内（标题块必然属于源文档）的托管块，且未被当前列表项引用
            const managedHeadingsRes = await client.sql({
                stmt: `SELECT id FROM blocks WHERE root_id = '${rootId}' AND ial LIKE '%${ATTR_BUILDER_MANAGED}="true"%' AND type IN ('h','h1','h2','h3','h4','h5','h6')`
            });
            for (const h of (managedHeadingsRes.data || [])) {
                if (targetHeadingIds.has(h.id)) continue; // 仍被引用，跳过

                // 光杆保护：仅当标题下方没有子块时才删除
                const childRes = await client.sql({
                    stmt: `SELECT id FROM blocks WHERE parent_id = '${h.id}' LIMIT 1`
                });
                if (!childRes.data || childRes.data.length === 0) {
                    try {
                        await client.deleteBlock({ id: h.id });
                        console.log("[Builder] Cleanup orphan heading", h.id);
                    } catch (e) {
                        console.error("[Builder] Failed to cleanup orphan heading", h.id, e);
                    }
                }
            }
        } catch (e) {
            console.error("[Builder] cleanupOrphans failed", e);
        }
    }
}
