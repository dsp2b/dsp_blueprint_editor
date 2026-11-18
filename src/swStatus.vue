<script lang="ts" setup>
import { serviceWorker } from './serviceWorker';

const { status, upgradeReady, upgrade } = serviceWorker;
</script>

<template>
    <span>{{status}} <a v-if="upgradeReady" href="#" @click.prevent="upgrade()">刷新</a></span>
</template>
