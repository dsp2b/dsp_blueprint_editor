import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';

const production = process.env.NODE_ENV === 'production';

export default defineConfigWithVueTs(
    { ignores: ['dist/**', 'cli/**', 'public/**', 'tools/**', 'coverage/**'] },
    js.configs.recommended,
    pluginVue.configs['flat/essential'],
    vueTsConfigs.recommended,
    {
        languageOptions: {
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/ban-ts-comment': 'off',
            'no-console': production ? 'warn' : 'off',
            'no-debugger': production ? 'warn' : 'off',
        },
    },
    {
        files: ['**/__tests__/*.{js,ts,jsx,tsx}', 'tests/unit/**/*.spec.{js,ts,jsx,tsx}'],
        languageOptions: { globals: globals.jest },
    },
    {
        // 根目录的 CommonJS 配置文件
        files: ['*.js'],
        languageOptions: { sourceType: 'commonjs' },
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
);
