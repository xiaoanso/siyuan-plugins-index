<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { SettingsProperty } from "../../../core/settings";
    import { i18n } from "../../../shared/utils";
    import SettingItem from "../setting-item.svelte";

    export let tabbarfocus: any;
    export let settingsStrings: SettingsProperty;

    /** 布局样式：用顶层赋值驱动 {#if}，不依赖嵌套属性的 Svelte 响应 */
    let isCardLayout = settingsStrings.layoutType === "superblock-card";

    function syncCardLayoutFrom(value: string) {
        isCardLayout = value === "superblock-card";
    }

    function onSettingChanged(e: Event) {
        const detail = (e as CustomEvent).detail;
        if (detail?.key !== "layoutType") return;
        const value = String(detail.value);
        // SettingItem 只写 plugin.data，不会改 settingsStrings；这里同步以免被旧值盖回去
        settingsStrings.layoutType = value;
        syncCardLayoutFrom(value);
    }

    // 父组件 getAll / 切 tab 后 settingsStrings 被重新赋值时同步
    $: syncCardLayoutFrom(settingsStrings.layoutType ?? "list");

    onMount(() => {
        window.addEventListener("index-plugin-setting-changed", onSettingChanged);
    });

    onDestroy(() => {
        window.removeEventListener("index-plugin-setting-changed", onSettingChanged);
    });
</script>

<div
    data-name="index"
    class={tabbarfocus === "index"
        ? "config__tab-container"
        : "config__tab-container fn__none"}
>
    <SettingItem
        type="select"
        content={i18n.settingsTab.items.layoutType}
        settingKey="layoutType"
        settingValue={settingsStrings.layoutType}
    />
    {#if !isCardLayout}
        <SettingItem
            type="select"
            content={i18n.settingsTab.items.listType}
            settingKey="listType"
            settingValue={settingsStrings.listType}
        />
    {/if}
    <SettingItem
        type="select"
        content={i18n.settingsTab.items.linkType}
        settingKey="linkType"
        settingValue={settingsStrings.linkType}
    />
    <SettingItem
        type="switch"
        content={i18n.settingsTab.items.icon}
        settingKey="icon"
        settingValue={settingsStrings.icon}
    />
    {#if !isCardLayout}
        <SettingItem
            type="range"
            content={i18n.settingsTab.items.depth}
            settingKey="depth"
            settingValue={settingsStrings.depth}
        />
        <SettingItem
            type="range"
            content={i18n.settingsTab.items.fold}
            settingKey="fold"
            settingValue={settingsStrings.fold}
        />
    {/if}

    <SettingItem
        type="switch"
        content={i18n.settingsTab.items.autoUpdate}
        settingKey="autoUpdate"
        settingValue={settingsStrings.autoUpdate}
    />
</div>
