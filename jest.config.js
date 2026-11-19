module.exports = {
    moduleFileExtensions: ["js", "ts", "json", "vue"],
    transform: {
        "^.+\\.jsx?$": "babel-jest",
        "^.+\\.tsx?$": ["ts-jest", { babelConfig: true }],
        "^.+\\.vue$": "@vue/vue3-jest"
    },
    moduleNameMapper: {
        // 组件测试里的静态资源 import（svg/png）用占位字符串代替
        '\\.(svg|png)$': '<rootDir>/tests/unit/__stubs__/asset.js',
        '^@/(.*)$': '<rootDir>/src/$1'
    },
}
