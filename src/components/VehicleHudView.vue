<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import {
  buildHudLineRoute,
  buildVehicleHudRenderModel,
} from "../lib/hud/renderModel";
import { useProjectStore } from "../stores/projectStore";

const store = useProjectStore();
const selectedLineId = ref("");
const selectedDirectionKey = ref("");
const svgRef = ref(null);
const viewport = reactive({
  scale: 1,
  tx: 0,
  ty: 0,
});
const panState = reactive({
  active: false,
  lastClientX: 0,
  lastClientY: 0,
});

const lineOptions = computed(() => store.project?.lines || []);
const viewportTransform = computed(
  () => `translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`,
);

watch(
  [lineOptions, () => store.activeLineId],
  () => {
    const lines = lineOptions.value;
    if (!lines.length) {
      selectedLineId.value = "";
      selectedDirectionKey.value = "";
      return;
    }
    const stillExists = lines.some((line) => line.id === selectedLineId.value);
    if (stillExists) return;
    selectedLineId.value =
      store.activeLineId && lines.some((line) => line.id === store.activeLineId)
        ? store.activeLineId
        : lines[0].id;
  },
  { immediate: true },
);

const route = computed(() =>
  buildHudLineRoute(store.project, selectedLineId.value),
);
const directionOptions = computed(() => route.value.directionOptions || []);

watch(
  directionOptions,
  (options) => {
    if (!options.length) {
      selectedDirectionKey.value = "";
      return;
    }
    const exists = options.some(
      (item) => item.key === selectedDirectionKey.value,
    );
    if (!exists) {
      selectedDirectionKey.value = options[0].key;
    }
  },
  { immediate: true },
);

const model = computed(() =>
  buildVehicleHudRenderModel(store.project, {
    lineId: selectedLineId.value,
    directionKey: selectedDirectionKey.value,
    route: route.value,
  }),
);

function formatLineOptionLabel(line) {
  const zh = String(line?.nameZh || "").trim();
  const en = String(line?.nameEn || "").trim();
  if (zh && en) return `${zh} / ${en}`;
  return zh || en || String(line?.id || "").trim() || "未命名线路";
}

function formatDirectionOptionLabel(option) {
  const zh = String(option?.labelZh || "").trim();
  const en = String(option?.labelEn || "").trim();
  if (zh && en) return `${zh} / ${en}`;
  return zh || en || String(option?.key || "").trim() || "未命名方向";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resetViewport() {
  viewport.scale = 1;
  viewport.tx = 0;
  viewport.ty = 0;
}

function toSvgPoint(clientX, clientY) {
  if (!svgRef.value) return null;
  const ctm = svgRef.value.getScreenCTM();
  if (!ctm) return null;
  const point = svgRef.value.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(ctm.inverse());
}

function onCanvasWheel(event) {
  const focus = toSvgPoint(event.clientX, event.clientY);
  if (!focus) return;

  const oldScale = viewport.scale;
  const zoomFactor = Math.exp(-event.deltaY * 0.0017);
  const nextScale = clamp(oldScale * zoomFactor, 0.32, 6);
  if (Math.abs(nextScale - oldScale) < 1e-6) return;

  viewport.tx += (oldScale - nextScale) * focus.x;
  viewport.ty += (oldScale - nextScale) * focus.y;
  viewport.scale = nextScale;
}

function onCanvasMouseDown(event) {
  if (event.button !== 1) return;
  event.preventDefault();
  panState.active = true;
  panState.lastClientX = event.clientX;
  panState.lastClientY = event.clientY;
}

function onCanvasAuxClick(event) {
  if (event.button === 1) {
    event.preventDefault();
  }
}

function endMiddlePan() {
  panState.active = false;
}

function onGlobalMouseMove(event) {
  if (!panState.active) return;

  const previous = toSvgPoint(panState.lastClientX, panState.lastClientY);
  const current = toSvgPoint(event.clientX, event.clientY);
  if (previous && current) {
    viewport.tx += current.x - previous.x;
    viewport.ty += current.y - previous.y;
  }

  panState.lastClientX = event.clientX;
  panState.lastClientY = event.clientY;
}

function onGlobalMouseUp(event) {
  if (!panState.active) return;
  if (event.type === "mouseup" && event.button !== 1) return;
  endMiddlePan();
}

watch(
  () => [
    selectedLineId.value,
    selectedDirectionKey.value,
    model.value.width,
    model.value.height,
  ],
  async () => {
    await nextTick();
    resetViewport();
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("mousemove", onGlobalMouseMove);
  window.addEventListener("mouseup", onGlobalMouseUp);
  window.addEventListener("blur", onGlobalMouseUp);
});

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onGlobalMouseMove);
  window.removeEventListener("mouseup", onGlobalMouseUp);
  window.removeEventListener("blur", onGlobalMouseUp);
});
</script>

