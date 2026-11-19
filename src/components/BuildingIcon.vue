<template>
    <div class="icon" :class="{'has-count': props.count !== undefined}" :title="props.alt">
        <img :src="src" :alt="props.alt">
        <div v-if="props.count !== undefined" class="count">{{props.count === 1 ? '' : props.count}}</div>
    </div>
</template>

<script lang="ts" setup>
import { ref, watchEffect } from 'vue';
import { iconUrl } from '@/data/icons';

const props = defineProps<{
    iconId: number,
    alt?: string,
    count?: number,
}>();

const src = ref('');
watchEffect(async () => {
    const id = props.iconId;
    src.value = '';
    let url = '';
    try {
        url = await iconUrl(id);
    } catch {
        // 游戏里不存在的图标 id（例如激光灯塔、新版本的物品）不显示图片
    }
    if (id === props.iconId)
        src.value = url;
});
</script>

<style lang="scss">
.icon {
    display: inline-block;
    position: relative;
    width: 2.5rem;

    &.has-count {
        padding-bottom: .4em;
    }

    img {
        width: 100%;
        display: block;
    }

    .count {
        position: absolute;
        right: 0;
        bottom: 0;
        font-size: 0.8em;
        color: cyan;
        text-shadow: 0 0 10px cyan;
    }
}
</style>
