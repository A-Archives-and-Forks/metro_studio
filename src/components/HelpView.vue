<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { marked } from 'marked'
import { DOC_CATEGORIES } from '../lib/helpDocs.js'

const props = defineProps({
  initCategory: { type: String, default: 'guide' },
})
const emit = defineEmits(['close'])

const activeCategory = ref(props.initCategory)
const scrollContainer = ref(null)
const cardRefs = ref([])
const scrollProgress = ref(0)
const visibleCount = ref(0)

const currentItems = computed(() => {
  const cat = DOC_CATEGORIES.find(c => c.key === activeCategory.value)
  return cat ? cat.items : []
})

const totalItems = computed(() => currentItems.value.length)

function renderMd(md) {
  return marked.parse(md, { breaks: true })
}

function switchCategory(key) {
  activeCategory.value = key
  nextTick(() => {
    if (scrollContainer.value) scrollContainer.value.scrollTop = 0
    updateScrollProgress()
  })
}

function updateScrollProgress() {
  const el = scrollContainer.value
  if (!el) return
  const { scrollTop, scrollHeight, clientHeight } = el
  scrollProgress.value = scrollHeight <= clientHeight ? 1 : scrollTop / (scrollHeight - clientHeight)
  // count visible
  let count = 0
  const cards = el.querySelectorAll('.help-card')
  cards.forEach(card => {
    const rect = card.getBoundingClientRect()
    const containerRect = el.getBoundingClientRect()
    if (rect.top < containerRect.bottom && rect.bottom > containerRect.top) count++
  })
  visibleCount.value = count
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  nextTick(updateScrollProgress)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
})

watch(activeCategory, () => nextTick(updateScrollProgress))

const year = new Date().getFullYear()
</script>

<template>
  <div class="help-overlay" @click.self="emit('close')">
    <!-- Decorative layers -->
    <div class="help-overlay__scanline" aria-hidden="true"></div>
    <div class="help-overlay__noise" aria-hidden="true"></div>
    <div class="help-overlay__corner help-overlay__corner--tl" aria-hidden="true"></div>
    <div class="help-overlay__corner help-overlay__corner--tr" aria-hidden="true"></div>
    <div class="help-overlay__corner help-overlay__corner--bl" aria-hidden="true"></div>
    <div class="help-overlay__corner help-overlay__corner--br" aria-hidden="true"></div>

    <!-- Top nav bar -->
    <header class="help-nav">
      <button class="help-nav__exit ark-glitch-hover" @click="emit('close')">&#9664; EXIT</button>
      <div class="help-nav__tabs">
        <button
          v-for="cat in DOC_CATEGORIES"
          :key="cat.key"
          class="help-nav__tab"
          :class="{ 'help-nav__tab--active': activeCategory === cat.key }"
          @click="switchCategory(cat.key)"
        >
          {{ cat.label }}
          <span class="help-nav__tab-line"></span>
        </button>
      </div>
      <span class="help-nav__esc">ESC</span>
      <div class="help-nav__edge-line"></div>
    </header>

    <!-- Content area -->
    <div class="help-body">
      <div class="help-progress" aria-hidden="true">
        <div class="help-progress__track"></div>
        <div class="help-progress__thumb" :style="{ top: (scrollProgress * 100) + '%' }"></div>
      </div>
      <div ref="scrollContainer" class="help-scroll" @scroll="updateScrollProgress">
        <section
          v-for="(item, i) in currentItems"
          :key="item.key"
          class="help-card"
          :style="{ animationDelay: (i * 80) + 'ms' }"
        >
          <div class="help-card__header">
            <span class="help-card__tag">SECTION</span>
            <span class="help-card__title">{{ item.title }}</span>
            <span class="help-card__line"></span>
          </div>
          <div class="help-card__body" v-html="renderMd(item.content)"></div>
        </section>
      </div>
    </div>

    <!-- Bottom status bar -->
    <footer class="help-status">
      <div class="help-status__left">
        <span class="help-status__diamond">&#9670;</span>
        <span>INTEL.SYS</span>
        <span class="help-status__progress-bar">{{ '▓'.repeat(Math.round(scrollProgress * 10)) }}{{ '░'.repeat(10 - Math.round(scrollProgress * 10)) }}</span>
        <span>{{ visibleCount }}/{{ totalItems }} LOADED</span>
      </div>
      <div class="help-status__right">
        <span>SN-0941-DOCS-{{ year }}</span>
        <span class="help-status__barcode" aria-hidden="true">▐▌▐▌▌▐▐▌▐▌</span>
      </div>
      <div class="help-status__edge-line"></div>
    </footer>
  </div>
</template>

<style scoped>
.help-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: var(--ark-bg-deep, #050505);
  display: flex;
  flex-direction: column;
}

/* ── Decorative layers ── */
.help-overlay__scanline {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.4) 50%);
  background-size: 100% 4px;
  animation: scan 10s linear infinite;
  opacity: 0.15;
}

