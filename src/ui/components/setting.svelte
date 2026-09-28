<script lang="ts">
    import { onDestroy } from "svelte";
    import { settings, SettingsProperty } from "../../core/settings";
    import { i18n } from "../../shared/utils";
    import { eventBus } from "../../shared/eventbus";
    import IndexTab from "./tab/index-tab.svelte";
    import OutlineTab from "./tab/outline-tab.svelte";
    import BuilderTab from "./tab/builder-tab.svelte";
    import DataTab from "./tab/data-tab.svelte";

    let settingsStrings = new SettingsProperty();
    settingsStrings.getAll();

    let tabbarfocus = "index";
    let showIndexHelp = false;
    let showOutlineHelp = false;
    let showBuilderHelp = false;

    const indexHelpText = `
${i18n.indexMenu.helpStep1}: ${i18n.indexMenu.helpStep1Desc}
${i18n.indexMenu.helpStep2}: ${i18n.indexMenu.helpStep2Desc}
${i18n.indexMenu.helpStep3}: ${i18n.indexMenu.helpStep3Desc}
${i18n.indexMenu.helpStep4}: ${i18n.indexMenu.helpStep4Desc}

${i18n.indexMenu.helpNote}
    `;

    const outlineHelpText = `
${i18n.outlineMenu.helpStep1}: ${i18n.outlineMenu.helpStep1Desc}
${i18n.outlineMenu.helpStep2}: ${i18n.outlineMenu.helpStep2Desc}
${i18n.outlineMenu.helpStep3}: ${i18n.outlineMenu.helpStep3Desc}
${i18n.outlineMenu.helpStep4}: ${i18n.outlineMenu.helpStep4Desc}

${i18n.outlineMenu.helpNote}
    `;

    const builderHelpText = `
${i18n.builderMenu.helpStep1}: ${i18n.builderMenu.helpStep1Desc}
${i18n.builderMenu.helpStep2}: ${i18n.builderMenu.helpStep2Desc}
${i18n.builderMenu.helpStep3}: ${i18n.builderMenu.helpStep3Desc}
${i18n.builderMenu.helpStep4}: ${i18n.builderMenu.helpStep4Desc}

${i18n.builderMenu.helpListExample}
${i18n.builderMenu.helpListExampleContent}

${i18n.builderMenu.helpNote}
    `;

    function switchTab(tab: string) {
        tabbarfocus = tab;
    }

    eventBus.on("switchTab", switchTab);

    async function updateSettings() {
        settingsStrings.getAll();
        settingsStrings = settingsStrings; // Trigger reactivity
    }
    eventBus.on("updateSettings", updateSettings);

    onDestroy(() => {
        settings.save();
    });
</script>