<template>
  <section class="vehicle-hud">
    <header class="vehicle-hud__controls">
      <label class="vehicle-hud__control">
        <span class="vehicle-hud__control-label">线路</span>
        <select
          v-model="selectedLineId"
          class="vehicle-hud__select"
          :disabled="!lineOptions.length"
        >
          <option v-if="!lineOptions.length" value="">暂无线路</option>
          <option v-for="line in lineOptions" :key="line.id" :value="line.id">
            {{ formatLineOptionLabel(line) }}
          </option>
        </select>
      </label>
      <label class="vehicle-hud__control">
        <span class="vehicle-hud__control-label">方向</span>
        <select
          v-model="selectedDirectionKey"
          class="vehicle-hud__select"
          :disabled="!directionOptions.length"
        >
          <option v-if="!directionOptions.length" value="">暂无方向</option>
          <option
            v-for="option in directionOptions"
            :key="option.key"
            :value="option.key"
          >
            {{ formatDirectionOptionLabel(option) }}
          </option>
        </select>
      </label>
    </header>
    <div
      class="vehicle-hud__canvas"
      :class="{ 'vehicle-hud__canvas--panning': panState.active }"
      @wheel.prevent="onCanvasWheel"
      @mousedown="onCanvasMouseDown"
      @auxclick="onCanvasAuxClick"
    >
      <template v-if="model.ready">
        <svg
          ref="svgRef"
          class="vehicle-hud__svg"
          :viewBox="`0 0 ${model.width} ${model.height}`"
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs class="hud-defs">
            <linearGradient
              id="hudBg"
              class="hud-defs__bg-gradient"
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stop-color="#f2f7fe" />
              <stop offset="100%" stop-color="#e6eef8" />
            </linearGradient>
            <filter
              id="hudShadow"
              class="hud-defs__track-shadow"
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feDropShadow
                dx="0"
                dy="2"
                stdDeviation="2.2"
                flood-color="#000000"
                flood-opacity="0.13"
              />
            </filter>
            <g id="hudChevron" class="hud-defs__chevron">
              <path
                d="M -7 -7 L 0 0 L -7 7"
                fill="none"
                stroke="#f5fbff"
                stroke-width="2.8"
                stroke-linecap="round"
              />
            </g>
          </defs>

          <rect
            class="hud-scene__background"
            width="100%"
            height="100%"
            fill="url(#hudBg)"
          />
          <g class="vehicle-hud__skyline" opacity="0.14">
            <path
              class="vehicle-hud__skyline-shape"
              d="M0 400 L110 360 L170 380 L230 320 L300 350 L380 300 L430 340 L520 260 L620 330 L710 290 L780 345 L860 280 L940 355 L1010 310 L1090 350 L1170 285 L1260 360 L1340 300 L1410 345 L1490 280 L1580 355 L1660 320 L1730 360 L1810 330 L1920 385 L1920 620 L0 620 Z"
              fill="#bfd4ec"
            />
          </g>

          <g class="hud-scene__viewport" :transform="viewportTransform">
            <rect
              class="hud-frame hud-frame--outer"
              x="12"
              y="12"
              :width="model.width - 24"
              :height="model.height - 24"
              rx="22"
              fill="#ffffff"
              stroke="#d6dfeb"
              stroke-width="1.8"
            />
            <path
              class="hud-track hud-track--glow"
              :d="model.trackPath"
              fill="none"
              stroke="#ffffff"
              stroke-width="28"
              stroke-linecap="round"
              stroke-linejoin="round"
              filter="url(#hudShadow)"
            />
            <path
              class="hud-track hud-track--main"
              :d="model.trackPath"
              fill="none"
              :stroke="model.lineColor"
              stroke-width="16"
              stroke-linecap="round"
              stroke-linejoin="round"
            />

            <g
              v-for="mark in model.chevrons"
              :key="mark.id"
              class="hud-track__chevron-pair"
            >
              <use
                class="hud-track__chevron"
                href="#hudChevron"
                :transform="`translate(${mark.x} ${mark.y}) rotate(${mark.angle})`"
              />
              <use
                class="hud-track__chevron"
                href="#hudChevron"
                :transform="`translate(${mark.x + 9} ${mark.y}) rotate(${mark.angle})`"
              />
            </g>

            <g
              v-for="station in model.stations"
              :key="station.id"
              class="hud-station"
            >
              <circle
                class="hud-station__core"
                :cx="station.x"
                :cy="station.y"
                :r="station.isInterchange ? 24.6 : 24"
                fill="#ffffff"
                :stroke="model.lineColor"
                :stroke-width="station.isInterchange ? 10 : 7"
              />
              <circle
                v-if="station.isInterchange"
                class="hud-station__interchange-inner-ring"
                :cx="station.x"
                :cy="station.y"
                r="13.8"
                fill="none"
                :stroke="model.lineColor"
                stroke-width="3.6"
              />

              <g v-if="station.isInterchange" class="hud-station__interchange">
                <path
                  class="hud-station__transfer-pointer"
                  :d="`M ${station.x - 7} ${station.connectorDotY} L ${station.x + 7} ${station.connectorDotY} L ${station.x} ${station.connectorDotY + station.transferCalloutDirection * 14} Z`"
                  :fill="station.transferBadges[0]?.color || '#e6b460'"
                  stroke="#ffffff"
                  stroke-width="1.1"
                />
                <text
                  class="hud-station__transfer-label-zh"
                  :x="station.x"
                  :y="station.transferLabelZhY"
                  text-anchor="middle"
                  fill="#14283e"
                  font-size="18"
                  font-weight="700"
                >
                  换乘
                </text>
                <text
                  class="hud-station__transfer-label-en hud-text-en"
                  :x="station.x"
                  :y="station.transferLabelEnY"
                  text-anchor="middle"
                  fill="#516984"
                  font-size="13"
                  font-weight="600"
                >
                  Transfer
                </text>

                <g
                  v-for="(badge, badgeIndex) in station.transferBadges"
                  :key="`${station.id}_badge_${badge.lineId}`"
                  class="hud-station__transfer-badge"
                >
                  <rect
                    class="hud-station__transfer-badge-bg"
                    :x="
                      station.x -
                      badge.badgeWidth / 2 +
                      (station.transferBadges.length > 2
                        ? badgeIndex % 2 === 0
                          ? -badge.badgeWidth / 2 - 4
                          : badge.badgeWidth / 2 + 4
                        : 0)
                    "
                    :y="
                      station.transferBadgeY +
                      (station.transferCalloutDirection > 0
                        ? station.transferBadges.length > 2
                          ? Math.floor(badgeIndex / 2) * 36
                          : badgeIndex * 36
                        : station.transferBadges.length > 2
                          ? Math.floor(badgeIndex / 2) * -36
                          : badgeIndex * -36)
                    "
                    :width="badge.badgeWidth"
                    height="26"
                    rx="6"
                    :fill="badge.color || '#d5ab4f'"
                    stroke="#ffffff"
                    stroke-width="1.1"
                  />
                  <text
                    class="hud-station__transfer-badge-text"
                    :x="
                      station.x +
                      (station.transferBadges.length > 2
                        ? badgeIndex % 2 === 0
                          ? -badge.badgeWidth / 2 - 4
                          : badge.badgeWidth / 2 + 4
                        : 0)
                    "
                    :y="
                      station.transferBadgeY +
                      (station.transferCalloutDirection > 0
                        ? station.transferBadges.length > 2
                          ? Math.floor(badgeIndex / 2) * 36
                          : badgeIndex * 36
                        : station.transferBadges.length > 2
                          ? Math.floor(badgeIndex / 2) * -36
                          : badgeIndex * -36) +
                      18
                    "
                    text-anchor="middle"
                    fill="#ffffff"
                    font-size="16"
                    font-weight="800"
                  >
                    {{ badge.text || "?" }}
                  </text>
                </g>
              </g>

              <text
                class="hud-station__name-zh hud-station-zh"
                :x="station.labelX"
                :y="station.labelY"
                :text-anchor="station.labelAnchor"
                :transform="`rotate(${station.labelAngle} ${station.labelX} ${station.labelY})`"
                fill="#11263e"
                font-size="26"
                font-weight="700"
              >
                {{ station.nameZh }}
              </text>
              <text
                v-if="station.nameEn"
                class="hud-station__name-en hud-station-en"
                :x="station.labelX"
                :y="station.labelEnY"
                :text-anchor="station.labelAnchor"
                :transform="`rotate(${station.labelAngle} ${station.labelX} ${station.labelY})`"
                fill="#11263e"
                font-size="17"
                font-weight="700"
                letter-spacing="0.02em"
              >
                {{ station.nameEn }}
              </text>
            </g>
          </g>
        </svg>
      </template>
      <p v-else class="vehicle-hud__empty">{{ model.reason }}</p>
    </div>
  </section>
