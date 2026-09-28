import { plugin } from "../../shared/utils";

export const CONFIG = "config";

export class SettingsProperty {
    depth: number;
    listType: string;
    linkType: string;
    layoutType: string;
    builderAutoUpdate: boolean;
    autoUpdate: boolean;
    fold: number;
    outlineAutoUpdate: boolean;
    outlineType: string;
    listTypeOutline: string;

    depthNotebook: number;
    listTypeNotebook: string;
    linkTypeNotebook: string;
    iconNotebook: boolean;
    icon: boolean;
    iconOutline: boolean;
    dbAddTemplateCols: boolean;
    devMode: boolean;

    constructor() {
        this.depth = 0;
        this.listType = "unordered";
        this.linkType = "link";
        this.layoutType = "list";
        this.builderAutoUpdate = true;
        this.autoUpdate = true;
        this.fold = 0;
        this.outlineAutoUpdate = true;
        this.outlineType = "link";
        this.listTypeOutline = "unordered";

        this.depthNotebook = 3;
        this.listTypeNotebook = "unordered";
        this.linkTypeNotebook = "link";
        this.iconNotebook = true;
        this.icon = false;
        this.iconOutline = false;
        this.dbAddTemplateCols = true;
        this.devMode = false;
    }

    getAll() {
        const toInt = (v: any, fallback: number) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        };
        this.depth = toInt(settings.get("depth"), 0);
        this.listType = settings.get("listType");
        this.linkType = settings.get("linkType");
        this.layoutType = settings.get("layoutType") ?? "list";
        this.builderAutoUpdate = settings.get("builderAutoUpdate");
        this.autoUpdate = settings.get("autoUpdate");
        this.fold = toInt(settings.get("fold"), 0);
        this.outlineAutoUpdate = settings.get("outlineAutoUpdate");
        this.outlineType = settings.get("outlineType");
        this.listTypeOutline = settings.get("listTypeOutline");

        this.depthNotebook = toInt(settings.get("depthNotebook"), 3);
        this.listTypeNotebook = settings.get("listTypeNotebook") ?? "unordered";
        this.linkTypeNotebook = settings.get("linkTypeNotebook") ?? "link";
        this.iconNotebook = settings.get("iconNotebook") ?? true;
        this.icon = settings.get("icon") ?? false;
        this.iconOutline = settings.get("iconOutline") ?? false;
        this.dbAddTemplateCols = settings.get("dbAddTemplateCols") ?? true;
        this.devMode = settings.get("devMode") ?? false;
    }
}

class Settings {
    async initData() {
        await this.load();
        if (plugin.data[CONFIG] === "" || plugin.data[CONFIG] === undefined || plugin.data[CONFIG] === null) {
            await plugin.saveData(CONFIG, new SettingsProperty());
        }
        await this.load();

        // Migrate old config values to new format
        let needsSave = false;
        const data = plugin.data[CONFIG];
        if (data) {
            if (data.linkType === "ref") { data.linkType = "link"; needsSave = true; }
            if (data.linkType === "embed") { data.linkType = "reference"; needsSave = true; }
            if (data.useDynamicAnchor === true && data.linkType !== "dynamic-ref") { data.linkType = "dynamic-ref"; needsSave = true; }
            if (data.outlineType === "ref") { data.outlineType = "link"; needsSave = true; }
            if (data.outlineType === "embed") { data.outlineType = "reference"; needsSave = true; }
            if (data.useDynamicAnchorOutline === true && data.outlineType !== "dynamic-ref") { data.outlineType = "dynamic-ref"; needsSave = true; }
            if (data.linkTypeNotebook === "ref") { data.linkTypeNotebook = "link"; needsSave = true; }
            if (data.useDynamicAnchor !== undefined) { delete data.useDynamicAnchor; needsSave = true; }
            if (data.useDynamicAnchorOutline !== undefined) { delete data.useDynamicAnchorOutline; needsSave = true; }
            if (data.col !== undefined) { delete data.col; needsSave = true; }
            if (needsSave) {
                console.log("[Settings] Migrated old config values to new format");
                await this.save();
            }
        }
    }

    set(key: any, value: any, config = CONFIG) {
        if (!plugin.data) plugin.data = {};
        if (!plugin.data[config]) plugin.data[config] = {};
        plugin.data[config][key] = value;
    }

    get(key: any, config = CONFIG) {
        return plugin.data?.[config]?.[key];
    }

    async load(config = CONFIG) {
        await plugin.loadData(config);
        if (!plugin.data) plugin.data = {};
        if (!plugin.data[config]) plugin.data[config] = {};
    }

    async save(config = CONFIG) {
        if (!plugin.data || !plugin.data[config]) return;
        await plugin.saveData(config, plugin.data[config]);
    }

    getMergedConfig(localData: any) {
        const def = new SettingsProperty();
        const global = plugin.data[CONFIG] || {};

        let linkType = localData.linkType ?? global.linkType ?? def.linkType;
        if (linkType === "ref") linkType = "link";
        if (linkType === "embed") linkType = "reference";
        if (localData.useDynamicAnchor === true && linkType !== "dynamic-ref") linkType = "dynamic-ref";

        const toInt = (v: any, fallback: number) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        };

        const merged = {
            depth: toInt(localData.depth ?? global.depth ?? def.depth, def.depth),
            listType: localData.listType ?? global.listType ?? def.listType,
            linkType: linkType,
            layoutType: localData.layoutType ?? global.layoutType ?? def.layoutType,
            fold: toInt(localData.fold ?? global.fold ?? def.fold, def.fold),
            icon: localData.icon ?? global.icon ?? def.icon,
            autoUpdate: localData.autoUpdate ?? global.autoUpdate ?? def.autoUpdate,
        };

        if (linkType === "tree") {
            merged.depth = 0;
            merged.fold = 0;
            merged.icon = true;
        }

        return merged;
    }

    getMergedConfigForOutline(localData: any) {
        const def = new SettingsProperty();
        const global = plugin.data[CONFIG] || {};

        let outlineType = localData.outlineType ?? global.outlineType ?? def.outlineType;
        if (outlineType === "ref") outlineType = "link";
        if (outlineType === "embed") outlineType = "reference";
        if (localData.useDynamicAnchorOutline === true && outlineType !== "dynamic-ref") outlineType = "dynamic-ref";

        const merged = {
            outlineType: outlineType,
            outlineAutoUpdate: localData.outlineAutoUpdate ?? global.outlineAutoUpdate ?? def.outlineAutoUpdate,
            listTypeOutline: localData.listTypeOutline ?? global.listTypeOutline ?? def.listTypeOutline,
            iconOutline: localData.iconOutline ?? global.iconOutline ?? def.iconOutline,
        };

        if (outlineType === "tree") {
            merged.iconOutline = true; // Force rich text icon formatting for tree mode
        }

        return merged;
    }
}

export const settings = new Settings();
