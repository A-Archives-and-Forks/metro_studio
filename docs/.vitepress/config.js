import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Metro Studio',
  description: '专业地铁线路图编辑器',
  lang: 'zh-CN',
  themeConfig: {
    logo: '/images/editor.png',
    nav: [
      { text: '首页', link: '/' },
      { text: '功能介绍', link: '/features' },
      { text: '快速开始', link: '/getting-started' },
      { text: '在线体验', link: 'https://metro-studio-iota.vercel.app/' }
    ],
    sidebar: [
      {
        text: '指南',
        items: [
          { text: '项目简介', link: '/introduction' },
          { text: '快速开始', link: '/getting-started' },
          { text: '快捷键', link: '/shortcuts' }
        ]
      },
      {
        text: '功能',
        items: [
          { text: '功能总览', link: '/features' },
          { text: '地图编辑', link: '/features/map-editor' },
          { text: '示意图生成', link: '/features/schematic' },
          { text: '多视图展示', link: '/features/views' },
          { text: 'AI 辅助', link: '/features/ai' },
          { text: '导入导出', link: '/features/import-export' }
        ]
      },
      {
        text: '参与',
        items: [
          { text: '贡献指南', link: '/contributing' },
          { text: '技术架构', link: '/architecture' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Ce-daros/railmap' }
    ],
    footer: {
      message: '基于 GPL-3.0 许可证发布',
      copyright: 'Copyright © 2024-present Metro Studio'
    },
    outline: { label: '目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    search: { provider: 'local' }
  }
})