</template>

<style>
.vehicle-hud {
  border: 1px solid var(--workspace-panel-border);
  border-radius: 12px;
  background: var(--workspace-panel-bg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.vehicle-hud__controls {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(240px, 1fr);
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--workspace-panel-border);
  background: var(--workspace-panel-header-bg);
}

.vehicle-hud__control {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.vehicle-hud__control-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--workspace-panel-muted);
}

.vehicle-hud__select {
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
  background: var(--toolbar-input-bg);
  color: var(--toolbar-input-text);
  padding: 0 10px;
  font-size: 13px;
}

.vehicle-hud__select:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.vehicle-hud__canvas {
  flex: 1;
  min-height: 0;
  background: var(--workspace-canvas-bg);
  display: flex;
  user-select: none;
  cursor: default;
}

.vehicle-hud__canvas--panning {
  cursor: grabbing;
}

.vehicle-hud__svg {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

.vehicle-hud__empty {
  margin: auto;
  color: var(--workspace-panel-muted);
  font-size: 14px;
}

.hud-station-zh {
  font-family:
    "Source Han Sans SC", "Noto Sans CJK SC", "微软雅黑", "Microsoft YaHei",
    sans-serif;
}

.hud-text-en,
.hud-station-en {
  font-family:
    "DIN Alternate", "Bahnschrift", "Roboto Condensed", "Arial Narrow",
    "Noto Sans", sans-serif;
}
.hud-station__transfer-label-zh {
  transform: translateY(-20px);
}
.hud-station__transfer-label-en {
  transform: translateY(-25px);
}
g.hud-station__transfer-badge {
  transform: translateY(-35px);
}

.hud-station-zh {
  font-size: 26px;
  font-weight: 760;
}

.hud-station-en {
  font-size: 17px;
  font-weight: 680;
  letter-spacing: 0.01em;
}

@media (max-width: 960px) {
  .vehicle-hud__controls {
    grid-template-columns: 1fr;
  }
}
</style>
