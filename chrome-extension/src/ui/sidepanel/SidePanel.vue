<template>
  <div class="starter">
    <div class="logo">
      <img src="./assets/logo.png" alt="logo" />
    </div>
    <h1 class="title">你已成功启动 Vue 扩展模板</h1>
    <p class="subtitle">这是一个侧边栏</p>
    <div class="links">
      <a href="https://vuejs.org/" rel="noopener">Vue 文档</a>
      <a href="https://vitejs.dev/" rel="noopener">Vite 文档</a>
      <a href="https://eslint.org/" rel="noopener">ESLint</a>
      <a href="https://prettier.io/" rel="noopener">Prettier</a>
    </div>
    <div class="card">
      <p>开始编辑此页面：<code>src/sidepanel/SidePanel.vue</code></p>
      <button class="btn" @click="goOptions">打开扩展选项页</button>
    </div>
  </div>
</template>

<script setup>
defineOptions({
  name: 'SidePanel',
})
import { openOptions } from '@/utils/base'
const goOptions = () => openOptions()
</script>

<style scoped>
.starter {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  gap: 16px;
  background: #fff;
  min-height: 100vh;
  font-family:
    ui-sans-serif,
    -apple-system,
    BlinkMacSystemFont,
    Segoe UI,
    Roboto,
    Helvetica,
    Arial,
    Apple Color Emoji,
    Segoe UI Emoji;
  color: #000;
}
.logo {
  width: 64px;
  height: 64px;
}

.logo img {
  width: 100%;
  height: 100%;
  display: block;
}
.title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  text-align: center;
}
.subtitle {
  margin: 0;
  font-size: 14px;
  color: #000;
  text-align: center;
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}
.links a {
  text-decoration: none;
  padding: 8px 12px;
  border-radius: 999px;
  background: #f2f4f7;
  color: #000;
  font-size: 13px;
  border: 1px solid #e5e7eb;
}
.links a:hover {
  background: #e9edf3;
}
.card {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.card code {
  background: #f6f8fa;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 12px;
}
.btn {
  padding: 10px 16px;
  border: 1px solid #e5e7eb;
  background: #f8fafc;
  color: #000;
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  min-height: 36px;
}
.btn:hover {
  background: #eef2f7;
}
</style>
