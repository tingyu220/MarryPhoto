<script setup lang="ts">
/**
 * 应用外壳。
 *
 * 这里只做两件事：
 * 1. 渲染路由；
 * 2. 挂载 **全站唯一** 的全屏查看器实例 —— 所有浏览模式都通过
 *    usePhotoViewer().open(photos, index) 打开它，绝不各自再实现一个。
 */
import { RouterView } from 'vue-router'
import PhotoViewer from '@/components/photo/PhotoViewer.vue'
</script>

<template>
  <RouterView v-slot="{ Component }">
    <component :is="Component" />
  </RouterView>

  <PhotoViewer />
</template>
