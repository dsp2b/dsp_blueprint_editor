module.exports = {
    moduleFileExtensions: ["js", "ts", "json", "vue"],
    transform: {
        // three 的构建产物：只做 ESM → CJS（vue-cli 的 babel 预设不认 static class block，Node 本身支持，无需降级语法）
        "/node_modules/three/.+\\.js$": ["babel-jest", { babelrc: false, configFile: false, plugins: ["@babel/plugin-transform-modules-commonjs"] }],
        "^.+\\.jsx?$": "babel-jest",
        "^.+\\.tsx?$": ["ts-jest", { babelConfig: true }],
        "^.+\\.vue$": "@vue/vue3-jest"
    },
    // three 0.16x 起 build/three.cjs 只是 require 了 ESM 构建，jest 的模块系统不支持 require(esm)，让 babel 转换 three
    transformIgnorePatterns: ['/node_modules/(?!three/)'],
    moduleNameMapper: {
        // 组件测试里的静态资源 import（svg/png）用占位字符串代替
        '\\.(svg|png)$': '<rootDir>/tests/unit/__stubs__/asset.js',
        '^@/(.*)$': '<rootDir>/src/$1'
    },
}
