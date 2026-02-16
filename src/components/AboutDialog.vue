<script setup>
import { ref } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const dialogRef = ref(null)

function doClose() {
  emit('close')
}

function onKeydown(e) {
  if (e.key === 'Escape') doClose()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-transition">
      <div
        v-if="visible"
        class="about-overlay"
        @mousedown.self="doClose"
        @keydown="onKeydown"
      >
        <div
          ref="dialogRef"
          class="about-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="关于项目"
        >
          <div class="about-hero">
            <img
              class="about-avatar"
              src="https://pbs.twimg.com/profile_images/2020149012624732160/-JptmRgz_400x400.jpg"
              alt="小雨"
            />
            <div class="about-hero__info">
              <h2 class="about-hero__title">Metro Studio</h2>
              <p class="about-hero__author">by 小雨</p>
              <a
                class="about-hero__link"
                href="https://angelkawaii.xyz/"
                target="_blank"
                rel="noopener noreferrer"
              >angelkawaii.xyz</a>
            </div>
          </div>

          <div class="about-body">
            <div class="about-qa">
              <div class="about-qa__item">
                <h3 class="about-qa__q">为什么做这个项目？</h3>
                <p class="about-qa__a">
                  因为市面上没有好用的轨道交通线网编辑工具，加上自己对地铁线网一直很感兴趣，
                  闲着也是闲着，就动手做了。算是兴趣驱动加上解决实际痛点吧。
                </p>
              </div>
              <div class="about-qa__item">
                <h3 class="about-qa__q">未来打算怎么发展？</h3>
                <p class="about-qa__a">
                  希望能做成一个开源项目，吸引更多开发者一起参与贡献，
                  让轨交爱好者和城市规划感兴趣的人都能用上。
                </p>
              </div>
              <div class="about-qa__item">
                <h3 class="about-qa__q">开发中最有成就感的部分？</h3>
                <p class="about-qa__a">
                  示意图的自动布局算法和动画系统。布局算法调了很久才达到比较满意的效果，
                  动画则是让整个工具有了灵魂的感觉。
                </p>
              </div>
            </div>
          </div>

          <footer class="about-footer">
            <button
              class="about-btn"
              type="button"
              @click="doClose"
            >
              关闭
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.about-overlay {
  position: fixed;
  inset: 0;
  z-index: 9500;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}

.about-dialog {
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  background: var(--toolbar-card-bg);
  border: 1px solid var(--toolbar-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.about-hero {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 24px 20px;
  border-bottom: 1px solid var(--toolbar-divider);
}

.about-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--toolbar-divider);
  flex-shrink: 0;
}

.about-hero__info {
  min-width: 0;
}

.about-hero__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--toolbar-text);
  line-height: 1.3;
}

.about-hero__author {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--toolbar-muted);
}

.about-hero__link {
  display: inline-block;
  margin-top: 4px;
  font-size: 12px;
  color: #2563eb;
  text-decoration: none;
}

.about-hero__link:hover {
  text-decoration: underline;
}

.about-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.about-qa {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.about-qa__item {
  padding: 14px;
  background: var(--toolbar-input-bg);
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
}

.about-qa__q {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--toolbar-text);
}

.about-qa__a {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--toolbar-muted);
}

.about-footer {
  display: flex;
  justify-content: flex-end;
  padding: 14px 20px 16px;
  border-top: 1px solid var(--toolbar-divider);
}

.about-btn {
  padding: 7px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  background: linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%);
  border-color: var(--toolbar-primary-border);
  color: #fff;
  transition: all var(--transition-normal);
  outline: none;
}

.about-btn:hover {
  background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
  box-shadow: 0 2px 8px rgba(29, 78, 216, 0.35);
}

.about-btn:focus-visible {
  box-shadow: var(--focus-ring);
}
</style>
