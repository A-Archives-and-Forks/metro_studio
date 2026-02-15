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
import {
  JINAN_METRO_ICON_COLOR,
  JINAN_METRO_ICON_INNER_PATH,
  JINAN_METRO_ICON_MAIN_PATH,
  JINAN_METRO_ICON_TRANSFORM,
} from "../lib/hud/jinanBrand";
import jinanWordmarkImage from "../assets/jinan.png";
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
const hudHeaderLayout = computed(() => {
  const stripX = 30;
  const stripY = 16;
  const stripHeight = 88;
  const stripWidth = Math.max(720, model.value.width - 60);
  const contentX = stripX + 6;
  const contentY = stripY + 2;
  const contentHeight = stripHeight - 4;
  const contentWidth = stripWidth - 12;

  /* brand card */
  const brandCardX = contentX + 6;
  const brandCardY = contentY + 4;
  const brandCardW = 160;
  const brandCardH = 76;

  /* line badge area – right of brand card */
  const lineBadgeX = brandCardX + brandCardW + 16;
  const lineBadgeCenterY = stripY + stripHeight / 2;

  /* arrived tag – centered in remaining space */
  const arrivedTagWidth = clamp(contentWidth * 0.36, 340, 520);
  const arrivedTagHeight = 76;
  const arrivedTagX = contentX + (contentWidth - arrivedTagWidth) / 2 + 40;
  const arrivedTagY = stripY + 6;
  const arrivedLabelWidth = 110;
  const arrivedMainX = arrivedTagX + arrivedLabelWidth + 14;

  /* route span on the right */
  const rightRouteX = contentX + contentWidth - 14;

  return {
    stripX,
    stripY,
    stripWidth,
    stripHeight,
    contentX,
    contentY,
    contentWidth,
    contentHeight,
    brandCardX,
    brandCardY,
    brandCardW,
    brandCardH,
    lineBadgeX,
    lineBadgeCenterY,
    arrivedTagX,
    arrivedTagY,
    arrivedTagWidth,
    arrivedTagHeight,
    arrivedLabelWidth,
    arrivedMainX,
    rightRouteX,
  };
});

