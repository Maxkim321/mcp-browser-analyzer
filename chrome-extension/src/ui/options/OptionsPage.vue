<template>
  <div class="options-page">
    <h1 class="page-title">浏览器 AI 助手设置</h1>

    <!-- F5-1 用户偏好 -->
    <section class="card">
      <h2>偏好设置</h2>
      <p class="hint">偏好会随每次提问附带，AI 会按你的偏好调整回复风格</p>

      <div class="field">
        <label for="summaryStyle">总结格式</label>
        <select id="summaryStyle" v-model="prefs.summaryStyle">
          <option value="concise">简洁（要点 + 结论）</option>
          <option value="detailed">详细（含背景与展开说明）</option>
        </select>
      </div>

      <div class="field">
        <label for="translateLang">默认翻译语言</label>
        <select id="translateLang" v-model="prefs.translateLang">
          <option value="zh">中文</option>
          <option value="en">英文</option>
          <option value="ja">日文</option>
        </select>
      </div>

      <div class="field">
        <label for="replyStyle">回复风格</label>
        <select id="replyStyle" v-model="prefs.replyStyle">
          <option value="professional">专业正式</option>
          <option value="casual">口语化</option>
          <option value="concise">精简干练</option>
        </select>
      </div>

      <button class="save-btn" :disabled="saving" @click="savePrefs">
        {{ saving ? '保存中...' : '保存偏好' }}
      </button>
      <p v-if="saved" class="saved-tip">已保存 ✓</p>
    </section>

    <!-- F5-2 文章索引 -->
    <section class="card">
      <h2>已总结 / 收藏文章</h2>
      <input v-model="keyword" class="search-input" placeholder="搜索标题或摘要..." />

      <div v-if="filtered.length === 0" class="empty">暂无记录，先总结一篇文章试试</div>
      <ul v-else class="article-list">
        <li v-for="item in filtered" :key="item.url" class="article-item">
          <div class="article-info">
            <a :href="item.url" target="_blank" rel="noopener" class="article-title">
              {{ item.title || item.url }}
            </a>
            <p class="article-summary">{{ item.summary }}</p>
            <span class="article-time">{{ formatTime(item.savedAt) }}</span>
          </div>
          <button class="remove-btn" @click="remove(item)">删除</button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { getPrefs, savePrefs as persistPrefs, getArticles, removeArticle } from '@/utils/prefs'

defineOptions({ name: 'OptionsPage' })

const prefs = ref({ summaryStyle: 'concise', translateLang: 'zh', replyStyle: 'professional' })
const saving = ref(false)
const saved = ref(false)

const articles = ref([])
const keyword = ref('')

onMounted(async () => {
  prefs.value = await getPrefs()
  articles.value = await getArticles()
})

const savePrefs = async () => {
  saving.value = true
  saved.value = false
  try {
    prefs.value = await persistPrefs(prefs.value)
    saved.value = true
    setTimeout(() => (saved.value = false), 2000)
  } finally {
    saving.value = false
  }
}

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return articles.value
  return articles.value.filter(
    (a) =>
      (a.title || '').toLowerCase().includes(kw) ||
      (a.summary || '').toLowerCase().includes(kw) ||
      (a.url || '').toLowerCase().includes(kw)
  )
})

const remove = async (item) => {
  articles.value = await removeArticle(item.url)
}

const formatTime = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
.options-page {
  min-height: 100vh;
  padding: 24px;
  font-family:
    ui-sans-serif,
    -apple-system,
    BlinkMacSystemFont,
    Segoe UI,
    Roboto,
    Helvetica,
    Arial,
    sans-serif;
  background: #f5f6f8;
  color: #1f2328;
}

.page-title {
  margin: 0 0 20px;
  font-size: 22px;
  font-weight: 700;
}

.card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 20px;
  max-width: 640px;
}

.card h2 {
  margin: 0 0 6px;
  font-size: 17px;
}

.hint {
  margin: 0 0 16px;
  font-size: 13px;
  color: #6b7280;
}

.field {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.field label {
  width: 110px;
  font-size: 14px;
  color: #374151;
  flex-shrink: 0;
}

.field select {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
}

.save-btn {
  margin-top: 8px;
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  background: #1a7f37;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.saved-tip {
  margin: 8px 0 0;
  font-size: 13px;
  color: #1a7f37;
}

.search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  margin: 12px 0;
}

.empty {
  padding: 20px 0;
  text-align: center;
  color: #9ca3af;
  font-size: 14px;
}

.article-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.article-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid #f0f1f3;
}

.article-info {
  flex: 1;
  min-width: 0;
}

.article-title {
  font-size: 14px;
  font-weight: 600;
  color: #0969da;
  text-decoration: none;
  word-break: break-all;
}

.article-title:hover {
  text-decoration: underline;
}

.article-summary {
  margin: 4px 0 4px;
  font-size: 13px;
  color: #4b5563;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.article-time {
  font-size: 12px;
  color: #9ca3af;
}

.remove-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
}

.remove-btn:hover {
  color: #d1242f;
  border-color: #d1242f;
}
</style>