.help-overlay__noise {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  opacity: 0.08;
  mix-blend-mode: screen;
  background-image:
    radial-gradient(rgba(255,255,255,0.25) 0.45px, transparent 0.55px),
    radial-gradient(rgba(188,31,255,0.18) 0.45px, transparent 0.55px);
  background-size: 3px 3px, 2px 2px;
  background-position: 0 0, 8px 8px;
}

.help-overlay__corner {
  position: absolute;
  width: 40px;
  height: 40px;
  pointer-events: none;
  z-index: 10;
}
.help-overlay__corner--tl { top: 20px; left: 20px; border-top: 1px solid var(--ark-border, rgba(188,31,255,0.3)); border-left: 1px solid var(--ark-border, rgba(188,31,255,0.3)); }
.help-overlay__corner--tr { top: 20px; right: 20px; border-top: 1px solid var(--ark-border, rgba(188,31,255,0.3)); border-right: 1px solid var(--ark-border, rgba(188,31,255,0.3)); }
.help-overlay__corner--bl { bottom: 20px; left: 20px; border-bottom: 1px solid var(--ark-border, rgba(188,31,255,0.3)); border-left: 1px solid var(--ark-border, rgba(188,31,255,0.3)); }
.help-overlay__corner--br { bottom: 20px; right: 20px; border-bottom: 1px solid var(--ark-border, rgba(188,31,255,0.3)); border-right: 1px solid var(--ark-border, rgba(188,31,255,0.3)); }

@keyframes scan {
  from { transform: translateY(0); }
  to { transform: translateY(4px); }
}

/* ── Top nav bar ── */
.help-nav {
  position: relative;
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  background: linear-gradient(180deg, rgba(15,15,18,0.9), rgba(8,8,10,0.88));
  border-bottom: 1px solid rgba(188,31,255,0.45);
  box-shadow: 0 0 14px rgba(249,0,191,0.22);
  flex-shrink: 0;
  z-index: 20;
}