const lineBadgeMeta = computed(() => {
  const raw = String(model.value.lineBadgeZh || model.value.lineNameZh || "").trim();
  const match = raw.match(/^(\d+)(号线)?$/u);
  if (!match) {
    return {
      isNumeric: false,
      numberPart: "",
      suffixPart: "",
      fullText: raw,
    };
  }
  return {
    isNumeric: true,
    numberPart: match[1],
    suffixPart: match[2] || "号线",
    fullText: raw,
  };
});

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
            <g id="jinanMetroIcon" class="hud-defs__metro-icon">
              <rect
                x="32.2"
                y="3.8"
                width="206.1"
                height="268.2"
                fill="#ffffff"
              />
              <g :transform="JINAN_METRO_ICON_TRANSFORM">
                <path
                  :d="JINAN_METRO_ICON_MAIN_PATH"
                  :fill="JINAN_METRO_ICON_COLOR"
                />
                <path
                  :d="JINAN_METRO_ICON_INNER_PATH"
                  :fill="JINAN_METRO_ICON_COLOR"
                />
              </g>
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
            <!-- ===== header color strip ===== -->
            <rect
              class="hud-header__strip"
              :x="hudHeaderLayout.stripX"
              :y="hudHeaderLayout.stripY"
              :width="hudHeaderLayout.stripWidth"
              :height="hudHeaderLayout.stripHeight"
              rx="8"
              :fill="model.lineColor"
            />

            <!-- ===== brand card (white inset) ===== -->
            <rect
              class="hud-header__brand-card"
              :x="hudHeaderLayout.brandCardX"
              :y="hudHeaderLayout.brandCardY"
              :width="hudHeaderLayout.brandCardW"
              :height="hudHeaderLayout.brandCardH"
              rx="5"
              fill="#ffffff"
            />
            <g
              class="hud-header__brand-icon"
              :transform="`translate(${hudHeaderLayout.brandCardX + 6} ${hudHeaderLayout.brandCardY + 4}) scale(0.18)`"
            >
              <use href="#jinanMetroIcon" />
            </g>
            <image
              class="hud-header__brand-wordmark"
              :href="jinanWordmarkImage"
              :x="hudHeaderLayout.brandCardX + 68"
              :y="hudHeaderLayout.brandCardY + 10"
              width="82"
              height="22"
              preserveAspectRatio="xMinYMid meet"
            />
            <text
              class="hud-header__brand-en hud-brand-en"
              :x="hudHeaderLayout.brandCardX + 68"
              :y="hudHeaderLayout.brandCardY + 50"
            >
              JINAN METRO
            </text>

            <!-- ===== line badge (number + 号线) ===== -->
            <g class="hud-header__line-badge-group">
              <text
                v-if="lineBadgeMeta.isNumeric"
                class="hud-header__line-badge-number hud-line-badge-zh"
                :x="hudHeaderLayout.lineBadgeX"
                :y="hudHeaderLayout.lineBadgeCenterY + 22"
                text-anchor="start"
                dominant-baseline="auto"
              >
                {{ lineBadgeMeta.numberPart }}
              </text>
              <text
                v-if="lineBadgeMeta.isNumeric"
                class="hud-header__line-badge-suffix hud-line-badge-zh"
                :x="hudHeaderLayout.lineBadgeX + String(lineBadgeMeta.numberPart).length * 42 + 4"
                :y="hudHeaderLayout.lineBadgeCenterY + 16"
                text-anchor="start"
              >
                {{ lineBadgeMeta.suffixPart }}
              </text>
              <text
                v-if="!lineBadgeMeta.isNumeric"
                class="hud-header__line-badge-full hud-line-badge-zh"
                :x="hudHeaderLayout.lineBadgeX"
                :y="hudHeaderLayout.lineBadgeCenterY + 10"
                text-anchor="start"
              >
                {{ lineBadgeMeta.fullText }}
              </text>
              <text
                class="hud-header__line-badge-en hud-line-badge-en"
                :x="hudHeaderLayout.lineBadgeX"
                :y="hudHeaderLayout.lineBadgeCenterY + 36"
                text-anchor="start"
              >
                {{ model.lineBadgeEn || model.lineNameEn }}
              </text>
            </g>

            <!-- ===== arrived station tab ===== -->
            <g class="hud-header__arrived-tab">
              <!-- white card background -->
              <rect
                :x="hudHeaderLayout.arrivedTagX"
                :y="hudHeaderLayout.arrivedTagY"
                :width="hudHeaderLayout.arrivedTagWidth"
                :height="hudHeaderLayout.arrivedTagHeight"
                rx="6"
                fill="#ffffff"
              />
              <!-- vertical divider -->
              <line
                :x1="hudHeaderLayout.arrivedTagX + hudHeaderLayout.arrivedLabelWidth"
                :y1="hudHeaderLayout.arrivedTagY + 10"
                :x2="hudHeaderLayout.arrivedTagX + hudHeaderLayout.arrivedLabelWidth"
                :y2="hudHeaderLayout.arrivedTagY + hudHeaderLayout.arrivedTagHeight - 10"
                stroke="#e0e6ed"
                stroke-width="1.2"
              />
              <!-- downward triangle pointer -->
              <path
                :d="`M ${hudHeaderLayout.arrivedTagX + 40} ${hudHeaderLayout.arrivedTagY + hudHeaderLayout.arrivedTagHeight}
                      L ${hudHeaderLayout.arrivedTagX + 56} ${hudHeaderLayout.arrivedTagY + hudHeaderLayout.arrivedTagHeight + 10}
                      L ${hudHeaderLayout.arrivedTagX + 72} ${hudHeaderLayout.arrivedTagY + hudHeaderLayout.arrivedTagHeight}
                      Z`"
                fill="#ffffff"
              />
              <!-- cover the bottom border where triangle meets -->
              <line
                :x1="hudHeaderLayout.arrivedTagX + 41"
                :y1="hudHeaderLayout.arrivedTagY + hudHeaderLayout.arrivedTagHeight"
                :x2="hudHeaderLayout.arrivedTagX + 71"
                :y2="hudHeaderLayout.arrivedTagY + hudHeaderLayout.arrivedTagHeight"
                stroke="#ffffff"
                stroke-width="2"
              />
              <!-- 下一站 label -->
              <text
                class="hud-header__arrived-tag-zh"
                :x="hudHeaderLayout.arrivedTagX + hudHeaderLayout.arrivedLabelWidth / 2"
                :y="hudHeaderLayout.arrivedTagY + 30"
                text-anchor="middle"
              >
                下一站
              </text>
              <text
                class="hud-header__arrived-tag-en hud-text-en"
                :x="hudHeaderLayout.arrivedTagX + hudHeaderLayout.arrivedLabelWidth / 2"
                :y="hudHeaderLayout.arrivedTagY + 52"
                text-anchor="middle"
              >
                Next
              </text>
            </g>

            <!-- arrived station name -->
            <text
              class="hud-header__arrived-main-zh"
              :x="hudHeaderLayout.arrivedMainX"
              :y="hudHeaderLayout.arrivedTagY + 34"
              text-anchor="start"
            >
              {{ model.nextStationZh || model.destinationZh || "" }}
            </text>
            <text
              class="hud-header__arrived-main-en hud-text-en"
              :x="hudHeaderLayout.arrivedMainX"
              :y="hudHeaderLayout.arrivedTagY + 58"
              text-anchor="start"
            >
              {{ model.nextStationEn || model.destinationEn || "" }}
            </text>

            <!-- route span on the right -->
            <text
              v-if="!model.isLoop"
              class="hud-header__route-zh hud-route-zh"
              :x="hudHeaderLayout.rightRouteX"
              :y="hudHeaderLayout.lineBadgeCenterY + 2"
              text-anchor="end"
            >
              {{ model.routeSpanZh || "" }}
            </text>
            <text
              v-if="!model.isLoop"
              class="hud-header__route-en hud-route-en"
              :x="hudHeaderLayout.rightRouteX"
              :y="hudHeaderLayout.lineBadgeCenterY + 22"
              text-anchor="end"
            >
              {{ model.routeSpanEn || "" }}
            </text>

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
                r="24"
                fill="#ffffff"
                :stroke="model.lineColor"
                stroke-width="7"
              />
              <circle
                v-if="station.isInterchange"
                class="hud-station__interchange-ring"
                :cx="station.x"
                :cy="station.y"
                r="33"
                fill="#f9fcff"
                :stroke="model.lineColor"
                stroke-width="3"
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

.hud-brand-zh,
.hud-line-badge-zh,
.hud-next-tag,
.hud-next-main,
.hud-route-zh,
.hud-station-zh {
  font-family:
    "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei",
    sans-serif;
}

.hud-brand-en,
.hud-line-badge-en,
.hud-next-tag-en,
.hud-next-main-en,
.hud-route-en,
.hud-station-en,
.hud-text-en {
  font-family:
    "DIN Alternate", "Bahnschrift", "Roboto Condensed", "Arial Narrow",
    "Noto Sans", sans-serif;
}
.hud-brand-zh {
  fill: #111827;
  font-size: 23px;
  font-weight: 750;
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
.hud-brand-en {
  fill: #374151;
  font-size: 10px;
  letter-spacing: 0.06em;
  font-weight: 700;
}

.hud-header__arrived-tag-zh {
  fill: #3a4a5c;
  font-family:
    "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei",
    sans-serif;
  font-size: 20px;
  font-weight: 700;
}

.hud-header__arrived-tag-en {
  fill: #8b99aa;
  font-size: 14px;
  letter-spacing: 0.03em;
  font-weight: 650;
}

.hud-header__arrived-main-zh {
  fill: #111827;
  font-family:
    "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei",
    sans-serif;
  font-size: 36px;
  font-weight: 800;
}

.hud-header__arrived-main-en {
  fill: #5c6c80;
  font-size: 16px;
  letter-spacing: 0.03em;
  font-weight: 650;
}

.hud-line-badge-zh {
  fill: #ffffff;
  font-size: 31px;
  font-weight: 760;
}

.hud-header__line-badge-number {
  fill: #ffffff;
  font-family:
    "DIN Alternate", "Bahnschrift", "Roboto Condensed", "Arial Narrow",
    "Noto Sans", sans-serif;
  font-size: 68px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.hud-header__line-badge-suffix {
  fill: #ffffff;
  font-size: 28px;
  font-weight: 760;
}

.hud-header__line-badge-full {
  fill: #ffffff;
  font-size: 36px;
  font-weight: 760;
}

.hud-line-badge-en {
  fill: rgba(255, 255, 255, 0.75);
  font-size: 16px;
  letter-spacing: 0.04em;
  font-weight: 700;
}

.hud-next-tag {
  fill: #4b5563;
  font-size: 15px;
  font-weight: 700;
}

.hud-next-tag-en {
  fill: #9ca3af;
  font-size: 11px;
  letter-spacing: 0.03em;
  font-weight: 680;
}

.hud-next-main {
  fill: #1f2937;
  font-size: 29px;
  font-weight: 760;
}

.hud-next-main-en {
  fill: #374151;
  font-size: 14px;
  letter-spacing: 0.03em;
  font-weight: 680;
}

.hud-route-zh {
  fill: #ffffff;
  font-size: 22px;
  font-weight: 760;
}

.hud-route-en {
  fill: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  letter-spacing: 0.03em;
  font-weight: 700;
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
</style>
