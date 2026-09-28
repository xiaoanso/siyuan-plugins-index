import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig, loadEnv } from "vite"
import minimist from "minimist"
import { viteStaticCopy } from "vite-plugin-static-copy"
import livereload from "rollup-plugin-livereload"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import zipPack from "vite-plugin-zip-pack"
import fg from "fast-glob"

const pluginInfo = JSON.parse(readFileSync(resolve(__dirname, "plugin.json"), "utf-8"))

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "")
    const { VITE_SIYUAN_WORKSPACE_PATH } = env

    // watch：优先写到思源插件目录；未配置工作区时回退到 ./dist
    let watchOutDir = "./dist"
    if (VITE_SIYUAN_WORKSPACE_PATH) {
        console.log(`\nSiyuan workspace path is set:\n${VITE_SIYUAN_WORKSPACE_PATH}`)
        watchOutDir = `${VITE_SIYUAN_WORKSPACE_PATH}/data/plugins/${pluginInfo.name}`
    } else {
        console.log("\nSiyuan workspace path is not set. Falling back to ./dist")
        console.log("Copy .env.example to .env and set VITE_SIYUAN_WORKSPACE_PATH")
    }
    console.log(`\nPlugin will build to:\n${watchOutDir}`)

    const args = minimist(process.argv.slice(2))
    const isWatch = args.watch || args.w || false
    const distDir = isWatch ? watchOutDir : "./dist"

    console.log()
    console.log("isWatch=>", isWatch)
    console.log("distDir=>", distDir)

    return {
        plugins: [
            svelte(),

            viteStaticCopy({
                targets: [
                    {
                        src: "./README*.md",
                        dest: "./",
                    },
                    {
                        src: "./icon.png",
                        dest: "./",
                    },
                    {
                        src: "./preview.png",
                        dest: "./",
                    },
                    {
                        src: "./plugin.json",
                        dest: "./",
                    },
                    {
                        src: "./src/i18n/**",
                        dest: "./i18n/",
                    },
                    {
                        src: "./node_modules/sql.js/dist/sql-wasm.js",
                        dest: "./",
                    },
                    {
                        src: "./node_modules/sql.js/dist/sql-wasm.wasm",
                        dest: "./",
                    },
                ],
            }),
        ],

        // https://github.com/vitejs/vite/issues/1930
        // https://vitejs.dev/guide/env-and-mode.html#env-files
        define: {
            "process.env.DEV_MODE": `"${isWatch}"`,
            "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
        },

        build: {
            // watch → 思源插件目录（或 ./dist）；build → ./dist + package.zip
            outDir: distDir,
            emptyOutDir: !isWatch,

            sourcemap: false,
            // 不压缩，用于调试
            minify: !isWatch,

            lib: {
                entry: resolve(__dirname, "src/index.ts"),
                fileName: "index",
                formats: ["cjs"],
            },
            rollupOptions: {
                plugins: [
                    ...(
                        isWatch ? [
                            livereload(watchOutDir),
                            {
                                name: "watch-external",
                                async buildStart() {
                                    const files = await fg([
                                        "src/i18n/*.json",
                                        "./README*.md",
                                        "./plugin.json",
                                    ])
                                    for (const file of files) {
                                        this.addWatchFile(file)
                                    }
                                },
                            },
                        ] : [
                            zipPack({
                                inDir: "./dist",
                                outDir: "./",
                                outFileName: "package.zip",
                            }),
                        ]
                    ),
                ],

                external: ["siyuan", "process"],

                output: {
                    entryFileNames: "[name].js",
                    inlineDynamicImports: true,
                    assetFileNames: (assetInfo) => {
                        if (assetInfo.name === "style.css") {
                            return "index.css"
                        }
                        return assetInfo.name
                    },
                },
            },
        },
    }
})
