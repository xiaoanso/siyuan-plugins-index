import { client } from "../../shared/api-client";
import { ListProcessor, runWithBuildLock } from "./builder";

import { getOutermostList } from "../../shared/utils/dom-utils";
import { confirmTransformation } from "../../shared/utils/transformation-utils";
import { i18n } from "../../shared/utils";
import { transformToTree } from "./transformation";
import { addPluginMenuItem } from "../../shared/utils/menu-utils";

/**
 * 块标菜单回调
 * @param detail 事件细节
 * @returns void
 */
export function buildDoc({ detail }: any) {
    const { menu, blockElements } = detail;
    if (!blockElements || blockElements.length === 0) return;

    const blockElement = blockElements[0];
    const blockId = blockElement.getAttribute("data-node-id");
    const blockType = blockElement.getAttribute("data-type");

    // 1. Only show for NodeList (the container), not individual items
    if (blockType !== "NodeList") return;

    // 2. Check if it is the outermost list (and not inside an embed)
    const outermostList = getOutermostList(blockElement);
    if (outermostList !== blockElement) return;

    // Add Smart Selector menu items
    menu.addSeparator();

    addPluginMenuItem(menu, {
        id: "indexos-build-doc",
        icon: "iconLeft",
        label: i18n.builderMenu.buildDoc,
        click: () => syncManager(blockId, blockType, "PUSH_TO_DOC")
    });

    addPluginMenuItem(menu, {
        id: "indexos-build-heading",
        icon: "iconDown",
        label: i18n.builderMenu.buildHeading,
        click: () => syncManager(blockId, blockType, "PUSH_TO_BOTTOM")
    });

}

async function syncManager(sourceBlockId: string, sourceType: string, actionType: string) {
    // Check for Index/Outline attributes to intercept and transform
    const attrsRes = await client.getBlockAttrs({ id: sourceBlockId });
    let attrs = attrsRes.data || {};

    if (attrs["custom-index-create"] || attrs["custom-outline-create"]) {
        const confirmed = await confirmTransformation('builder');
        if (!confirmed) return;

        const success = await transformToTree(sourceBlockId);
        if (!success) {
            // @ts-ignore
            client.pushErrMsg({ msg: i18n.builderMenu.transformFail, timeout: 3000 });
            return;
        }

        // Refresh attributes after transformation
        const refreshedAttrs = await client.getBlockAttrs({ id: sourceBlockId });
        attrs = refreshedAttrs.data || {};
    }

    // Update tree-create logic
    const treeAttr = attrs["custom-tree-create"];
    let currentData: any = {};
    if (treeAttr) {
        try {
            // Need robust decoding here too? Usually getBlockAttrs returns decoded JSON if it's stored as such? 
            // Or string. "custom-tree-create" is a string containing JSON.
            // Siyuan returns it as string. It might have ".
            // Let's use simple parse for now, assuming standard behavior, or the same robust method if needed.
            // But menu.ts runs in browser context too? Yes.
            let val = treeAttr;
            // SiYuan 可能返回 HTML 实体编码的引号（"），先做归一化再解析
            if (val.includes('\\"')) {
                val = val.replace(/\\"/g, '"');
            }
            currentData = JSON.parse(val);
        } catch (e) {
            console.error("Failed to parse custom-tree-create", e);
        }
    }

    let currentType = currentData.treeType;

    // 只设置单一构建类型，不再升级为组合模式
    let newType = currentType;
    if (!currentType) {
        if (actionType === "PUSH_TO_DOC") newType = "doc-tree";
        else if (actionType === "PUSH_TO_BOTTOM") newType = "heading-tree";
    }

    if (newType && newType !== currentType) {
        currentData.treeType = newType;
        if (currentData.builderAutoUpdate === undefined) {
            currentData.builderAutoUpdate = true;
        }
        await client.setBlockAttrs({
            id: sourceBlockId,
            attrs: { "custom-tree-create": JSON.stringify(currentData) }
        });
    }

    try {
        // 以列表块为粒度加锁，串行化同一列表的构建，防止并发重复创建子文档
        await runWithBuildLock(sourceBlockId, async () => {
            const processor = new ListProcessor();
            // 先清理残留的构建器目标（删除列表项后自动回收其对应文档/标题）
            await processor.ibp.cleanupOrphans(sourceBlockId);
            await processor.processRecursive(sourceBlockId, sourceType, actionType);

            if (processor.ibp.errors.length > 0) { // Access via ibp
                // @ts-ignore
                client.pushMsg({
                    msg: i18n.builderMenu.syncPartial.replace("{n}", processor.ibp.errors.length.toString()),
                    timeout: 5000
                });
            } else {
                // @ts-ignore
                client.pushMsg({
                    msg: i18n.builderMenu.syncSuccess,
                    timeout: 3000
                });
            }
        });
    } catch (e) {
        console.error(e);
        // @ts-ignore
        client.pushErrMsg({
            msg: i18n.builderMenu.syncError.replace("{error}", e.message),
            timeout: 5000
        });
    }
}