.help-nav__exit {
  border: none;
  background: transparent;
  color: var(--ark-text-muted, #8a9ab5);
  font-family: var(--app-font-mono);
  font-size: 13px;
  text-transform: uppercase;
  cursor: pointer;
  padding: 4px 8px;
  transition: color 0.15s;
}
.help-nav__exit:hover {
  color: var(--ark-pink, #f900bf);
  text-shadow: -1px 0 rgba(249,0,191,0.8), 1px 0 rgba(188,31,255,0.8);
}

.help-nav__tabs {
  display: flex;
  align-items: center;
  margin-left: 16px;
  gap: 0;
}

.help-nav__tab {
  position: relative;
  border: 1px solid transparent;
  background: transparent;
  color: var(--toolbar-muted, #8a9ab5);
  font-family: var(--app-font-mono);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 6px 12px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.help-nav__tab:hover { color: var(--ark-pink, #f900bf); }

.help-nav__tab-line {
  position: absolute;
  bottom: 0; left: 50%;
  width: 0; height: 2px;
  background: var(--ark-pink, #f900bf);
  transition: width 0.3s cubic-bezier(0.16,1,0.3,1), left 0.3s cubic-bezier(0.16,1,0.3,1);
  box-shadow: 0 0 8px var(--ark-pink-glow, rgba(249,0,191,0.5));
  pointer-events: none;
}
.help-nav__tab:hover .help-nav__tab-line { width: 100%; left: 0; }

.help-nav__tab--active {
  color: var(--ark-text, #eef3ff);
  background: var(--toolbar-tab-active-bg, rgba(188,31,255,0.18));
  border-color: rgba(249,0,191,0.54);
}
.help-nav__tab--active .help-nav__tab-line { width: 100%; left: 0; }

.help-nav__esc {
  margin-left: auto;
  font-family: var(--app-font-mono);
  font-size: 10px;
  color: var(--ark-text-dim, #5a6a80);
  letter-spacing: 0.1em;
  border-left: 2px solid var(--ark-purple, #bc1fff);
  padding: 2px 6px;
}

.help-nav__edge-line {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--ark-purple, #bc1fff), var(--ark-pink, #f900bf), var(--ark-purple, #bc1fff), transparent);
  background-size: 200% 100%;
  animation: line-flow 10s linear infinite;
  opacity: 0.84;
}

@keyframes line-flow {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

/* ── Content body ── */
.help-body {
  flex: 1;
  position: relative;
  min-height: 0;
  z-index: 5;
}

.help-progress {
  position: absolute;
  left: 20px;
  top: 0;
  bottom: 0;
  width: 3px;
  z-index: 6;
}
.help-progress__track {
  position: absolute;
  inset: 0;
  background: var(--ark-border-dim, rgba(249,0,191,0.16));
}
.help-progress__thumb {
  position: absolute;
  left: 0;
  width: 3px;
  height: 60px;
  background: var(--ark-pink, #f900bf);
  box-shadow: 0 0 6px var(--ark-pink-glow, rgba(249,0,191,0.5));
  transition: top 0.15s;
}

.help-scroll {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 24px 48px 24px 40px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ── Cards ── */
.help-card {
  border: 1px solid var(--toolbar-card-border, rgba(188,31,255,0.44));
  border-left: 2px solid var(--ark-purple, #bc1fff);
  background: linear-gradient(160deg, rgba(188,31,255,0.08), rgba(10,10,12,0.94));
  clip-path: var(--clip-chamfer-md);
  box-shadow: 0 0 0 1px rgba(188,31,255,0.14), 0 0 12px rgba(188,31,255,0.14);
  animation: card-in 0.4s ease both;
}

@keyframes card-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.help-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(188,31,255,0.2);
}
.help-card__tag {
  font-size: 10px;
  color: var(--ark-text-dim, #5a6a80);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.help-card__title {
  font-family: var(--app-font-mono);
  color: var(--ark-pink, #f900bf);
  font-size: 15px;
  text-shadow: 0 0 8px var(--ark-pink-glow, rgba(249,0,191,0.5));
}
.help-card__line {
  flex: 1;
  height: 1px;
  background: var(--ark-border, rgba(188,31,255,0.3));
}
.help-card__body {
  padding: 14px 16px;
}

/* ── Markdown rendered HTML ── */
.help-card__body :deep(h1) { display: none; }
.help-card__body :deep(h2) {
  font-family: var(--app-font-mono);
  color: var(--ark-pink, #f900bf);
  font-size: 16px;
  border-bottom: 1px solid var(--ark-border, rgba(188,31,255,0.3));
  padding-bottom: 8px;
  margin: 16px 0 10px;
}
.help-card__body :deep(h3) {
  color: var(--ark-purple, #bc1fff);
  font-size: 14px;
  margin: 12px 0 6px;
}
.help-card__body :deep(p) {
  color: var(--ark-text, #eef3ff);
  line-height: 1.7;
  font-size: 14px;
  margin: 6px 0;
}
.help-card__body :deep(a) {
  color: var(--ark-purple, #bc1fff);
  text-decoration: none;
}
.help-card__body :deep(a:hover) {
  color: var(--ark-pink, #f900bf);
}
.help-card__body :deep(code) {
  background: rgba(188,31,255,0.12);
  border: 1px solid rgba(188,31,255,0.25);
  color: var(--ark-pink, #f900bf);
  padding: 1px 5px;
  font-family: var(--app-font-mono);
  font-size: 13px;
}
.help-card__body :deep(pre > code) {
  display: block;
  background: rgba(5,5,7,0.95);
  border: 1px solid var(--ark-border, rgba(188,31,255,0.3));
  padding: 14px;
  clip-path: var(--clip-chamfer-sm);
  overflow-x: auto;
  font-size: 13px;
}
.help-card__body :deep(pre) {
  margin: 8px 0;
}
.help-card__body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
}
.help-card__body :deep(th) {
  background: rgba(188,31,255,0.12);
  border: 1px solid var(--ark-border, rgba(188,31,255,0.3));
  color: var(--ark-pink, #f900bf);
  text-transform: uppercase;
  font-size: 12px;
  letter-spacing: 0.06em;
  padding: 8px 12px;
  text-align: left;
}
.help-card__body :deep(td) {
  border: 1px solid rgba(188,31,255,0.2);
  padding: 8px 12px;
  color: var(--ark-text, #eef3ff);
  font-size: 14px;
}
.help-card__body :deep(ul),
.help-card__body :deep(ol) {
  color: var(--ark-text, #eef3ff);
  padding-left: 20px;
  font-size: 14px;
  line-height: 1.7;
}
.help-card__body :deep(li::marker) { color: var(--ark-purple, #bc1fff); }
.help-card__body :deep(strong) { color: #fff; font-weight: 600; }
.help-card__body :deep(img) { display: none; }
.help-card__body :deep(blockquote) {
  border-left: 3px solid var(--ark-pink, #f900bf);
  background: rgba(249,0,191,0.06);
  padding: 10px 16px;
  margin: 8px 0;
}

/* ── Status bar ── */
.help-status {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 12px;
  background: linear-gradient(180deg, rgba(10,10,12,0.92), rgba(6,6,8,0.95));
  border-top: 1px solid rgba(188,31,255,0.35);
  flex-shrink: 0;
  z-index: 20;
  font-family: var(--app-font-mono);
  font-size: 11px;
  color: var(--ark-text-dim, #5a6a80);
  letter-spacing: 0.08em;
}

.help-status__left,
.help-status__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.help-status__diamond {
  color: var(--ark-pink, #f900bf);
}

.help-status__progress-bar {
  font-size: 10px;
  letter-spacing: 0;
}

.help-status__barcode {
  font-size: 10px;
  letter-spacing: 0.02em;
  opacity: 0.5;
}

.help-status__edge-line {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--ark-purple, #bc1fff), var(--ark-pink, #f900bf), var(--ark-purple, #bc1fff), transparent);
  background-size: 200% 100%;
  animation: line-flow 10s linear infinite;
}
</style>