<div class="fn__flex-1 fn__flex-column config__panel" style="height: 100%;">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="layout-tab-bar fn__flex">
        <!-- Index Tab -->
        <div
            class={tabbarfocus === "index"
                ? "item item--full item--focus"
                : "item item--full"}
            on:click={() => {
                tabbarfocus = "index";
                eventBus.emit("updateSettings");
            }}
            style="position: relative;"
        >
            <span class="fn__flex-1"></span>
            <span class="item__icon"
                ><svg><use xlink:href="#iconList" /></svg></span
            >
            <span class="item__text">{i18n.indexSettings}</span>
            <div
                class="builder-help-wrap"
                on:mouseenter={() => (showIndexHelp = true)}
                on:mouseleave={() => (showIndexHelp = false)}
            >
                <button
                    type="button"
                    class="builder-help-btn"
                    aria-label={i18n.indexMenu.helpTitle}
                    on:focus={() => (showIndexHelp = true)}
                    on:blur={() => (showIndexHelp = false)}
                >
                    <svg><use xlink:href="#iconHelp" /></svg>
                </button>
                {#if showIndexHelp}
                    <div class="builder-help-popover builder-help-popover--index" aria-live="polite">
                        <div class="builder-help-popover__title">{i18n.indexMenu.helpTitle}</div>
                        <div class="builder-help-popover__content">{indexHelpText}</div>
                    </div>
                {/if}
            </div>
            <span class="fn__flex-1"></span>
        </div>
        <!-- Outline Tab -->
        <div
            class={tabbarfocus === "outline"
                ? "item item--full item--focus"
                : "item item--full"}
            on:click={() => {
                tabbarfocus = "outline";
                eventBus.emit("updateSettings");
            }}
            style="position: relative;"
        >
            <span class="fn__flex-1"></span>
            <span class="item__icon"
                ><svg><use xlink:href="#iconAlignCenter" /></svg></span
            >
            <span class="item__text">{i18n.outlineSettings}</span>
            <div
                class="builder-help-wrap"
                on:mouseenter={() => (showOutlineHelp = true)}
                on:mouseleave={() => (showOutlineHelp = false)}
            >
                <button
                    type="button"
                    class="builder-help-btn"
                    aria-label={i18n.outlineMenu.helpTitle}
                    on:focus={() => (showOutlineHelp = true)}
                    on:blur={() => (showOutlineHelp = false)}
                >
                    <svg><use xlink:href="#iconHelp" /></svg>
                </button>
                {#if showOutlineHelp}
                    <div class="builder-help-popover" aria-live="polite">
                        <div class="builder-help-popover__title">{i18n.outlineMenu.helpTitle}</div>
                        <div class="builder-help-popover__content">{outlineHelpText}</div>
                    </div>
                {/if}
            </div>
            <span class="fn__flex-1"></span>
        </div>
        <!-- Builder Tab -->
        <div
            class={tabbarfocus === "builder"
                ? "item item--full item--focus"
                : "item item--full"}
            on:click={() => {
                tabbarfocus = "builder";
                eventBus.emit("updateSettings");
            }}
            style="position: relative;"
        >
            <span class="fn__flex-1"></span>
            <span class="item__icon"
                ><svg><use xlink:href="#iconSQL" /></svg></span
            >
            <span class="item__text">{i18n.builderSettings}</span>
            <div
                class="builder-help-wrap"
                on:mouseenter={() => (showBuilderHelp = true)}
                on:mouseleave={() => (showBuilderHelp = false)}
            >
                <button
                    type="button"
                    class="builder-help-btn"
                    aria-label={i18n.builderMenu.helpTitle}
                    on:focus={() => (showBuilderHelp = true)}
                    on:blur={() => (showBuilderHelp = false)}
                >
                    <svg><use xlink:href="#iconHelp" /></svg>
                </button>
                {#if showBuilderHelp}
                    <div class="builder-help-popover" aria-live="polite">
                        <div class="builder-help-popover__title">{i18n.builderMenu.helpTitle}</div>
                        <div class="builder-help-popover__content">{builderHelpText}</div>
                    </div>
                {/if}
            </div>
            <span class="fn__flex-1"></span>
        </div>
        <!-- Data Tab -->
        <div
            class={tabbarfocus === "data"
                ? "item item--full item--focus"
                : "item item--full"}
            on:click={() => {
                tabbarfocus = "data";
                eventBus.emit("updateSettings");
            }}
        >
            <span class="fn__flex-1"></span>
            <span class="item__icon"
                ><svg><use xlink:href="#iconDatabase" /></svg></span
            >
            <span class="item__text">{i18n.dataSettings}</span>
            <span class="fn__flex-1"></span>
        </div>
    </div>

    <div
        class="config__tab-wrap fn__flex-1"
        style="overflow-y: auto; padding: 16px;"
    >
        <IndexTab {tabbarfocus} {settingsStrings} />
        <OutlineTab {tabbarfocus} {settingsStrings} />
        <BuilderTab {tabbarfocus} {settingsStrings} />
        <DataTab {tabbarfocus} {settingsStrings} />
    </div>
</div>
