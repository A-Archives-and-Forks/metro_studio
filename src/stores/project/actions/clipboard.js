const clipboardActions = {
  async copySelectedEdges() {
    const { copySelectedEdges } = await import('../../../lib/clipboard/clipboard.js')
    const result = await copySelectedEdges(this)
    if (result) {
      this.statusText = `已复制 ${result.lineCount} 条线路、${result.edgeCount} 条线段、${result.stationCount} 个站点`
    }
  },

  async pasteEdges() {
    const { pasteEdges, hasClipboardData } = await import('../../../lib/clipboard/clipboard.js')
    if (!await hasClipboardData()) {
      this.statusText = '剪贴板中没有可粘贴的线段数据'
      return
    }
    const result = await pasteEdges(this)
    if (result) {
      this.touchProject('粘贴')
      this.resetHistoryBaseline()
      this.statusText = `已粘贴 ${result.lineCount} 条线路、${result.edgeCount} 条线段、${result.stationCount} 个站点`
    }
  },

  async checkClipboardAvailability() {
    const { hasClipboardData } = await import('../../../lib/clipboard/clipboard.js')
    return await hasClipboardData()
  },
}

export { clipboardActions }
