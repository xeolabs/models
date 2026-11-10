<script setup lang="ts">
// These panels remain available; their headers do not offer a close action.
defineProps<{ params: { api: { title: string } } }>();
</script>
<template>
  <span class="panel-title">{{ params.api.title }}</span>
</template>
