const { defineConfig } = require('@vue/cli-service')
const webpack = require('webpack')
const { execSync } = require('child_process')

module.exports = defineConfig({
    publicPath: '/dsp_blueprint_editor/',
    transpileDependencies: false,
    configureWebpack: {
        module: {
            rules: [
                {
                    test: /\/assets\//,
                    type: 'asset',
                }, {
                    test: /\/assets\/icons\/(item_recipe|signal|tech)\//,
                    type: 'asset/resource',
                },
            ],
        },
        resolve: {
            alias: {
                three$: 'three/src/Three.js',
            }
        },
        plugins: [
            new webpack.DefinePlugin({
                VERSION: JSON.stringify(execSync('git describe --tags --always --dirty', { encoding: 'utf8' }).trim()),
            }),
        ],
    },
    pwa: {
        name: '戴森球计划蓝图预览',
        themeColor: '#000000',
        msTileColor: null,
        appleMobileWebAppCapable: 'yes',
        appleMobileWebAppStatusBarStyle: 'black',
        manifestOptions: {
            short_name: '蓝图预览',
            icons: [
                {
                    'src': './img/icons/android-chrome-192x192.png',
                    'sizes': '192x192',
                    'type': 'image/png'
                },
                {
                    'src': './img/icons/android-chrome-512x512.png',
                    'sizes': '512x512',
                    'type': 'image/png'
                },
            ],
        },
        workboxOptions: {
            // 覆盖插件的默认 exclude，所以要带上它原有的几项。
            // 模型不进安装时预缓存（否则精简模式也会全部下载），真实模型模式下载过的在运行时缓存，离线可用
            exclude: [/\.map$/, /img\/icons\//, /favicon\.ico$/, /^manifest.*\.js?$/, /^models\//],
            runtimeCaching: [
                {
                    urlPattern: /\/models\/.*\.glb$/,
                    handler: 'CacheFirst',
                    options: {
                        cacheName: 'dsp-models',
                        expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600 },
                    },
                },
                {
                    urlPattern: /\/models\/manifest\.json$/,
                    handler: 'NetworkFirst',
                    options: { cacheName: 'dsp-models-manifest' },
                },
            ],
        },
        iconPaths: {
            faviconSVG: 'img/icons/favicon.svg',
            favicon32: 'img/icons/favicon-32x32.png',
            favicon16: 'img/icons/favicon-16x16.png',
            appleTouchIcon: null,
            maskIcon: null,
            msTileImage: null,
        },
    },

    pluginOptions: {
      i18n: {
        localeDir: 'locales',
        enableLegacy: false,
        runtimeOnly: true,
        compositionOnly: true,
        fullInstall: true
      }
    }
})
