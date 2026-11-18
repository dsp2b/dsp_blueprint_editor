<template>
    <div class="open-error" role="alert">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>
        </svg>
        <div>
            <b>{{ t(`error_${error.kind}_title`, error.params) }}</b><br>
            {{ t(`error_${error.kind}_hint`, error.params) }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { ParseErrorInfo } from '@/open/errorMap';

defineProps<{ error: ParseErrorInfo }>();
const { t } = useI18n();
</script>

<style lang="scss" scoped>
.open-error {
    display: flex;
    gap: 10px;
    margin-top: 14px;
    padding: 12px 14px;
    border-radius: 8px;
    background: rgba(255, 122, 107, .1);
    border: 1px solid rgba(255, 122, 107, .4);
    color: #FFC2BA;
    font-size: 13px;
    text-align: start;
    svg { flex: none; margin-top: 1px; }
}
</style>

<i18n>
{
    zh: {
        "error_notBlueprint_title": "这不是蓝图代码。",
        "error_notBlueprint_hint": "蓝图代码以 BLUEPRINT: 开头。请从游戏里复制整段蓝图代码，或选择蓝图 .txt 文件。",
        "error_checksum_title": "这段代码无法解析：校验码不匹配。",
        "error_checksum_hint": "代码可能没有复制完整。请回到游戏里重新复制整段蓝图代码再粘贴。",
        "error_truncated_title": "这段代码无法解析：内容不完整或已损坏。",
        "error_truncated_hint": "请回到游戏里重新复制整段蓝图代码再粘贴。",
        "error_newer_title": "这份蓝图来自游戏 {version}，比当前支持的 {supported} 更新。",
        "error_newer_hint": "请等待编辑器更新，或在游戏里用已支持的版本重新导出。",
        "error_unknown_title": "这段代码无法解析。",
        "error_unknown_hint": "请确认复制的是完整的蓝图代码。"
    },
    en: {
        "error_notBlueprint_title": "This is not a blueprint code.",
        "error_notBlueprint_hint": "A blueprint code starts with BLUEPRINT:. Copy the whole code from the game, or choose a blueprint .txt file.",
        "error_checksum_title": "This code cannot be read: the checksum does not match.",
        "error_checksum_hint": "The code may be incomplete. Copy the whole blueprint code from the game again and paste it.",
        "error_truncated_title": "This code cannot be read: it is incomplete or corrupt.",
        "error_truncated_hint": "Copy the whole blueprint code from the game again and paste it.",
        "error_newer_title": "This blueprint is from game {version}, newer than the supported {supported}.",
        "error_newer_hint": "Wait for the editor to be updated, or export it again from a supported game version.",
        "error_unknown_title": "This code cannot be read.",
        "error_unknown_hint": "Make sure you copied the complete blueprint code."
    },
}
</i18n>
